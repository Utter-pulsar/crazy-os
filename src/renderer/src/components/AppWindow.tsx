import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { AppRuntimeFiles, Hook, MutateOp, PlanUnit, Turn, ViewPersistenceIntent, ViewRequest } from '@shared/types'
import { useStore, type WinState } from '../store'
import { WindowFrame } from './WindowFrame'
import { registerWindow, unregisterWindow } from '../agentTools'
import { emitAppStatus, clearAppStatus, type AppStatusTodo } from '../lib/appStatus'
import { emitPendingConfirmation } from '../lib/pendingConfirmation'
import { viewDocHead, VIEW_DOC_TAIL } from '../iframeDoc'
import { dispatchFs, FS_CHANGED_EVENT, isOwnFs, newOrigin } from '../lib/fsClipboard'
import { ensureControlRoutes, hasRenderableContent } from '../lib/controlRoutes'
import { normalizeBrowserPageRoutes } from '../lib/browserPageRoutes'

let streamSeq = 0

/**
 * A model-generated app window (progressive-unit protocol v3).
 *
 * The model streams: <!--plan:[...]-->, then per unit a <script> (logic, app.* only),
 * the unit's HTML, and <!--done:id-->. The stream writer below:
 *   * writes plain HTML straight into the open document (draws as it arrives)
 *   * executes each <script> the moment it closes — so a control is operable as soon
 *     as its HTML lands, while the rest is still streaming
 *   * strips plan/done sentinels out of the document and turns them into progress
 * Local interactions never contact the model. Only "hooks" call back, and every
 * model-backed hook streams its modules into the existing live surface.
 */
function viewTitleOf(d: Document, fallback: string): string {
  const selectors = ['[data-window-title]', '[data-page-title]', '#browser-tabs [data-active="true"] .browser-tab-label', '#browser-page-title', '.title']
  for (const sel of selectors) {
    const el = d.querySelector(sel)
    const text = el?.textContent?.trim()
    if (text) return text.slice(0, 80)
  }
  return fallback
}

function todosFromPlan(plan: PlanUnit[], done: ReadonlySet<string>): AppStatusTodo[] {
  return plan.map((u) => ({ id: u.id, label: u.label, done: done.has(u.id) }))
}

/** Serialize only model-owned UI. Host scrollbars/toasts and transient drawing
 * placeholders are deliberately excluded, while live form values are folded
 * into attributes/text so the temporary file really matches what is on screen. */
function serializeRuntimeHtml(d: Document, includeEphemeral = true): string {
  if (!d.body) return ''
  const clone = d.body.cloneNode(true) as HTMLBodyElement
  clone.querySelectorAll('[data-crazyos-host]').forEach((el) => el.remove())
  if (!includeEphemeral) clone.querySelectorAll('[data-ephemeral="true"]').forEach((el) => el.remove())

  const liveScripts = Array.from(d.body.querySelectorAll<HTMLScriptElement>('script:not([data-crazyos-host])'))
  const clonedScripts = Array.from(clone.querySelectorAll<HTMLScriptElement>('script:not([data-crazyos-host])'))
  for (let i = 0; i < Math.min(liveScripts.length, clonedScripts.length); i++) {
    clonedScripts[i].textContent = scriptSource(liveScripts[i])
  }

  const liveFields = Array.from(d.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
  const clonedFields = Array.from(clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
  for (let i = 0; i < Math.min(liveFields.length, clonedFields.length); i++) {
    const live = liveFields[i]
    const saved = clonedFields[i]
    if (live.tagName === 'INPUT' && saved.tagName === 'INPUT') {
      const input = live as HTMLInputElement
      saved.setAttribute('value', input.value)
      if (input.checked) saved.setAttribute('checked', '')
      else saved.removeAttribute('checked')
    } else if (live.tagName === 'TEXTAREA' && saved.tagName === 'TEXTAREA') {
      saved.textContent = (live as HTMLTextAreaElement).value
    } else if (live.tagName === 'SELECT' && saved.tagName === 'SELECT') {
      const selectedIndex = (live as HTMLSelectElement).selectedIndex
      Array.from((saved as HTMLSelectElement).options).forEach((opt, index) => opt.toggleAttribute('selected', index === selectedIndex))
    }
  }
  return clone.innerHTML.trim()
}

/** Capture one live slot exactly enough to restore it after a rejected stream.
 * innerHTML alone loses typed form values and the original source of scripts
 * that have already been wrapped for execution. */
function serializeRuntimeInner(target: HTMLElement): string {
  const clone = target.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-crazyos-host]').forEach((el) => el.remove())
  foldSnapshotFormValues(target, clone)

  const liveScripts = Array.from(target.querySelectorAll<HTMLScriptElement>('script:not([data-crazyos-host])'))
  const clonedScripts = Array.from(clone.querySelectorAll<HTMLScriptElement>('script:not([data-crazyos-host])'))
  for (let i = 0; i < Math.min(liveScripts.length, clonedScripts.length); i++) {
    clonedScripts[i].textContent = scriptSource(liveScripts[i])
  }
  return clone.innerHTML
}

function isScaffoldPlaceholderHtml(html: string): boolean {
  const lower = html.trim().toLowerCase()
  return !lower || lower.includes('data-crazy-app-placeholder') || (lower.length < 600 && lower.includes('opening kit') && lower.includes('install'))
}

function installArtifacts(variantKey?: string): readonly [string, string, string] {
  const variant = variantKey?.trim() || 'default'
  return ['data.json', `${variant}.long-term.html`, `${variant}.temporary.html`]
}

/** A real first-run surface, deliberately separate from generated app content.
 * It is marked as a placeholder so the first streamed module replaces it only
 * after that module has been committed to temporary.html. */
function installerHtml(appName: string, variantKey: string | undefined, completed: number): string {
  const artifacts = installArtifacts(variantKey)
  const safeName = escapeHtml(appName)
  const done = Math.max(0, Math.min(artifacts.length, completed))
  const progress = Math.round((done / artifacts.length) * 100)
  const current = done < artifacts.length ? artifacts[done] : null
  const rows = artifacts.map((file, index) => {
    const finished = index < done
    const active = index === done
    return `<li style="display:flex;align-items:center;gap:10px;padding:7px 0;color:${finished ? 'var(--ink)' : 'var(--muted)'}">
      <span aria-hidden="true" style="width:22px;height:22px;border:2px solid var(--ink);border-radius:50%;display:grid;place-items:center;background:${finished ? 'var(--accent)' : active ? 'var(--card)' : 'transparent'}">${finished ? '✓' : active ? '•' : ''}</span>
      <code style="overflow-wrap:anywhere;word-break:break-word">${file}</code>
    </li>`
  }).join('')
  return `<main data-crazy-app-placeholder="true" data-crazy-installer="true" style="min-height:100%;display:grid;place-items:center;padding:28px">
    <section class="card" style="width:min(620px,100%);padding:0;overflow:hidden">
      <header style="display:flex;align-items:center;gap:14px;padding:20px 24px;border-bottom:2px dotted color-mix(in srgb,var(--ink) 35%,transparent);background:color-mix(in srgb,var(--accent) 10%,var(--card))">
        <div aria-hidden="true" style="font-size:38px">🖥️</div>
        <div><div class="title" style="font-size:24px">正在安装 ${safeName}</div><p class="muted" style="margin:4px 0 0">CrazyOS 正在准备应用的运行文件</p></div>
      </header>
      <div style="padding:22px 24px 24px">
        <p style="margin:0 0 8px;font-weight:700">${current ? `正在创建 ${current}` : '三个文件已创建，正在启动应用…'}</p>
        <div role="progressbar" aria-label="安装进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" style="height:24px;padding:3px;border:2px solid var(--ink);border-radius:6px;background:var(--paper);overflow:hidden">
          <div style="height:100%;width:${progress}%;border-radius:3px;background:var(--accent);transition:width .2s ease"></div>
        </div>
        <div class="muted" style="margin-top:6px;text-align:right">${done} / ${artifacts.length}</div>
        <ul style="list-style:none;margin:12px 0 0;padding:0">${rows}</ul>
      </div>
    </section>
  </main>`
}

function invokeUnitInitializer(d: Document, unitId: string): void {
  const w = d.defaultView as (Window & { app?: Record<string, unknown> }) | null
  const fn = w?.app?.[`init_${unitId}`]
  if (typeof fn !== 'function') return
  try {
    ;(fn as () => void)()
  } catch (err) {
    console.error('[AppWindow] unit init failed:', err)
  }
}

function invokeUnitInitializerStrict(d: Document, unitId: string): void {
  const w = d.defaultView as (Window & { app?: Record<string, unknown> }) | null
  const fn = w?.app?.[`init_${unitId}`]
  if (typeof fn !== 'function') throw new Error(`找不到目标区域初始化器 app.init_${unitId}。`)
  try {
    ;(fn as () => void)()
  } catch (err) {
    throw new Error(`目标区域初始化失败（${unitId}）：${errorMessage(err)}`)
  }
}

function documentInitializers(d: Document): Array<{ id: string; source: string }> {
  const appObj = (d.defaultView as (Window & { app?: Record<string, unknown> }) | null)?.app
  if (!appObj) return []
  const out: Array<{ id: string; source: string }> = []
  for (const key of Object.keys(appObj)) {
    const fn = appObj[key]
    if (!key.startsWith('init_') || typeof fn !== 'function') continue
    out.push({ id: key.slice(5), source: Function.prototype.toString.call(fn) })
  }
  return out
}

export function AppWindow({ win }: { win: WinState }): JSX.Element {
  const closeWindow = useStore((s) => s.closeWindow)
  const focusWindow = useStore((s) => s.focusWindow)
  const systemTheme = useStore((s) => s.theme)
  // A window follows the system theme unless the agent locked it to one.
  const effectiveDark = (win.themeOverride ?? systemTheme) === 'dark'
  const darkRef = useRef(effectiveDark)
  darkRef.current = effectiveDark
  const app = win.app
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const activeWriterRef = useRef<((t: string) => void) | null>(null)
  const currentStreamRef = useRef<string>('')
  // Full-window generations are exclusive, but typed slot generations are
  // isolated by target. In particular, two browser tabs may keep streaming at
  // the same time without either tab cancelling or receiving the other's chunks.
  const slotWritersRef = useRef(new Map<string, (t: string) => void>())
  const slotStreamsRef = useRef(new Map<string, string>())
  const browserSlotBaselinesRef = useRef(new Map<string, string>())
  const slotApplyChainRef = useRef<Promise<void>>(Promise.resolve())
  const historyRef = useRef<Turn[]>([])
  // A brand-new window starts in a non-ready state before React effects have had
  // a chance to scaffold or render it. This closes the old "mounted == ready"
  // race that let open_app return while the first generation had not even begun.
  const busyRef = useRef(true)
  const readyRef = useRef(false)
  const readyErrorRef = useRef<string | null>(null)
  // Every user interaction bumps this. Any async op (stream / patch) captures the value
  // it started at and drops its result if a NEWER interaction has superseded it — so a
  // second click interrupts the first instead of queueing behind it.
  const genRef = useRef(0)
  const [busyLabel, setBusyLabel] = useState<string | null>('Opening…')
  const [plan, setPlan] = useState<PlanUnit[]>([])
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set())
  const [frameTitle, setFrameTitle] = useState<string>(win.app.seedTitle ?? win.app.name)
  const frameTitleRef = useRef(frameTitle)
  frameTitleRef.current = frameTitle
  const planRef = useRef<PlanUnit[]>([])
  planRef.current = plan
  const hasOpeningKitRef = useRef(!!win.app.seedHtml)
  const homeInstallPendingRef = useRef(
    win.openPlan?.disposition === 'create' || win.openPlan?.disposition === 'convert-mode'
  )
  // The first durable kit may already be appearing progressively, but its
  // controls are not authoritative until all modules and both HTML files have
  // committed. Keep the surface visible while preventing a half-installed
  // local handler from replacing the completed home.
  const [installInteractionLocked, setInstallInteractionLocked] = useState(homeInstallPendingRef.current)
  const initialHomeCommitRef = useRef(homeInstallPendingRef.current)
  const recentHomeInstallUntilRef = useRef(0)
  const pendingHomeHookRef = useRef<Hook | null>(null)
  const pendingKitRepairRef = useRef<ViewPersistenceIntent | null>(null)
  const fsOriginRef = useRef(newOrigin())
  const lastTemporaryHtmlRef = useRef('')
  const longTermRevisionRef = useRef<number | undefined>(undefined)
  const runtimeRevisionRef = useRef<number | undefined>(undefined)
  const runtimeObserverRef = useRef<MutationObserver | null>(null)
  const liveDomRevisionRef = useRef(0)
  const runtimeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runtimeCommitChainRef = useRef<Promise<void>>(Promise.resolve())
  const runtimeResetPromiseRef = useRef<Promise<void> | null>(null)
  const closingRef = useRef(false)
  const initializerSourcesRef = useRef(new Map<string, string>())
  const hotReloadSeqRef = useRef(0)

  const finishHomeInstall = (): void => {
    homeInstallPendingRef.current = false
    setInstallInteractionLocked(false)
    if (initialHomeCommitRef.current) {
      // A steering message can only issue its follow-up open_app after the
      // first open_app tool reaches a safe terminal boundary. Keep a short
      // durable-home grace window so that queued correction is still treated
      // as part of the first installation rather than a transient page edit.
      initialHomeCommitRef.current = false
      recentHomeInstallUntilRef.current = Date.now() + 60_000
    }
    const queuedHook = pendingHomeHookRef.current
    pendingHomeHookRef.current = null
    if (queuedHook) {
      setTimeout(() => {
        if (!closingRef.current) void onHookRef.current(queuedHook).catch((err) => console.error('[AppWindow] queued install hook failed:', err))
      }, 0)
    }
  }

  const docOf = (): Document | null => iframeRef.current?.contentDocument ?? null

  const toastInApp = (msg: string): void => {
    const w = iframeRef.current?.contentWindow as (Window & { __czToast?: (m: string) => void }) | null
    try {
      w?.__czToast?.(msg)
    } catch {
      // iframe not ready yet — fine, it's just a toast
    }
  }

  const persistTemporary = useCallback(
    (html: string, title: string): Promise<void> => {
      const source = html.trim()
      if (!source) return runtimeCommitChainRef.current
      const commit = runtimeCommitChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (closingRef.current) return
          // Dedupe only after every older queued snapshot has settled. Checking
          // before enqueue allowed a delayed partial snapshot to land after a
          // final snapshot and become the file's accidental tail.
          if (lastTemporaryHtmlRef.current === source) return
          const result = await window.crazyos.appRuntimeSet({
            appId: app.id,
            name: app.name,
            variantKey: app.variantKey ?? 'default',
            title,
            html: source,
            baseTemporaryUpdatedAt: runtimeRevisionRef.current
          })
          if (!result.applied) {
            dispatchFs('runtime-conflict')
            throw new Error('temporary.html 已被其他窗口更新；已放弃这次旧写入并重新同步。')
          }
          runtimeRevisionRef.current = result.files.temporaryUpdatedAt
          longTermRevisionRef.current = result.files.longTermUpdatedAt
          // Only acknowledge a runtime source after the main process has
          // actually written temporary.html. Failed writes remain retryable.
          lastTemporaryHtmlRef.current = source
          dispatchFs(fsOriginRef.current)
        })
      runtimeCommitChainRef.current = commit
      return commit
    },
    [app.id, app.name, app.variantKey]
  )

  const persistOpeningKit = useCallback(
    async (html: string, title: string): Promise<void> => {
      const source = html.trim()
      const commit = runtimeCommitChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (closingRef.current) return
          const result = await window.crazyos.appViewSet({
            appId: app.id,
            name: app.name,
            variantKey: app.variantKey ?? 'default',
            title,
            html: source,
            baseLongTermUpdatedAt: longTermRevisionRef.current,
            baseTemporaryUpdatedAt: runtimeRevisionRef.current
          })
          if (!result.applied) {
            dispatchFs('opening-kit-conflict')
            throw new Error('long-term.html 或 temporary.html 已被外部更新；已保留用户文件并停止旧的首页写入。')
          }
          const files = result.files
          longTermRevisionRef.current = files.longTermUpdatedAt
          runtimeRevisionRef.current = files.temporaryUpdatedAt
          lastTemporaryHtmlRef.current = source
          dispatchFs(fsOriginRef.current)
        })
      runtimeCommitChainRef.current = commit
      await commit
    },
    [app.id, app.name, app.variantKey]
  )

  const commitLiveDocument = useCallback(async (): Promise<void> => {
    const d = docOf()
    if (!d?.body) return
    const html = serializeRuntimeHtml(d)
    if (!html) return
    const title = viewTitleOf(d, app.seedTitle ?? app.name)
    setFrameTitle(title)
    await persistTemporary(html, title)
  }, [app.name, app.seedTitle, persistTemporary])

  const scheduleRuntimeCommit = useCallback((): void => {
    if (runtimeCommitTimerRef.current) clearTimeout(runtimeCommitTimerRef.current)
    runtimeCommitTimerRef.current = setTimeout(() => {
      runtimeCommitTimerRef.current = null
      void commitLiveDocument().catch((err) => console.error('[AppWindow] temporary file commit failed:', err))
    }, 160)
  }, [commitLiveDocument])

  const installRuntimeObserver = useCallback(
    (d: Document): void => {
      runtimeObserverRef.current?.disconnect()
      if (!d.body) return
      const Observer = d.defaultView?.MutationObserver ?? MutationObserver
      const observer = new Observer((records) => {
        const meaningful = records.some((record) => {
          const target = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
          if (target?.closest('[data-crazyos-host]')) return false
          const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
          return changed.length === 0 || changed.some((node) => node.nodeType !== 1 || !(node as Element).matches('[data-crazyos-host]'))
        })
        if (meaningful) {
          liveDomRevisionRef.current++
          scheduleRuntimeCommit()
        }
      })
      observer.observe(d.body, { subtree: true, childList: true, characterData: true, attributes: true })
      runtimeObserverRef.current = observer
    },
    [scheduleRuntimeCommit]
  )

  const resetTemporaryOnce = useCallback((): Promise<void> => {
    if (!runtimeResetPromiseRef.current) {
      runtimeResetPromiseRef.current = runtimeCommitChainRef.current
        .catch(() => undefined)
        .then(() => window.crazyos.appRuntimeReset(app.id, app.name, app.variantKey))
        .then(() => {
          dispatchFs(fsOriginRef.current)
        })
    }
    return runtimeResetPromiseRef.current
  }, [app.id, app.name, app.variantKey])

  // Start a new interaction: supersede whatever is running and cancel its stream so the
  // model stops working on the old request immediately. Returns the new generation id.
  const beginInteraction = (): number => {
    if (currentStreamRef.current) {
      window.crazyos.cancelView(currentStreamRef.current)
      currentStreamRef.current = ''
    }
    for (const streamId of slotStreamsRef.current.values()) window.crazyos.cancelView(streamId)
    slotStreamsRef.current.clear()
    slotWritersRef.current.clear()
    browserSlotBaselinesRef.current.clear()
    activeWriterRef.current = null
    readyErrorRef.current = null
    return ++genRef.current
  }

  // Call app.init_<unitId> inside the iframe right after that unit's HTML completed.
  const callUnitInit = (unitId: string): void => {
    const d = docOf()
    if (d) invokeUnitInitializer(d, unitId)
  }

  const rememberInitializers = (d: Document): void => {
    for (const init of documentInitializers(d)) initializerSourcesRef.current.set(init.id, init.source)
  }

  const invokeChangedInitializers = (source: Document, live: Document): void => {
    const forceBrowserHydration = !!source.querySelector('[data-crazy-browser-runtime]')
    for (const init of documentInitializers(source)) {
      if (!forceBrowserHydration && initializerSourcesRef.current.get(init.id) === init.source) continue
      if (forceBrowserHydration && init.id !== 'browser' && initializerSourcesRef.current.get(init.id) === init.source) continue
      invokeUnitInitializer(live, init.id)
      initializerSourcesRef.current.set(init.id, init.source)
    }
    // Browser state is intentionally stored on the root DOM node so direct
    // temporary.html edits remain authoritative. Rehydrate its closure even
    // when the init function source itself did not change.
  }

  const persistenceOf = (req: ViewRequest): ViewPersistenceIntent => {
    if (req.persistence) return req.persistence
    return hasOpeningKitRef.current ? 'runtime' : 'create-kit'
  }

  const narratorFor = (label: string): string | undefined => {
    if (label === 'Opening…') return hasOpeningKitRef.current ? `正在加载 ${app.name}…` : `正在安装 ${app.name}…`
    if (label === '正在升级应用…') return `正在升级 ${app.name} 的长期首页…`
    if (label === '正在继续…') return `正在补充 ${app.name} 的后续内容…`
    if (label === '正在前往…') return `正在更新 ${app.name} 的页面内容…`
    if (label === '正在转换模式…') return `正在把 ${app.name} 转换为 ${app.variantKey ?? '新'} 模式…`
    if (label === '正在想…') return `正在判断 ${app.name} 应该局部补充还是整体改写…`
    return undefined
  }

  // Stream a full interactive document (open / navigate / regenerate).
  const renderStream = useCallback(
    async (req: ViewRequest, label: string, gen?: number): Promise<void> => {
      const myGen = gen ?? beginInteraction()
      const d = docOf()
      if (!d) return
      const persistence = persistenceOf(req)
      const durableWrite = persistence === 'create-kit' || persistence === 'upgrade-kit'
      const upgradingExistingHome = durableWrite && hasOpeningKitRef.current
      if (durableWrite) {
        recentHomeInstallUntilRef.current = 0
        pendingKitRepairRef.current = persistence
        homeInstallPendingRef.current = true
        setInstallInteractionLocked(true)
      }
      // Busy is set before the first await. waitUntilReady must never observe a
      // just-mounted window in the gap between scaffold and generation.
      busyRef.current = true
      readyErrorRef.current = null
      setBusyLabel(label)
      setPlan([])
      setDoneIds(new Set())
      emitAppStatus({
        instanceId: win.instanceId,
        appName: app.name,
        title: frameTitleRef.current,
        label,
        todos: [],
        narrator: narratorFor(label)
      })
      const streamId = `${app.id}-${win.instanceId}-${++streamSeq}`
      currentStreamRef.current = streamId
      let stage: StagedDocument | null = null
      let completedStage: StagedDocument | null = null
      let unitCommitChain: Promise<void> = Promise.resolve()
      const initializedLiveUnits = new Set<string>()
      const stagedDoneUnits = new Set<string>()
      let rawGeneratedHtml = ''
      let progressiveTimer: ReturnType<typeof setTimeout> | null = null
      try {
        if (req.persistence === 'create-kit' || req.persistence === 'upgrade-kit') {
          await window.crazyos.appScaffoldEnsure(app.id, app.name, app.variantKey)
          dispatchFs(fsOriginRef.current)
        }
        if (genRef.current !== myGen) return

        // Model output is parsed in staging first. Renderable partial snapshots
        // are committed to temporary.html and then morphed into the live page at
        // a short cadence; completed units additionally run their initializer.
        // This preserves file-first semantics without making the user wait for a
        // whole module (or the whole page) before seeing streamed content.
        const staged = createStagedDocument(darkRef.current)
        stage = staged
        const targetDoc = staged.doc
        let lastQueuedStageHtml = ''
        let progressiveSnapshotInFlight = false
        let progressiveSnapshotPending = false
        let progressiveSnapshotsClosed = false

        const queueStageSnapshot = (completedUnitId?: string): Promise<void> | null => {
          if (genRef.current !== myGen) return null
          ensureControlRoutes(staged.doc)
          const stageHtml = serializeRuntimeHtml(staged.doc)
          if (!stageHtml || !hasRenderableContent(staged.doc)) return null
          if (!completedUnitId && stageHtml === lastQueuedStageHtml) return null
          lastQueuedStageHtml = stageHtml
          const completedAtSnapshot = new Set(stagedDoneUnits)
          const unitInit = completedUnitId
            ? documentInitializers(staged.doc).find((entry) => entry.id === completedUnitId)
            : undefined
          const task = unitCommitChain.then(async () => {
              if (genRef.current !== myGen || closingRef.current) return
              // If the user changes the live DOM while an IPC write is in
              // flight, rebuild against the newest DOM instead of reconciling
              // an old snapshot back over that interaction.
              for (let attempt = 0; attempt < 3; attempt++) {
                const capturedLiveRevision = liveDomRevisionRef.current
                const merged = createStagedRuntime(serializeRuntimeHtml(d), darkRef.current)
                try {
                  // Keep stable existing chrome while an incoming module is
                  // incomplete. The final snapshot below removes anything no
                  // longer present in the authoritative completed source.
                  reconcileBody(merged.doc, stageHtml, false)
                  merged.doc.querySelectorAll('[data-crazy-app-placeholder]').forEach((el) => el.remove())
                  const audited = createAuditedRuntime(serializeRuntimeHtml(merged.doc), darkRef.current)
                  try {
                    const mergedHtml = serializeRuntimeHtml(audited.doc)
                    const streamedTitle = viewTitleOf(audited.doc, app.seedTitle ?? app.name)
                    await persistTemporary(mergedHtml, streamedTitle)
                    if (genRef.current !== myGen || closingRef.current) return
                    if (liveDomRevisionRef.current !== capturedLiveRevision) continue
                    runtimeObserverRef.current?.disconnect()
                    reconcileBody(d, mergedHtml, true)
                    liveDomRevisionRef.current++
                    setFrameTitle(streamedTitle)
                    installRuntimeObserver(d)
                    if (completedUnitId) {
                      const liveInit = unitInit
                        ? documentInitializers(d).find((entry) => entry.id === unitInit.id && entry.source === unitInit.source)
                        : undefined
                      // Initializers run exactly once, and only against the live
                      // document after its source has been committed/reconciled.
                      // Running them in staging can fire browser lifecycle or
                      // other side effects before the UI is actually ready.
                      if (liveInit && !initializedLiveUnits.has(completedUnitId)) {
                        callUnitInit(completedUnitId)
                        initializedLiveUnits.add(completedUnitId)
                        initializerSourcesRef.current.set(liveInit.id, liveInit.source)
                      }
                      await commitLiveDocument()
                      setDoneIds((prev) => {
                        const next = new Set([...prev, ...completedAtSnapshot])
                        emitAppStatus({
                          instanceId: win.instanceId,
                          appName: app.name,
                          title: streamedTitle,
                          label,
                          narrator: narratorFor(label),
                          todos: todosFromPlan(planRef.current, next)
                        })
                        return next
                      })
                    }
                    return
                  } finally {
                    audited.dispose()
                  }
                } finally {
                  merged.dispose()
                }
              }
              throw new Error('应用在生成期间持续发生本地交互；已保留最新界面，请重试这次修改。')
            })
          unitCommitChain = task
          return task
        }

        const runLatestProgressiveSnapshot = (): void => {
          if (progressiveSnapshotsClosed) return
          if (progressiveSnapshotInFlight) {
            progressiveSnapshotPending = true
            return
          }
          const task = queueStageSnapshot()
          if (!task) return
          progressiveSnapshotInFlight = true
          const settleProgressiveSnapshot = (): void => {
            progressiveSnapshotInFlight = false
            if (!progressiveSnapshotsClosed && progressiveSnapshotPending) {
              progressiveSnapshotPending = false
              runLatestProgressiveSnapshot()
            }
          }
          void task.then(settleProgressiveSnapshot, settleProgressiveSnapshot)
        }

        const scheduleProgressiveSnapshot = (): void => {
          if (progressiveSnapshotsClosed) return
          if (progressiveTimer) return
          progressiveTimer = setTimeout(() => {
            progressiveTimer = null
            runLatestProgressiveSnapshot()
          }, 90)
        }

        const sw = makeStreamWriter(targetDoc, {
        onPlan: (units) => {
          if (genRef.current !== myGen) return
          setPlan(units)
          emitAppStatus({
            instanceId: win.instanceId,
            appName: app.name,
            title: frameTitleRef.current,
            label,
            narrator: narratorFor(label),
            todos: todosFromPlan(units, new Set())
          })
        },
        onDone: (id) => {
          if (genRef.current !== myGen) return
          stagedDoneUnits.add(id)
          if (progressiveTimer) {
            clearTimeout(progressiveTimer)
            progressiveTimer = null
          }
          queueStageSnapshot(id)
        }
      })
        activeWriterRef.current = (text) => {
          rawGeneratedHtml += text
          sw.write(text)
          scheduleProgressiveSnapshot()
        }
        const done = await window.crazyos.generateView(req, streamId)
        if (genRef.current !== myGen) return // superseded by a newer interaction
        activeWriterRef.current = null
        if (progressiveTimer) {
          clearTimeout(progressiveTimer)
          progressiveTimer = null
        }
        // Freeze the coalescer before capturing its tail. Without this barrier,
        // an in-flight task's finally() could append one last partial snapshot
        // after the final document had already been persisted.
        progressiveSnapshotsClosed = true
        progressiveSnapshotPending = false
        const truncated = sw.finish()
        targetDoc.write(VIEW_DOC_TAIL)
        targetDoc.close()
        queueStageSnapshot()
        await unitCommitChain
        if (genRef.current !== myGen) return
        if (done.cancelled) {
          throw new Error(durableWrite ? '已停止应用安装。' : '已停止生成。')
        }
        const fullGeneratedSource = done.html.trim() || rawGeneratedHtml
        completedStage = createStagedRuntime(fullGeneratedSource, darkRef.current)
        if (!hasRenderableContent(completedStage.doc)) throw new Error('模型没有生成可显示的应用界面。')
        ensureControlRoutes(completedStage.doc)
        if (truncated) toastInApp('流式片段曾中断，已用完整结果恢复并校验 ✂️')
        const finalRuntimeHtml = serializeRuntimeHtml(completedStage.doc)
        const finalTitle = viewTitleOf(completedStage.doc, app.seedTitle ?? app.name)
        let finalPersistentHtml = serializeRuntimeHtml(completedStage.doc, false)
        const finalLiveRevision = liveDomRevisionRef.current
        if (persistence === 'create-kit' || persistence === 'upgrade-kit') {
          const durableCandidate = createAuditedRuntime(fullGeneratedSource, darkRef.current)
          try {
            // The durable kit comes from the clean generated source before
            // init_* materializes runtime-only values. temporary.html below
            // still receives the fully initialized staged DOM.
            finalPersistentHtml = serializeRuntimeHtml(durableCandidate.doc, false)
            await persistOpeningKit(finalPersistentHtml, viewTitleOf(durableCandidate.doc, finalTitle))
            hasOpeningKitRef.current = true
            pendingKitRepairRef.current = null
          } finally {
            durableCandidate.dispose()
          }
        }
        await persistTemporary(finalRuntimeHtml, finalTitle)
        if (genRef.current !== myGen) return
        if (liveDomRevisionRef.current === finalLiveRevision) {
          runtimeObserverRef.current?.disconnect()
          reconcileBody(d, finalRuntimeHtml, true)
          liveDomRevisionRef.current++
          setFrameTitle(finalTitle)
          installRuntimeObserver(d)
          const liveInitializers = documentInitializers(d)
          const forceBrowserHydration = !!completedStage.doc.querySelector('[data-crazy-browser-runtime]')
          for (const init of documentInitializers(completedStage.doc)) {
            // The authoritative final reconcile restores the serialized browser
            // root, including its intentionally inert opening placeholder. Run
            // init_browser again even if a progressive snapshot initialized it,
            // otherwise the final frame visibly regresses to "正在准备…".
            if (initializedLiveUnits.has(init.id) && !(forceBrowserHydration && init.id === 'browser')) continue
            if (!liveInitializers.some((entry) => entry.id === init.id && entry.source === init.source)) continue
            invokeUnitInitializer(d, init.id)
            initializedLiveUnits.add(init.id)
          }
          rememberInitializers(completedStage.doc)
        }
        // Always place the actual live DOM at the tail of the temporary queue.
        // If a local action happened during an IPC await, it wins over the old
        // staged snapshot instead of being rolled back.
        await commitLiveDocument()
        setDoneIds(new Set(stagedDoneUnits))
        readyRef.current = true
        if (persistence === 'create-kit' || persistence === 'upgrade-kit') finishHomeInstall()
        historyRef.current = [{ role: 'user', text: `${label} ${app.name}` }, { role: 'assistant', text: finalPersistentHtml }]
        clearAppStatus(win.instanceId)
      } catch (err) {
        if (genRef.current !== myGen) return
        await unitCommitChain.catch(() => undefined)
        clearAppStatus(win.instanceId)
        const message = String(err instanceof Error ? err.message : err)
        readyErrorRef.current = message
        // A failed upgrade of an already usable app leaves its previous live
        // and durable home intact, so release the interaction lock and report
        // the real failure. First-time installs stay pending for a clean retry.
        if (upgradingExistingHome) finishHomeInstall()
        if (hasRenderableContent(d)) {
          // Generation failures leave the last file-backed surface in place.
          // Never blank or replace a usable/partially committed app with an
          // error card merely because a later model unit failed.
          toastInApp(`这次修改没画成：${message.slice(0, 80)}`)
        }
        throw err
      } finally {
        if (progressiveTimer) clearTimeout(progressiveTimer)
        completedStage?.dispose()
        stage?.dispose()
        if (genRef.current === myGen) {
          activeWriterRef.current = null
          currentStreamRef.current = ''
          setBusyLabel(null)
          busyRef.current = false
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, installRuntimeObserver, persistOpeningKit, persistTemporary, win.instanceId]
  )

  /**
   * Stream one predesigned region without sending the whole app source back to
   * the model. `navigate` may vibe-code a new interactive sub-page; `content`
   * only fills/appends the already-defined format (for example one chat reply).
   */
  const renderSlotStream = useCallback(
    async (hook: Hook): Promise<void> => {
      const d = docOf()
      const selector = hook.target?.trim() ?? ''
      const kind = hook.kind === 'content' ? 'content' : 'navigate'
      const placement = hook.placement ?? (kind === 'content' ? 'append' : 'replace')
      let liveTarget: HTMLElement
      try {
        if (!d || !selector || selector.length > 180) throw new Error('轻量 hook 缺少有效的目标区域。')
        liveTarget = requireSlotTarget(d, selector, kind)
      } catch (err) {
        if (d) notifyBrowserPageLifecycle(d, hook, 'failed', errorMessage(err))
        throw err
      }

      const templateSelector = hook.template?.trim() ?? ''
      let browserRequest: BrowserPageRequest | null = null
      let templateHtml = ''
      try {
        browserRequest = browserRequestFromHook(hook, liveTarget)
        const sourceTabId = typeof hook.detail?.sourceTabId === 'string' ? hook.detail.sourceTabId.trim() : ''
        const ownerBrowserPage = owningBrowserPage(liveTarget)
        const ownerTabId = ownerBrowserPage?.getAttribute('data-browser-tab-id')?.trim() ?? ''
        if (sourceTabId && (!ownerTabId || sourceTabId !== ownerTabId)) {
          throw new Error('浏览器内容 hook 的来源标签页与目标标签页不一致。')
        }
        if (!browserRequest && ownerBrowserPage) {
          if (kind !== 'content' || !sourceTabId || sourceTabId !== ownerTabId) {
            throw new Error('浏览器标签页内的内容 hook 缺少可信的同标签来源。')
          }
          const namespace = browserNamespace(ownerTabId)
          if (!liveTarget.id.startsWith(namespace.idPrefix) || selector !== `#${liveTarget.id}`) {
            throw new Error(`浏览器内容 hook 只能写入本标签的 #${namespace.idPrefix}… 目标。`)
          }
        }
        if (kind === 'navigate' && templateSelector) throw new Error('页面级 hook 不能使用内容模板。')
        const templateElement = templateSelector ? querySlotTarget(d, templateSelector) : null
        if (templateSelector && (!templateElement || templateElement.tagName !== 'TEMPLATE')) {
          throw new Error(`找不到内容模板：${templateSelector}`)
        }
        if (ownerBrowserPage && templateElement) {
          const templateOwner = owningBrowserPage(templateElement)
          const namespace = browserNamespace(ownerTabId)
          if (templateOwner !== ownerBrowserPage || !templateElement.id.startsWith(namespace.idPrefix)) {
            throw new Error('浏览器内容模板必须位于同一个标签页并使用该标签命名空间。')
          }
        }
        templateHtml = templateElement ? (templateElement as HTMLTemplateElement).innerHTML.trim() : ''
        if (templateHtml) {
          const ownerTabId = templateElement
            ? owningBrowserPage(templateElement)
            ?.getAttribute('data-browser-tab-id')
            ?.trim()
            : undefined
          assertSafeContentTemplate(
            d,
            templateHtml,
            templateSelector,
            ownerTabId ? browserNamespace(ownerTabId).handlerPrefix : undefined
          )
        }
      } catch (err) {
        notifyBrowserPageLifecycle(d, hook, 'failed', errorMessage(err))
        throw err
      }
      // A full-window stream and a targeted stream cannot safely edit the same
      // document concurrently, so a typed hook supersedes the former. Other
      // typed targets (notably other browser tabs) remain fully independent.
      if (currentStreamRef.current) {
        window.crazyos.cancelView(currentStreamRef.current)
        currentStreamRef.current = ''
        activeWriterRef.current = null
        genRef.current++
      }
      const slotKey = browserRequest ? `browser:${browserRequest.tabId}` : selector
      const previousSlotStream = slotStreamsRef.current.get(slotKey)
      const streamId = `${app.id}-${win.instanceId}-slot-${++streamSeq}`
      if (previousSlotStream) {
        window.crazyos.cancelView(previousSlotStream)
        slotWritersRef.current.delete(previousSlotStream)
      }
      slotStreamsRef.current.set(slotKey, streamId)
      const ownsStream = (): boolean => slotStreamsRef.current.get(slotKey) === streamId
      const hasNewerPendingBrowserRequest = (): boolean => {
        if (!browserRequest) return false
        const target = querySlotTarget(d, selector)
        const nextRequestId = target?.getAttribute('data-browser-request-id')?.trim() ?? ''
        return !!target &&
          isBrowserPageSlot(target) &&
          target.getAttribute('data-browser-tab-id')?.trim() === browserRequest.tabId &&
          target.getAttribute('aria-busy') === 'true' &&
          !!nextRequestId &&
          nextRequestId !== browserRequest.requestId
      }
      // A newer same-tab request can be visible in the iframe before its React
      // message handler has registered the replacement stream. Keep using the
      // original stable page in that hand-off window instead of treating the
      // older stream's partial DOM as the next request's baseline.
      const stableBaseline = browserRequest
        ? browserSlotBaselinesRef.current.get(slotKey)
        : undefined
      if (stableBaseline !== undefined) {
        const baselineRestore = slotApplyChainRef.current.catch(() => undefined).then(async () => {
          if (
            !ownsStream() ||
            closingRef.current ||
            !browserRequest ||
            !browserPageRequestIsPending(d, selector, browserRequest) ||
            querySlotTarget(d, selector) !== liveTarget
          ) return
          runtimeObserverRef.current?.disconnect()
          liveTarget.innerHTML = stableBaseline
          if (!browserRequest) reExec(d, liveTarget)
          ensureControlRoutes(d)
          liveDomRevisionRef.current++
          installRuntimeObserver(d)
          await commitLiveDocument()
        })
        slotApplyChainRef.current = baselineRestore
        try {
          await baselineRestore
        } catch (err) {
          if (browserRequest && browserPageRequestIsPending(d, selector, browserRequest)) {
            notifyBrowserPageLifecycle(d, hook, 'failed', errorMessage(err))
          }
          if (ownsStream()) {
            slotStreamsRef.current.delete(slotKey)
            if (browserRequest && !hasNewerPendingBrowserRequest()) browserSlotBaselinesRef.current.delete(slotKey)
          }
          throw err
        }
      }
      if (
        !ownsStream() ||
        closingRef.current ||
        (browserRequest && !browserPageRequestIsPending(d, selector, browserRequest))
      ) {
        if (ownsStream()) {
          slotStreamsRef.current.delete(slotKey)
          if (browserRequest && !hasNewerPendingBrowserRequest()) browserSlotBaselinesRef.current.delete(slotKey)
        }
        return
      }
      const generatedItemKey = `slot-${win.instanceId}-${streamSeq}`
      const baseTargetHtml = serializeRuntimeInner(liveTarget)
      if (browserRequest) browserSlotBaselinesRef.current.set(slotKey, baseTargetHtml)
      // A browser navigation must be determined by its URL/query request, not
      // by the previous website that stays visible while the next one streams.
      const compactContext = browserRequest ? '' : (liveTarget.textContent ?? '').trim().slice(-3000)
      const label = kind === 'content' ? '正在生成内容…' : '正在前往…'
      const isCurrent = (): boolean =>
        ownsStream() && !!querySlotTarget(d, selector) && (!browserRequest || browserPageRequestIsPending(d, selector, browserRequest))
      let requestWatcher: MutationObserver | null = null
      if (browserRequest) {
        const Observer = d.defaultView?.MutationObserver ?? MutationObserver
        requestWatcher = new Observer(() => {
          if (isCurrent()) return
          window.crazyos.cancelView(streamId)
          slotWritersRef.current.delete(streamId)
        })
        requestWatcher.observe(d.getElementById('browser-pages') ?? liveTarget, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-browser-request-id', 'aria-busy']
        })
      }

      busyRef.current = true
      readyErrorRef.current = null
      setBusyLabel(label)
      setPlan([])
      setDoneIds(new Set())
      emitAppStatus({
        instanceId: win.instanceId,
        appName: app.name,
        title: frameTitleRef.current,
        label,
        narrator:
          kind === 'content'
            ? `Crazy 只在 ${hook.role || selector} 中生成新内容，不会重读或重画整个应用…`
            : `Crazy 正在为 ${hook.role || selector} 流式设计目标页面…`,
        todos: []
      })

      let stage: StagedDocument | null = null
      let finalStage: StagedDocument | null = null
      let slotCommitChain: Promise<void> = Promise.resolve()
      let progressiveTimer: ReturnType<typeof setTimeout> | null = null
      let lastQueuedFragment = ''
      let snapshotInFlight = false
      let snapshotPending = false
      let snapshotsClosed = false
      let rawGeneratedHtml = ''
      const initializedUnits = new Set<string>()
      const completedUnits = new Set<string>()
      let progressiveSnapshotWarning: string | null = null

      const queueFragment = (fragment: string, completedUnitId?: string, force = false): Promise<void> | null => {
        let source: string
        try {
          source = kind === 'content'
            ? sanitizeContentSlotSource(d, cleanSlotSource(fragment))
            : prepareNavigateSlotSource(d, cleanSlotSource(fragment), browserRequest)
          if (kind === 'navigate') assertSafeNavigateFragment(d, source, browserRequest)
        } catch (err) {
          if (browserRequest && !force) {
            progressiveSnapshotWarning = errorMessage(err)
            console.warn('[AppWindow] skipped malformed progressive browser source:', err)
            return Promise.resolve()
          }
          throw err
        }
        if (!source || !isCurrent()) return null
        if (browserRequest && !hasRenderableSlotFragment(d, source)) return null
        if (!force && !completedUnitId && source === lastQueuedFragment) return null
        lastQueuedFragment = source
        const completedAtSnapshot = new Set(completedUnits)
        const previousSlotTask = slotCommitChain
        const applyTask = slotApplyChainRef.current.catch(() => undefined).then(async () => {
            // A failure blocks later snapshots of the same stream, while a
            // different tab may continue after the failed task has settled.
            await previousSlotTask
            if (!isCurrent() || closingRef.current) return
            for (let attempt = 0; attempt < 3; attempt++) {
              const capturedLiveRevision = liveDomRevisionRef.current
              const capturedBrowserTarget = browserRequest
                ? serializeRuntimeInner(requireSlotTarget(d, selector, kind))
                : null
              const candidate = createStagedRuntime(serializeRuntimeHtml(d), darkRef.current)
              try {
                const target = requireSlotTarget(candidate.doc, selector, kind)
                const shellBefore = browserRequest ? snapshotBrowserShell(candidate.doc) : null
                const boundaryBefore = kind === 'navigate' ? snapshotOutsideSlot(candidate.doc, selector) : null
                const renderedFragment = materializeSlotFragment(candidate.doc, source, templateHtml, generatedItemKey)
                if (kind === 'navigate') {
                  assertSafeNavigateFragment(candidate.doc, renderedFragment, browserRequest)
                  assertSlotFragmentIds(candidate.doc, target, renderedFragment, placement, browserRequest)
                }
                target.innerHTML = placement === 'append' ? `${baseTargetHtml}${renderedFragment}` : renderedFragment
                if (kind === 'navigate') {
                  if (!browserRequest) reExec(candidate.doc, target)
                  if (querySlotTarget(candidate.doc, selector) !== target) {
                    throw new Error('生成脚本移除了自己的目标区域，已拒绝这次页面。')
                  }
                  ensureControlRoutes(candidate.doc)
                  if (browserRequest && target.querySelector('[data-crazyos-auto-hook="true"]')) {
                    // Generic auditing can briefly mark a valid browser action
                    // as unresolved when it examines an isolated fragment with
                    // no browser runtime handlers. Repair those controls in the
                    // concrete tab namespace instead of rejecting the whole page.
                    const repairedBrowserHtml = normalizeBrowserPageRoutes(
                      candidate.doc,
                      serializeRuntimeInner(target),
                      browserRequest.tabId
                    )
                    assertSafeNavigateFragment(candidate.doc, repairedBrowserHtml, browserRequest)
                    assertSlotFragmentIds(candidate.doc, target, repairedBrowserHtml, placement, browserRequest)
                    target.innerHTML = repairedBrowserHtml
                  }
                }
                if (boundaryBefore !== null) assertOutsideSlotUnchanged(candidate.doc, selector, boundaryBefore)
                if (shellBefore !== null) assertBrowserShellUnchanged(candidate.doc, shellBefore)
                const unitInit = kind === 'navigate' && completedUnitId
                  ? documentInitializers(candidate.doc).find((entry) => entry.id === completedUnitId)
                  : undefined
                if (unitInit && !initializedUnits.has(unitInit.id)) {
                  auditSlotInitializer(candidate.doc, selector, kind, unitInit.id, browserRequest, darkRef.current)
                }
                const nextHtml = serializeRuntimeHtml(candidate.doc)
                const title = viewTitleOf(candidate.doc, app.seedTitle ?? app.name)
                if (!isCurrent() || closingRef.current) return
                await persistTemporary(nextHtml, title)
                if (!isCurrent() || closingRef.current) {
                  // The request may have been invalidated while IPC was in
                  // flight (for example the user pressed Home). Repair the
                  // temporary tail from the untouched live DOM immediately.
                  if (!closingRef.current) await commitLiveDocument()
                  return
                }
                // A browser request owns one tab body. New/switch/Go in sibling
                // tabs changes the document-wide revision but is not a conflict;
                // retry only if this exact target changed while its file write
                // was pending. Generic slots retain the document-wide guard.
                if (browserRequest) {
                  const currentTarget = requireSlotTarget(d, selector, kind)
                  if (capturedBrowserTarget !== serializeRuntimeInner(currentTarget)) continue
                } else if (liveDomRevisionRef.current !== capturedLiveRevision) continue
                const liveShellBefore = browserRequest ? snapshotBrowserShell(d) : null
                const liveBoundaryBefore = kind === 'navigate' ? snapshotOutsideSlot(d, selector) : null
                runtimeObserverRef.current?.disconnect()
                if (browserRequest) {
                  // A browser stream owns exactly one tab body. Never reconcile
                  // the whole candidate document back into live: even a valid
                  // but older candidate could otherwise delete a newly-created
                  // tab or overwrite a sibling that changed during the IPC wait.
                  const candidateTarget = requireSlotTarget(candidate.doc, selector, kind)
                  const currentTarget = requireSlotTarget(d, selector, kind)
                  reconcileChildren(d, currentTarget, candidateTarget, true)
                } else {
                  reconcileBody(d, nextHtml, true)
                }
                liveDomRevisionRef.current++
                if (liveBoundaryBefore !== null) assertOutsideSlotUnchanged(d, selector, liveBoundaryBefore)
                if (liveShellBefore !== null) assertBrowserShellUnchanged(d, liveShellBefore)
                setFrameTitle(title)
                if (completedUnitId) {
                  const liveInit = unitInit
                    ? documentInitializers(d).find((entry) => entry.id === unitInit.id && entry.source === unitInit.source)
                    : undefined
                  if (liveInit && !initializedUnits.has(completedUnitId)) {
                    invokeLiveSlotInitializer(
                      d,
                      selector,
                      kind,
                      completedUnitId,
                      browserRequest,
                      () => runtimeObserverRef.current?.disconnect(),
                      installRuntimeObserver,
                      () => {
                        liveDomRevisionRef.current++
                      }
                    )
                    initializedUnits.add(completedUnitId)
                    initializerSourcesRef.current.set(liveInit.id, liveInit.source)
                  } else {
                    installRuntimeObserver(d)
                  }
                  await commitLiveDocument()
                  setDoneIds((prev) => new Set([...prev, ...completedAtSnapshot]))
                } else {
                  installRuntimeObserver(d)
                  if (browserRequest) {
                    // The first file write may have carried an older tab shell.
                    // Put the now-merged live document at the queue tail so
                    // temporary.html contains every current tab and this slot.
                    await commitLiveDocument()
                  }
                }
                return
              } finally {
                candidate.dispose()
              }
            }
            throw new Error('目标区域在生成期间持续变化；已保留最新界面，请重试。')
          })
        // A streaming snapshot can end halfway through a target/template or
        // contain a model routing typo that the next chunk fixes. Skip only
        // that non-final frame; poisoning slotCommitChain here would prevent
        // the complete final document from ever getting a chance to validate.
        const task = force || !browserRequest
          ? applyTask
          : applyTask.catch((err: unknown) => {
              progressiveSnapshotWarning = errorMessage(err)
              console.warn('[AppWindow] skipped invalid progressive browser frame:', err)
            })
        slotApplyChainRef.current = task
        slotCommitChain = task
        return task
      }

      const queueStageSnapshot = (completedUnitId?: string, force = false): Promise<void> | null => {
        if (!isCurrent()) return null
        if (kind === 'content' || browserRequest) return queueFragment(rawGeneratedHtml, completedUnitId, force)
        if (!stage) return null
        ensureControlRoutes(stage.doc)
        const fragment = serializeRuntimeHtml(stage.doc)
        if (!fragment || !hasRenderableContent(stage.doc)) return null
        return queueFragment(fragment, completedUnitId, force)
      }

      let browserPlanAnnounced = false
      const observeBrowserStreamMarkers = (): void => {
        if (!browserRequest) return
        if (!browserPlanAnnounced) {
          const match = rawGeneratedHtml.match(/<!--\s*plan:([\s\S]*?)-->/i)
          if (match && match[1].length <= 6000) {
            try {
              const parsed = JSON.parse(match[1]) as unknown
              if (Array.isArray(parsed)) {
                const units = parsed.slice(0, 16).flatMap((item) => {
                  if (!item || typeof item !== 'object') return []
                  const id = String((item as Record<string, unknown>).id ?? '').trim().slice(0, 80)
                  const unitLabel = String((item as Record<string, unknown>).label ?? id).trim().slice(0, 120)
                  return id ? [{ id, label: unitLabel }] : []
                })
                if (units.length) {
                  browserPlanAnnounced = true
                  setPlan(units)
                  emitAppStatus({
                    instanceId: win.instanceId,
                    appName: app.name,
                    title: frameTitleRef.current,
                    label,
                    narrator: `Crazy 正在为 ${hook.role || selector} 流式设计目标页面…`,
                    todos: todosFromPlan(units, completedUnits)
                  })
                }
              }
            } catch {
              // The plan comment may still be arriving; the next chunk retries.
            }
          }
        }
        for (const match of rawGeneratedHtml.matchAll(/<!--\s*done:([^>]+?)-->/gi)) {
          const id = match[1].trim().slice(0, 80)
          if (!id || completedUnits.has(id)) continue
          completedUnits.add(id)
          setDoneIds(new Set(completedUnits))
          queueStageSnapshot(id)
        }
      }

      const runLatestSnapshot = (): void => {
        if (snapshotsClosed) return
        if (snapshotInFlight) {
          snapshotPending = true
          return
        }
        const task = queueStageSnapshot()
        if (!task) return
        snapshotInFlight = true
        const settle = (): void => {
          snapshotInFlight = false
          if (!snapshotsClosed && snapshotPending) {
            snapshotPending = false
            runLatestSnapshot()
          }
        }
        void task.then(settle, settle)
      }

      const scheduleSnapshot = (): void => {
        if (snapshotsClosed || progressiveTimer) return
        progressiveTimer = setTimeout(() => {
          progressiveTimer = null
          runLatestSnapshot()
        }, browserRequest ? 180 : kind === 'content' ? 55 : 90)
      }

      try {
        let streamWriter: ReturnType<typeof makeStreamWriter> | null = null
        if (kind === 'navigate' && !browserRequest) {
          stage = createStagedDocument(darkRef.current)
          streamWriter = makeStreamWriter(stage.doc, {
            onPlan: (units) => {
              if (!isCurrent()) return
              setPlan(units)
              emitAppStatus({
                instanceId: win.instanceId,
                appName: app.name,
                title: frameTitleRef.current,
                label,
                narrator: `Crazy 正在为 ${hook.role || selector} 流式设计目标页面…`,
                todos: todosFromPlan(units, new Set())
              })
            },
            onDone: (id) => {
              if (!isCurrent() || !stage) return
              completedUnits.add(id)
              if (progressiveTimer) {
                clearTimeout(progressiveTimer)
                progressiveTimer = null
              }
              queueStageSnapshot(id)
            }
          })
        }
        slotWritersRef.current.set(streamId, (text) => {
          if (!isCurrent()) {
            window.crazyos.cancelView(streamId)
            slotWritersRef.current.delete(streamId)
            return
          }
          rawGeneratedHtml += text
          streamWriter?.write(text)
          observeBrowserStreamMarkers()
          scheduleSnapshot()
        })
        const done = await window.crazyos.generateView(
          {
            app,
            intent: { kind: 'ui', action: hook.action, payload: payloadFromHook(hook.detail) },
            instructions: typeof hook.detail?.instructions === 'string' ? hook.detail.instructions.slice(0, 1200) : undefined,
            persistence: 'runtime',
            slot: {
              target: selector,
              kind,
              placement,
              role: hook.role?.slice(0, 240),
              template: templateSelector || undefined,
              context: compactContext
            }
          },
          streamId
        )
        if (!isCurrent()) return
        if (done.cancelled) throw new Error('已停止生成，已恢复进入此页面前的内容。')
        slotWritersRef.current.delete(streamId)
        if (progressiveTimer) {
          clearTimeout(progressiveTimer)
          progressiveTimer = null
        }
        snapshotsClosed = true
        snapshotPending = false
        const truncated = streamWriter?.finish() ?? false
        if (stage) {
          stage.doc.write(VIEW_DOC_TAIL)
          stage.doc.close()
        }
        // For a browser page, done.html below is the authoritative final
        // response. rawGeneratedHtml can contain a half live response followed
        // by a valid fallback response, so force-committing that concatenation
        // first would reject an otherwise usable final page.
        if (!browserRequest) queueStageSnapshot(undefined, true)
        await slotCommitChain
        if (!isCurrent()) return

        const fullGeneratedSource = kind === 'navigate'
          ? prepareNavigateSlotSource(d, cleanSlotSource(done.html.trim() || rawGeneratedHtml), browserRequest)
          : cleanSlotSource(done.html.trim() || rawGeneratedHtml)
        let finalFragment: string
        if (kind === 'content') {
          finalFragment = sanitizeContentSlotSource(d, fullGeneratedSource)
          if (!hasRenderableSlotFragment(d, finalFragment)) throw new Error('Crazy 没有为内容槽生成可显示的内容。')
        } else {
          assertSafeNavigateFragment(d, fullGeneratedSource, browserRequest)
          finalStage = createStagedRuntime(fullGeneratedSource, darkRef.current)
          if (!hasRenderableContent(finalStage.doc)) throw new Error('Crazy 没有为目标区域生成可显示的内容。')
          // Browser fragments are intentionally staged without the browser
          // runtime. Running generic route discovery here would mistake every
          // valid app.browser* callback for a missing handler and add a stale
          // whole-page hook. Browser-specific normalization already repaired
          // or disabled each control above.
          if (!browserRequest) ensureControlRoutes(finalStage.doc)
          finalFragment = serializeRuntimeHtml(finalStage.doc)
        }
        await (queueFragment(finalFragment, undefined, true) ?? slotCommitChain)
        if (!isCurrent()) return
        let finalized = false
        const previousSlotTask = slotCommitChain
        const finalization = slotApplyChainRef.current.catch(() => undefined).then(async () => {
          await previousSlotTask
          if (!isCurrent() || closingRef.current) return
          if (finalStage) {
            const liveInitializers = documentInitializers(d)
            for (const init of documentInitializers(finalStage.doc)) {
              if (initializedUnits.has(init.id)) continue
              if (!liveInitializers.some((entry) => entry.id === init.id && entry.source === init.source)) continue
              auditSlotInitializer(d, selector, kind, init.id, browserRequest, darkRef.current)
              invokeLiveSlotInitializer(
                d,
                selector,
                kind,
                init.id,
                browserRequest,
                () => runtimeObserverRef.current?.disconnect(),
                installRuntimeObserver,
                () => {
                  liveDomRevisionRef.current++
                }
              )
              initializedUnits.add(init.id)
              initializerSourcesRef.current.set(init.id, init.source)
            }
          }
          await commitLiveDocument()
          if (browserRequest) {
            const applied = notifyBrowserPageLifecycle(d, hook, 'ready')
            // browserPageReady clears the matching pending marker and mutates only
            // that tab's serializable state. Persist that lifecycle transition too.
            await commitLiveDocument()
            if (!applied) return
          }
          finalized = true
        })
        slotApplyChainRef.current = finalization
        slotCommitChain = finalization
        await finalization
        if (!finalized) return
        if (truncated || progressiveSnapshotWarning) toastInApp('生成中的不完整片段已自动跳过，最终页面已接好。')
        readyRef.current = true
        historyRef.current.push(
          { role: 'user', text: `[${kind}:${hook.action}] ${JSON.stringify(payloadFromHook(hook.detail) ?? {})}` },
          { role: 'assistant', text: finalFragment.slice(0, 4000) }
        )
        if (historyRef.current.length > 8) historyRef.current = historyRef.current.slice(-8)
      } catch (err) {
        if (!isCurrent()) return
        await slotCommitChain.catch(() => undefined)
        const message = errorMessage(err)
        if (browserRequest) console.error('[AppWindow] browser page finalization failed:', message, err)
        // Recovery is a document mutation too, so put it behind the same
        // cross-tab apply chain. Otherwise another tab could compose/persist a
        // candidate while this rejected slot was restoring its old content.
        let browserPagePreserved = false
        const recovery = slotApplyChainRef.current.catch(() => undefined).then(async () => {
          if (!isCurrent()) return
          if (browserRequest) {
            try {
              await restoreSlotSnapshot(
                d,
                selector,
                kind,
                baseTargetHtml,
                persistTemporary,
                installRuntimeObserver,
                isCurrent,
                () => liveDomRevisionRef.current,
                () => runtimeObserverRef.current?.disconnect(),
                () => {
                  liveDomRevisionRef.current++
                },
                app.seedTitle ?? app.name
              )
              if (!isCurrent()) return
              // Browser content is never fabricated locally. If Crazy cannot
              // finish this request, restore the previous model-authored page
              // and roll this exact tab's URL/history back through pageFailed.
              browserPagePreserved = notifyBrowserPageLifecycle(d, hook, 'failed', message)
              await commitLiveDocument().catch((persistError) => {
                console.error('[AppWindow] browser rollback persist failed:', persistError)
              })
              if (browserPagePreserved) {
                readyRef.current = true
                readyErrorRef.current = null
              }
            } catch (recoveryError) {
              console.error('[AppWindow] failed to restore the previous browser page:', recoveryError)
              installRuntimeObserver(d)
            }
            return
          }
          try {
            await restoreSlotSnapshot(
              d,
              selector,
              kind,
              baseTargetHtml,
              persistTemporary,
              installRuntimeObserver,
              isCurrent,
              () => liveDomRevisionRef.current,
              () => runtimeObserverRef.current?.disconnect(),
              () => {
                liveDomRevisionRef.current++
              },
              app.seedTitle ?? app.name
            )
          } catch (restoreError) {
            console.error('[AppWindow] failed to restore rejected slot:', restoreError)
            installRuntimeObserver(d)
          }
        })
        slotApplyChainRef.current = recovery
        await recovery
        if (browserPagePreserved) {
          toastInApp(`页面生成失败，已恢复之前页面：${message.slice(0, 58)}`)
          return
        }
        toastInApp(`这次内容没生成好：${message.slice(0, 80)}`)
        throw err
      } finally {
        if (progressiveTimer) clearTimeout(progressiveTimer)
        requestWatcher?.disconnect()
        finalStage?.dispose()
        stage?.dispose()
        slotWritersRef.current.delete(streamId)
        if (ownsStream()) {
          slotStreamsRef.current.delete(slotKey)
          if (browserRequest && !hasNewerPendingBrowserRequest()) browserSlotBaselinesRef.current.delete(slotKey)
          const stillBusy = !!currentStreamRef.current || slotStreamsRef.current.size > 0
          busyRef.current = stillBusy
          if (!stillBusy) {
            clearAppStatus(win.instanceId)
            setBusyLabel(null)
          } else {
            setBusyLabel(`正在生成 ${slotStreamsRef.current.size} 个页面…`)
          }
        } else if (!currentStreamRef.current && slotStreamsRef.current.size === 0) {
          setBusyLabel(null)
          busyRef.current = false
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, commitLiveDocument, installRuntimeObserver, persistTemporary, win.instanceId]
  )

  function payloadFromHook(detail?: Record<string, unknown>): Record<string, string> | undefined {
    if (!detail) return undefined
    const out: Record<string, string> = {}
    let remaining = 6000
    let count = 0
    for (const [k, v] of Object.entries(detail)) {
      if (count >= 24 || remaining <= 0) break
      if (v === undefined || v === null) continue
      const key = k.trim().slice(0, 80)
      if (!key || /html|source|document/i.test(key)) continue
      let value: string | null = null
      if (typeof v === 'string') value = v
      else if (typeof v === 'number' || typeof v === 'boolean') value = String(v)
      if (value === null) continue
      value = value.slice(0, Math.min(2000, remaining))
      out[key] = value
      remaining -= value.length
      count++
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  // A hook fired inside the app. Local controls never reach this path; every
  // model-backed follow-up streams logic/UI units into the existing surface.
  const onHook = useCallback(
    async (hook: Hook): Promise<void> => {
      if (homeInstallPendingRef.current) {
        // Progressive installation content can become clickable before its
        // durable home is committed. Keep only the user's latest intent and
        // replay it after the authoritative create/convert stream is ready.
        pendingHomeHookRef.current = hook
        toastInApp('首页安装完成后会继续这个操作…')
        return
      }
      if ((hook.kind === 'navigate' || hook.kind === 'content') && hook.target?.trim()) {
        await renderSlotStream(hook)
        return
      }
      const myGen = beginInteraction()
      const navLike = /navigate|open|visit|search|tab/i.test(hook.action)
      const repair = pendingKitRepairRef.current
      const persistence =
        repair ??
        (hook.action === 'continue_ui' && !hasOpeningKitRef.current ? 'create-kit' : 'runtime')
      pendingKitRepairRef.current = persistence === 'runtime' ? null : persistence

      // Every model-backed in-app hook uses the same progressive file-first
      // renderer. Local controls stay local; once a control asks Crazy for new
      // imagined UI, modules, layout and logic appear incrementally instead of
      // arriving as one completed patch.
      await renderStream(
        {
          app,
          intent: { kind: 'ui', action: hook.action, payload: payloadFromHook(hook.detail) },
          history: historyRef.current,
          instructions: typeof hook.detail?.instructions === 'string' ? hook.detail.instructions.slice(0, 1200) : undefined,
          persistence
        },
        navLike ? '正在前往…' : '正在继续…',
        myGen
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, renderSlotStream, renderStream]
  )

  const onHookRef = useRef(onHook)
  onHookRef.current = onHook

  // Live theme follow/override: toggle the iframe document's dark class without a rewrite.
  useEffect(() => {
    const html = iframeRef.current?.contentDocument?.documentElement
    if (html) html.classList.toggle('dark', effectiveDark)
  }, [effectiveDark])

  useEffect(() => {
    let disposed = false
    const offChunk = window.crazyos.onViewChunk(({ streamId, text }) => {
      if (streamId === currentStreamRef.current) activeWriterRef.current?.(text)
      else slotWritersRef.current.get(streamId)?.(text)
    })
    const onMsg = (e: MessageEvent): void => {
      // Multi-window: only react to messages from THIS window's iframe.
      if (e.source !== iframeRef.current?.contentWindow) return
      const m = e.data as { __crazyos?: string; hook?: Hook; state?: unknown; url?: unknown }
      if (m?.__crazyos === 'ask' && m.hook) {
        void onHookRef.current(m.hook).catch((err) => console.error('[AppWindow] hook failed:', err))
      }
      else if (m?.__crazyos === 'raise') focusWindow(win.instanceId)
      else if (m?.__crazyos === 'esc') closeWindow(win.instanceId)
      else if (m?.__crazyos === 'external' && typeof m.url === 'string') void window.crazyos.openExternal(m.url)
      else if (m?.__crazyos === 'save') {
        void window.crazyos.appDataSet(app.id, app.name, m.state)
        scheduleRuntimeCommit()
      } else if (m?.__crazyos === 'runtime-dirty') {
        liveDomRevisionRef.current++
        scheduleRuntimeCommit()
      }
    }
    const onFsChanged = (e: Event): void => {
      if (isOwnFs(e, fsOriginRef.current)) return
      const reloadSeq = ++hotReloadSeqRef.current
      void window.crazyos.appRuntimeGet(app.id, app.name, app.variantKey).then(async (files) => {
        if (disposed || reloadSeq !== hotReloadSeqRef.current) return
        const source = files.temporaryHtml.trim()
        if (!source || source === lastTemporaryHtmlRef.current) return
        const live = docOf()
        if (!live) return
        const candidate = createStagedRuntime(source, darkRef.current)
        try {
          if (!hasRenderableContent(candidate.doc)) {
            toastInApp('temporary.html 暂时没有完整界面，已保留当前画面')
            return
          }
          normalizeOrphanBrowserPending(candidate.doc, (tabId) => browserSlotBaselinesRef.current.get(`browser:${tabId}`))
          ensureControlRoutes(candidate.doc)
          const candidateHtml = serializeRuntimeHtml(candidate.doc)
          const title = viewTitleOf(candidate.doc, files.title || app.name)
          if (disposed || reloadSeq !== hotReloadSeqRef.current) return
          const completingHomeFromFile = homeInstallPendingRef.current && busyRef.current
          const hotGen = beginInteraction()
          busyRef.current = true
          setBusyLabel(completingHomeFromFile ? '正在应用首页文件…' : '正在同步 temporary.html…')
          try {
            // This reload is an explicit external file edit, so adopt its
            // revisions only after validation. During first install/conversion,
            // the edited temporary file becomes the durable home atomically.
            longTermRevisionRef.current = files.longTermUpdatedAt
            runtimeRevisionRef.current = files.temporaryUpdatedAt
            if (completingHomeFromFile) await persistOpeningKit(candidateHtml, title)
            else if (candidateHtml !== source) await persistTemporary(candidateHtml, title)
            if (disposed || reloadSeq !== hotReloadSeqRef.current || genRef.current !== hotGen) return
            runtimeObserverRef.current?.disconnect()
            reconcileBody(live, candidateHtml, true)
            liveDomRevisionRef.current++
            installRuntimeObserver(live)
            invokeChangedInitializers(candidate.doc, live)
            await commitLiveDocument()
            if (disposed || reloadSeq !== hotReloadSeqRef.current || genRef.current !== hotGen) return
            lastTemporaryHtmlRef.current = serializeRuntimeHtml(live)
            setFrameTitle(title)
            readyErrorRef.current = null
            readyRef.current = true
            if (completingHomeFromFile) finishHomeInstall()
            toastInApp('temporary.html 已实时同步到应用')
          } catch (err) {
            console.error('[AppWindow] runtime hot reload failed:', err)
            toastInApp('temporary.html 同步失败，已保留当前画面')
          } finally {
            if (reloadSeq === hotReloadSeqRef.current && genRef.current === hotGen) {
              busyRef.current = false
              setBusyLabel(null)
            }
          }
        } finally {
          candidate.dispose()
        }
      }).catch((err) => {
        if (reloadSeq === hotReloadSeqRef.current) {
          console.error('[AppWindow] runtime hot reload read failed:', err)
        }
      })
    }
    window.addEventListener('message', onMsg)
    window.addEventListener(FS_CHANGED_EVENT, onFsChanged)

    const boot = async (): Promise<void> => {
      const d = docOf()
      if (!d) throw new Error('应用 iframe 尚未就绪')
      const openingDisposition = win.openPlan?.disposition
      const firstInstall = openingDisposition === 'create'
      const convertingMode = openingDisposition === 'convert-mode'

      let files: AppRuntimeFiles
      if (firstInstall) {
        setBusyLabel('正在安装…')
        const artifacts = installArtifacts(app.variantKey)
        writeDocFull(d, installerHtml(app.name, app.variantKey, 0), darkRef.current)
        const installTodos = artifacts.map((file, index) => ({ id: file, label: `创建 ${file}`, done: index < 0 }))
        emitAppStatus({
          instanceId: win.instanceId,
          appName: app.name,
          title: app.name,
          label: '正在安装应用…',
          narrator: `正在为 ${app.name} 创建三个直接运行文件…`,
          todos: installTodos
        })

        let completedFiles: AppRuntimeFiles | null = null
        const steps = ['data', 'long-term', 'temporary'] as const
        for (let index = 0; index < steps.length; index++) {
          completedFiles = await window.crazyos.appScaffoldEnsure(app.id, app.name, app.variantKey, steps[index])
          if (disposed) return
          dispatchFs(fsOriginRef.current)
          reconcileBody(d, installerHtml(app.name, app.variantKey, index + 1), true)
          emitAppStatus({
            instanceId: win.instanceId,
            appName: app.name,
            title: app.name,
            label: '正在安装应用…',
            narrator: index + 1 === steps.length ? '运行文件已创建，正在启动首页…' : `已创建 ${artifacts[index]}…`,
            todos: artifacts.map((file, todoIndex) => ({ id: file, label: `创建 ${file}`, done: todoIndex <= index }))
          })
          // Give the real filesystem event and the progress transition one
          // paint before the next artifact is created.
          await new Promise((resolve) => setTimeout(resolve, 140))
        }
        files = completedFiles ?? (await window.crazyos.appRuntimeGet(app.id, app.name, app.variantKey))
      } else if (convertingMode) {
        // A new explicit mode gets its own long-term/temporary pair, but keeps
        // the source mode visible while the target is streamed into place.
        await window.crazyos.appScaffoldEnsure(app.id, app.name, app.variantKey, 'data')
        await window.crazyos.appScaffoldEnsure(app.id, app.name, app.variantKey, 'long-term')
        files =
          (await window.crazyos.appScaffoldEnsure(app.id, app.name, app.variantKey, 'temporary')) ??
          (await window.crazyos.appRuntimeGet(app.id, app.name, app.variantKey))
        dispatchFs(fsOriginRef.current)
      } else {
        files = await window.crazyos.appRuntimeGet(app.id, app.name, app.variantKey)
      }

      // The iframe always boots from the actual temporary.html returned by the
      // filesystem service. seedHtml is only discovery metadata; it is never a
      // parallel runtime source.
      runtimeRevisionRef.current = files.temporaryUpdatedAt
      longTermRevisionRef.current = files.longTermUpdatedAt
      let source = files.temporaryHtml.trim()
      let durableReady = false
      let durableTitle = files.title || app.seedTitle || app.name

      if (convertingMode) {
        hasOpeningKitRef.current = false
        pendingKitRepairRef.current = 'create-kit'
        const baseline = app.seedHtml?.trim()
        if (baseline) {
          writeDocFull(d, baseline, darkRef.current)
          rememberInitializers(d)
          const baselineTitle = viewTitleOf(d, app.seedTitle || app.name)
          const baselineHtml = serializeRuntimeHtml(d)
          setFrameTitle(baselineTitle)
          await persistTemporary(baselineHtml, baselineTitle)
          installRuntimeObserver(d)
          historyRef.current = [{ role: 'assistant', text: baselineHtml }]
        } else {
          writeDocFull(
            d,
            `<main data-crazy-app-placeholder="true" style="min-height:100%;display:grid;place-items:center;padding:28px"><section class="card"><div class="title">正在转换模式…</div><p class="muted">${escapeHtml(app.name)} 正在准备 ${escapeHtml(app.variantKey ?? '新')} 模式</p></section></main>`,
            darkRef.current
          )
        }
        await renderStream(
          {
            app,
            intent: { kind: 'open', action: 'convert_mode' },
            instructions: win.instructions,
            persistence: 'create-kit'
          },
          '正在转换模式…'
        )
        return
      }

      // Audit the durable source in a clean document that deliberately does
      // not run init_*. This lets us persist only actual route repairs and
      // prevents session state, timestamps, focus, or initialized form values
      // from leaking into long-term.html.
      if (!isScaffoldPlaceholderHtml(files.longTermHtml)) {
        let durableAudit: StagedDocument | null = null
        try {
          durableAudit = createStagedRuntime(files.longTermHtml, darkRef.current)
          durableReady = hasRenderableContent(durableAudit.doc)
          if (durableReady) {
            const routeChanges = ensureControlRoutes(durableAudit.doc)
            durableTitle = viewTitleOf(durableAudit.doc, durableTitle)
            if (routeChanges > 0) {
              const repaired = serializeRuntimeHtml(durableAudit.doc, false)
              await persistOpeningKit(repaired, durableTitle)
              source = repaired
            }
          }
        } catch (err) {
          console.error('[AppWindow] durable source audit failed; regenerating:', err)
          durableReady = false
        } finally {
          durableAudit?.dispose()
        }
      }
      hasOpeningKitRef.current = durableReady

      if (durableReady) {
        writeDocFull(d, source || files.longTermHtml, darkRef.current)
        rememberInitializers(d)
        const title = viewTitleOf(d, durableTitle)
        const runtimeHtml = serializeRuntimeHtml(d)
        setFrameTitle(title)
        historyRef.current = [{ role: 'assistant', text: runtimeHtml }]
        // Initializers may intentionally materialize runtime-only values. Keep
        // temporary.html byte-aligned with the live page without promoting
        // those values into the durable opening kit.
        await persistTemporary(runtimeHtml, title)
        installRuntimeObserver(d)
        readyRef.current = true
        busyRef.current = false
        setBusyLabel(null)
        if (win.instructions) {
          const hint = String(win.instructions).toLowerCase()
          const sensitive = /privacy|private|隐私|私人|隐藏/.test(hint)
          if (sensitive) {
            emitPendingConfirmation({
              id: `${app.id}:${app.variantKey ?? 'default'}:reopen`,
              source: 'reopen',
              appName: app.name,
              variantKey: app.variantKey ?? 'default',
              message: 'This reopen request may change privacy-sensitive content or scope. Confirm before updating the current app.',
              payload: { name: app.name, icon: app.icon, tagline: app.tagline, instructions: win.instructions, mode: app.variantKey }
            })
            emitAppStatus({
              instanceId: win.instanceId,
              appName: app.name,
              title: frameTitleRef.current,
              label: 'Needs confirmation',
              todos: [{ id: 'privacy-check', label: 'Ask the user before changing privacy-sensitive content or scope.', done: false }]
            })
          } else {
            await onHookRef.current({ action: 'continue_ui', detail: { instructions: win.instructions, source: 'reopen' } })
          }
        }
      } else {
        if (!firstInstall) {
          const placeholder = isScaffoldPlaceholderHtml(source)
            ? source
            : '<main data-crazy-app-placeholder="true" aria-label="应用安装占位"></main>'
          writeDocFull(d, placeholder, darkRef.current)
        }
        lastTemporaryHtmlRef.current = isScaffoldPlaceholderHtml(source) ? source : ''
        await renderStream(
          { app, intent: { kind: 'open', action: 'open' }, instructions: win.instructions, persistence: 'create-kit' },
          'Opening…'
        )
      }
    }
    void boot().catch((err) => {
      const message = String(err instanceof Error ? err.message : err)
      readyErrorRef.current = message
      busyRef.current = false
      setBusyLabel(null)
      clearAppStatus(win.instanceId)
      console.error('[AppWindow] boot failed:', err)
    })
    return () => {
      disposed = true
      closingRef.current = true
      offChunk()
      window.removeEventListener('message', onMsg)
      window.removeEventListener(FS_CHANGED_EVENT, onFsChanged)
      runtimeObserverRef.current?.disconnect()
      if (runtimeCommitTimerRef.current) clearTimeout(runtimeCommitTimerRef.current)
      clearAppStatus(win.instanceId)
      // Closing the window aborts its in-flight generation (token + safety hygiene).
      if (currentStreamRef.current) window.crazyos.cancelView(currentStreamRef.current)
      for (const streamId of slotStreamsRef.current.values()) window.crazyos.cancelView(streamId)
      slotStreamsRef.current.clear()
      slotWritersRef.current.clear()
      browserSlotBaselinesRef.current.clear()
      // The temporary file is a live scratchpad, never a second durable state.
      void resetTemporaryOnce().catch((err) => console.warn('[AppWindow] runtime already removed before close:', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, renderStream])

  // Expose this window to the system agent (tools run in the renderer, over a registry).
  useEffect(() => {
    registerWindow(win.instanceId, {
      isBusy: () => busyRef.current || !readyRef.current,
      getHtml: () => {
        const d = docOf()
        return d ? serializeRuntimeHtml(d) : null
      },
      applyOps: async (ops) => {
        const d = docOf()
        if (!d) return { applied: 0, missed: ops.map((o) => o.selector) }
        busyRef.current = true
        setBusyLabel('正在应用修改…')
        emitAppStatus({
          instanceId: win.instanceId,
          appName: app.name,
          title: frameTitleRef.current,
          label: '正在应用修改…',
          narrator: `正在把 crazy 助手的局部修改同步到 ${app.name} 与 temporary.html…`,
          todos: []
        })
        try {
          let lastResult = { applied: 0, missed: ops.map((op) => op.selector) }
          for (let attempt = 0; attempt < 3; attempt++) {
            const capturedLiveRevision = liveDomRevisionRef.current
            const candidate = createStagedRuntime(serializeRuntimeHtml(d), darkRef.current)
            try {
              const result = applyOpsCounted(candidate.doc, ops)
              lastResult = result
              if (result.applied === 0) return result
              const audited = createAuditedRuntime(serializeRuntimeHtml(candidate.doc), darkRef.current)
              try {
                const nextHtml = serializeRuntimeHtml(audited.doc)
                const title = viewTitleOf(audited.doc, app.seedTitle ?? app.name)
                await persistTemporary(nextHtml, title)
                if (liveDomRevisionRef.current !== capturedLiveRevision) {
                  await commitLiveDocument()
                  continue
                }
                runtimeObserverRef.current?.disconnect()
                reconcileBody(d, nextHtml, true)
                liveDomRevisionRef.current++
                setFrameTitle(title)
                installRuntimeObserver(d)
                invokeChangedInitializers(audited.doc, d)
                await commitLiveDocument()
                return result
              } finally {
                audited.dispose()
              }
            } finally {
              candidate.dispose()
            }
          }
          await commitLiveDocument()
          return lastResult
        } finally {
          busyRef.current = false
          setBusyLabel(null)
          clearAppStatus(win.instanceId)
        }
      },
      update: (instructions, persistence = 'runtime') => {
        if (persistence === 'create-kit' || persistence === 'upgrade-kit') {
          recentHomeInstallUntilRef.current = 0
          pendingKitRepairRef.current = persistence
          homeInstallPendingRef.current = true
        }
        return onHookRef.current({ action: 'continue_ui', detail: { instructions, source: 'reopen' } })
      },
      regenerate: (instructions, persistence = 'runtime') => {
        return renderStream(
          { app, intent: { kind: 'ui', action: 'regenerate' }, history: historyRef.current, instructions, persistence },
          persistence === 'upgrade-kit' ? '正在升级应用…' : '正在重画…'
        )
      },
      waitUntilReady: async (timeoutMs = 90_000) => {
        const deadline = Date.now() + timeoutMs
        for (;;) {
          if (!busyRef.current && readyErrorRef.current) throw new Error(readyErrorRef.current)
          if (!busyRef.current && readyRef.current && !homeInstallPendingRef.current) return
          if (Date.now() > deadline) throw new Error('应用窗口超过超时时间仍未准备好')
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      },
      isHomeInstallPending: () => homeInstallPendingRef.current || Date.now() < recentHomeInstallUntilRef.current,
      resetTemporary: async () => {
        await resetTemporaryOnce()
      },
      appKey: () => `${app.id}::${app.variantKey ?? 'default'}`
    })
    return () => unregisterWindow(win.instanceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.instanceId])

  return (
    <WindowFrame win={win} title={app.name}>
      <iframe
        ref={iframeRef}
        title={app.name}
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
        tabIndex={installInteractionLocked ? -1 : 0}
        className={`h-full w-full border-none bg-transparent ${installInteractionLocked ? 'pointer-events-none' : ''}`}
      />
      {busyLabel && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border-2 border-ink bg-card/90 px-3 py-1 text-sm text-ink/70 shadow-doodle">
          <span className="animate-[wiggle_0.9s_ease-in-out_infinite]">✎</span> {busyLabel}
        </div>
      )}
    </WindowFrame>
  )
}

// --- streaming + sentinel parsing + immediate script execution ---------------------

interface WriterEvents {
  onPlan: (units: PlanUnit[]) => void
  onDone: (unitId: string) => void
}

/**
 * Streams non-<script> HTML straight into the open document, but:
 *  * <script>…</script> — held back until complete, then executed IMMEDIATELY
 *    (wrapped in try/catch → the in-app "有个部件没画好" surface), so handlers exist
 *    before/with their UI instead of only after the whole stream closes
 *  * <!--plan:…--> / <!--done:…--> — stripped from the document and surfaced as events
 *  * any '<' that might start one of the above is held back across chunk boundaries,
 *    so sentinels split across SSE chunks are never torn
 * finish() returns true if the stream ended inside an unterminated <script> (i.e. the
 * generation was truncated — the caller surfaces that instead of leaving dead buttons).
 */
function makeStreamWriter(
  d: Document,
  ev: WriterEvents
): { write: (t: string) => void; finish: () => boolean } {
  let buf = ''
  const HOLD = 9 // longest ambiguous prefix: '<script' (7) / '<!--' (4) + slack

  const write = (text: string): void => {
    buf += text
    for (;;) {
      const lower = buf.toLowerCase()
      const si = lower.indexOf('<script')
      const ci = buf.indexOf('<!--')
      let idx: number
      let kind: 'script' | 'comment'
      if (si !== -1 && (ci === -1 || si < ci)) {
        idx = si
        kind = 'script'
      } else if (ci !== -1) {
        idx = ci
        kind = 'comment'
      } else {
        // no marker start in the buffer — flush all but a small holdback window
        if (buf.length > HOLD) {
          d.write(buf.slice(0, buf.length - HOLD))
          buf = buf.slice(buf.length - HOLD)
        }
        return
      }
      if (idx > 0) {
        d.write(buf.slice(0, idx))
        buf = buf.slice(idx)
        continue
      }
      if (kind === 'script') {
        const end = lower.indexOf('</script>', idx)
        if (end === -1) return // wait for the rest of this script
        execScriptTag(d, buf.slice(0, end + 9))
        buf = buf.slice(end + 9)
      } else {
        const end = buf.indexOf('-->')
        if (end === -1) return // wait for the comment to close
        handleComment(buf.slice(0, end + 3))
        buf = buf.slice(end + 3)
      }
    }
  }

  const handleComment = (comment: string): void => {
    const inner = comment.slice(4, -3).trim()
    if (inner.startsWith('plan:')) {
      try {
        const units = JSON.parse(inner.slice(5)) as PlanUnit[]
        if (Array.isArray(units)) {
          ev.onPlan(units.filter((u) => u && typeof u.id === 'string').slice(0, 12))
        }
      } catch {
        // malformed plan — progress falls back to indeterminate; never break rendering
      }
    } else if (inner.startsWith('done:')) {
      ev.onDone(inner.slice(5).trim())
    } else {
      d.write(comment) // an ordinary comment the model wrote — pass through
    }
  }

  const finish = (): boolean => {
    const truncatedScript = buf.toLowerCase().includes('<script')
    if (buf && !truncatedScript) d.write(buf)
    buf = ''
    return truncatedScript
  }

  return { write, finish }
}

/** Execute one complete <script> tag against the live document, error-contained. */
function execScriptTag(d: Document, tag: string): void {
  const tmp = d.createElement('div')
  tmp.innerHTML = tag
  const old = tmp.querySelector('script')
  if (!old) return
  const s = d.createElement('script')
  for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value)
  // Model scripts must only define app.* functions; a top-level DOM touch on
  // not-yet-written HTML throws — contain it and surface the sketchy-toast.
  const source = old.textContent ?? ''
  s.textContent = `try{\n${source}\n}catch(err){(window.__unitError||console.error)(err)}`
  ;(s as ExecutedScript).__crazySource = source
  ;(d.body ?? d.documentElement).appendChild(s)
}

type ExecutedScript = HTMLScriptElement & { __crazySource?: string }

function scriptSource(script: HTMLScriptElement): string {
  return (script as ExecutedScript).__crazySource ?? script.textContent ?? ''
}

interface StagedDocument {
  doc: Document
  dispose(): void
}

/** A hidden document receives whole-page model streams while the current app
 * remains visible and usable. Completed units are morphed across progressively. */
function createStagedDocument(dark: boolean): StagedDocument {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
  frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;opacity:0;pointer-events:none'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    throw new Error('无法创建应用的无闪烁 staging 文档')
  }
  doc.open()
  doc.write(viewDocHead(location.origin, dark))
  return { doc, dispose: () => frame.remove() }
}

/** Load an existing runtime source into an off-screen document. Patches and
 * direct agent operations are applied here, then committed to temporary.html
 * before the resulting tree is reconciled into the visible iframe. */
function createStagedRuntime(html: string, dark: boolean): StagedDocument {
  const stage = createStagedDocument(dark)
  const sw = makeStreamWriter(stage.doc, { onPlan: () => undefined, onDone: () => undefined })
  sw.write(html)
  if (sw.finish()) {
    stage.dispose()
    throw new Error('temporary.html 含有未闭合的 script，已保留当前运行界面。')
  }
  stage.doc.write(VIEW_DOC_TAIL)
  stage.doc.close()
  return stage
}

function createAuditedRuntime(html: string, dark: boolean): StagedDocument {
  const stage = createStagedRuntime(html, dark)
  ensureControlRoutes(stage.doc)
  if (!hasRenderableContent(stage.doc)) {
    stage.dispose()
    throw new Error('候选修改没有留下可见的应用界面。')
  }
  return stage
}

function ownedChildren(parent: ParentNode): Node[] {
  return Array.from(parent.childNodes).filter((node) => node.nodeType !== 1 || !(node as Element).matches('[data-crazyos-host]'))
}

function nodeKey(node: Node): string | null {
  if (node.nodeType !== 1) return null
  const el = node as Element
  const id = el.getAttribute('id')?.trim()
  if (id) return `id:${id}`
  const stable = el.getAttribute('data-crazyos-key')?.trim() || el.getAttribute('data-region')?.trim()
  return stable ? `key:${stable}` : null
}

function compatibleNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false
  if (a.nodeType !== 1) return true
  const aa = a as Element
  const bb = b as Element
  const ak = nodeKey(a)
  const bk = nodeKey(b)
  if (ak || bk) return ak === bk && aa.tagName === bb.tagName
  return aa.tagName === bb.tagName
}

function copyAttributes(current: Element, target: Element): void {
  for (const attr of Array.from(current.attributes)) {
    if (!target.hasAttribute(attr.name)) current.removeAttribute(attr.name)
  }
  for (const attr of Array.from(target.attributes)) current.setAttribute(attr.name, attr.value)
  if (current.tagName === 'INPUT') {
    const c = current as HTMLInputElement
    const t = target as HTMLInputElement
    c.value = t.getAttribute('value') ?? t.value
    c.checked = t.hasAttribute('checked') || t.checked
  } else if (current.tagName === 'TEXTAREA') {
    ;(current as HTMLTextAreaElement).value = (target as HTMLTextAreaElement).value
  } else if (current.tagName === 'SELECT') {
    ;(current as HTMLSelectElement).selectedIndex = (target as HTMLSelectElement).selectedIndex
  }
}

function executableClone(d: Document, target: Node): Node {
  if (target.nodeType === 1 && (target as Element).tagName === 'SCRIPT') {
    const old = target as HTMLScriptElement
    const script = d.createElement('script')
    for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value)
    const source = scriptSource(old)
    script.textContent = `try{\n${source}\n}catch(err){(window.__unitError||console.error)(err)}`
    ;(script as ExecutedScript).__crazySource = source
    return script
  }
  const clone = d.importNode(target, true)
  if (clone.nodeType === 1) reExec(d, clone as Element)
  return clone
}

function morphNode(d: Document, current: Node, target: Node, removeMissing: boolean): Node {
  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== target.nodeValue) current.nodeValue = target.nodeValue
    return current
  }
  const currentEl = current as Element
  const targetEl = target as Element
  if (currentEl.tagName === 'SCRIPT') {
    const currentScript = currentEl as HTMLScriptElement
    const targetScript = targetEl as HTMLScriptElement
    if (scriptSource(currentScript) === scriptSource(targetScript) && currentEl.attributes.length === targetEl.attributes.length) return current
    const fresh = executableClone(d, target)
    current.parentNode?.replaceChild(fresh, current)
    return fresh
  }
  copyAttributes(currentEl, targetEl)
  reconcileChildren(d, currentEl, targetEl, removeMissing)
  return current
}

function reconcileChildren(d: Document, currentParent: ParentNode, targetParent: ParentNode, removeMissing: boolean): void {
  const desired = ownedChildren(targetParent).filter((node) => {
    if (node.nodeType !== Node.COMMENT_NODE) return true
    return !/^\s*(?:plan:|done:)/.test(node.nodeValue ?? '')
  })
  let anchor: Node | null = ownedChildren(currentParent)[0] ?? null

  for (const target of desired) {
    const targetKey = nodeKey(target)
    const candidates = ownedChildren(currentParent)
    let match: Node | null = targetKey ? candidates.find((node) => nodeKey(node) === targetKey) ?? null : anchor
    if (match && !compatibleNode(match, target)) match = null

    if (!match) {
      match = executableClone(d, target)
      const hostTail = Array.from(currentParent.childNodes).find((node) => node.nodeType === 1 && (node as Element).matches('[data-crazyos-host]')) ?? null
      currentParent.insertBefore(match, anchor ?? hostTail)
    } else if (match !== anchor) {
      currentParent.insertBefore(match, anchor)
    }
    match = morphNode(d, match, target, removeMissing)
    const rest = ownedChildren(currentParent)
    anchor = rest[rest.indexOf(match) + 1] ?? null
  }

  if (removeMissing) {
    while (anchor) {
      const next: Node | null = ownedChildren(currentParent)[ownedChildren(currentParent).indexOf(anchor) + 1] ?? null
      anchor.parentNode?.removeChild(anchor)
      anchor = next
    }
  }
}

/** Reconcile without ever exposing an empty body. Stable keyed nodes keep their
 * identity, focus and scroll; only nodes absent from the final source are removed. */
function reconcileBody(d: Document, html: string, removeMissing: boolean): void {
  if (!d.body) return
  const template = d.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('[data-crazyos-host]').forEach((el) => el.remove())
  const active = d.activeElement as HTMLElement | null
  const activeKey = active ? nodeKey(active) : null
  const scrollX = d.defaultView?.scrollX ?? 0
  const scrollY = d.defaultView?.scrollY ?? 0
  reconcileChildren(d, d.body, template.content, removeMissing)
  if (activeKey) {
    const wanted = Array.from(d.body.querySelectorAll<HTMLElement>('*')).find((el) => nodeKey(el) === activeKey)
    wanted?.focus({ preventScroll: true })
  }
  d.defaultView?.scrollTo(scrollX, scrollY)
}

// Write a full fresh document (used for a 'replace' patch), running its scripts reliably.
function writeDocFull(d: Document, html: string, dark: boolean): void {
  d.open()
  d.write(viewDocHead(location.origin, dark))
  const doneIds: string[] = []
  const sw = makeStreamWriter(d, { onPlan: () => {}, onDone: (id) => doneIds.push(id) })
  sw.write(html)
  sw.finish()
  d.write(VIEW_DOC_TAIL)
  d.close()
  const w = d.defaultView as (Window & { app?: Record<string, unknown> }) | null
  if (!w?.app) return
  // done sentinels are stream transport metadata and are intentionally absent
  // from long-term/temporary files. On a file-backed reopen, discover the
  // persisted init_* functions so keyboard listeners, focus, and other one-time
  // setup are restored just as they were during the original stream.
  const initIds = new Set(doneIds)
  if (initIds.size === 0) {
    for (const key of Object.keys(w.app)) {
      if (key.startsWith('init_') && typeof w.app[key] === 'function') initIds.add(key.slice(5))
    }
  }
  for (const id of initIds) {
    const fn = w.app[`init_${id}`]
    if (typeof fn === 'function') {
      try {
        ;(fn as () => void)()
      } catch (err) {
        console.error('[AppWindow] unit init after full write failed:', err)
      }
    }
  }
}

// --- agent DOM operations ---------------------------------------------------------

/** Apply explicit patch_app operations and report which selectors matched. */
function applyOpsCounted(d: Document, ops: MutateOp[]): { applied: number; missed: string[] } {
  let applied = 0
  const missed: string[] = []
  for (const op of ops) {
    if (applyOp(d, op)) applied++
    else missed.push(op.selector)
  }
  return { applied, missed }
}

function applyOp(d: Document, op: MutateOp): boolean {
  const el = d.querySelector(op.selector)
  if (!el) return false
  switch (op.op) {
    case 'replaceInner':
      el.innerHTML = op.html
      reExec(d, el)
      break
    case 'replaceOuter':
      insertHtml(d, el, op.html, 'replace')
      break
    case 'append':
      insertHtml(d, el, op.html, 'append')
      break
    case 'remove':
      el.remove()
      break
    case 'setText':
      el.textContent = op.text
      break
    case 'setAttr':
      el.setAttribute(op.name, op.value)
      break
  }
  return true
}

function insertHtml(d: Document, target: Element, html: string, mode: 'append' | 'replace'): void {
  const tmp = d.createElement('div')
  tmp.innerHTML = html
  const nodes = Array.from(tmp.childNodes)
  if (mode === 'replace') target.replaceWith(...nodes)
  else nodes.forEach((n) => target.appendChild(n))
  nodes.forEach((n) => {
    if (n.nodeType === 1) reExec(d, n as Element)
  })
}

function reExec(d: Document, root: Element): void {
  const scripts = root.tagName === 'SCRIPT' ? [root] : Array.from(root.querySelectorAll('script'))
  scripts.forEach((old) => {
    const s = d.createElement('script')
    for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value)
    const source = scriptSource(old as HTMLScriptElement)
    s.textContent = `try{\n${source}\n}catch(err){(window.__unitError||console.error)(err)}`
    ;(s as ExecutedScript).__crazySource = source
    old.replaceWith(s)
  })
}

function querySlotTarget(d: Document, selector: string): HTMLElement | null {
  try {
    return d.querySelector<HTMLElement>(selector)
  } catch {
    return null
  }
}

interface BrowserPageRequest {
  tabId: string
  requestId: string
}

function persistedBrowserTitle(url: string): string {
  if (url === 'crazy://home') return '新标签页'
  if (/^crazy:\/\/reader/i.test(url)) {
    try {
      return new URL(url).searchParams.get('title') || '阅读页面'
    } catch {
      return '阅读页面'
    }
  }
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const engine = host === 'google.com' || host.endsWith('.google.com') || /^google\.[a-z.]+$/.test(host)
      ? { label: 'Google', key: 'q' }
      : host === 'baidu.com' || host.endsWith('.baidu.com')
        ? { label: '百度', key: 'wd' }
        : host === 'bing.com' || host.endsWith('.bing.com')
          ? { label: 'Bing', key: 'q' }
          : null
    if (engine) {
      const query = parsed.searchParams.get(engine.key)
      return query ? `${query} - ${engine.label}` : engine.label
    }
    return parsed.hostname || '页面'
  } catch {
    return '页面'
  }
}

/**
 * A direct edit of temporary.html is authoritative and therefore cancels any
 * in-flight page streams. Pending browser state is transient, however: keeping
 * it in the edited document would leave a tab permanently busy with no stream
 * left to call browserPageReady/browserPageFailed. Roll every pending tab back
 * to its pre-request history and, when available, its exact stable live slot.
 */
function normalizeOrphanBrowserPending(
  d: Document,
  baselineForTab: (tabId: string) => string | undefined
): void {
  const root = d.getElementById('crazy-browser')
  const pages = d.getElementById('browser-pages')
  if (!root || !pages) return

  const slots = Array.from(pages.children).filter(
    (node): node is HTMLElement => node.nodeType === 1 && isBrowserPageSlot(node)
  )
  const slotFor = (tabId: string): HTMLElement | undefined =>
    slots.find((slot) => slot.getAttribute('data-browser-tab-id')?.trim() === tabId)
  const restoreSlot = (tabId: string, pageUrl?: string): void => {
    const slot = slotFor(tabId)
    if (!slot) return
    const baseline = baselineForTab(tabId)
    if (baseline !== undefined) slot.innerHTML = baseline
    slot.removeAttribute('data-browser-request-url')
    slot.removeAttribute('data-browser-request-id')
    slot.setAttribute('aria-busy', 'false')
    if (pageUrl) slot.setAttribute('data-browser-page-url', pageUrl)
  }

  const rawState = root.getAttribute('data-browser-state')
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState) as Record<string, unknown>
      if (parsed && Array.isArray(parsed.tabs)) {
        for (const entry of parsed.tabs) {
          if (!entry || typeof entry !== 'object') continue
          const tab = entry as Record<string, unknown>
          const tabId = typeof tab.id === 'string' ? tab.id.trim() : ''
          const pending = tab.pending
          if (!tabId || !pending || typeof pending !== 'object') continue

          const pendingRecord = pending as Record<string, unknown>
          const previousHistory = Array.isArray(pendingRecord.previousHistory)
            ? pendingRecord.previousHistory.filter((value): value is string => typeof value === 'string' && !!value)
            : []
          if (previousHistory.length) {
            tab.history = previousHistory.slice()
            const requestedCursor = Number(pendingRecord.previousCursor)
            const cursor = Number.isFinite(requestedCursor) ? Math.trunc(requestedCursor) : 0
            tab.cursor = Math.max(0, Math.min(cursor, previousHistory.length - 1))
          }
          tab.pending = null

          const history = Array.isArray(tab.history) ? tab.history : []
          const cursor = typeof tab.cursor === 'number' && Number.isFinite(tab.cursor) ? Math.trunc(tab.cursor) : 0
          const pageUrl = typeof history[cursor] === 'string' ? history[cursor] : undefined
          tab.title = typeof pendingRecord.previousTitle === 'string' && pendingRecord.previousTitle.trim()
            ? pendingRecord.previousTitle
            : persistedBrowserTitle(pageUrl ?? '')
          restoreSlot(tabId, pageUrl)
        }
        root.setAttribute('data-browser-state', JSON.stringify(parsed))
      }
    } catch {
      // A malformed state blob is handled by the browser runtime's normal
      // fallback. The DOM cleanup below still guarantees there is no spinner.
    }
  }

  // Be defensive when a hand-edited file changed the state blob and the slot
  // attributes independently. Every visible request marker is orphaned once
  // this external document supersedes the active streams.
  for (const slot of slots) {
    if (slot.hasAttribute('data-browser-request-id') || slot.getAttribute('aria-busy') === 'true') {
      restoreSlot(slot.getAttribute('data-browser-tab-id')?.trim() ?? '')
    }
  }
  const pending = d.getElementById('browser-page-pending')
  if (pending) {
    pending.hidden = true
    pending.textContent = ''
  }
  const status = d.getElementById('browser-status')
  if (status) status.textContent = 'Crazy 页面浏览'
}

function errorMessage(err: unknown): string {
  return String(err instanceof Error ? err.message : err)
}

function isBrowserPageSlot(el: Element): boolean {
  return el.matches('.browser-page-slot[data-browser-tab-id]') && el.parentElement?.id === 'browser-pages'
}

function owningBrowserPage(el: Element): HTMLElement | null {
  let cursor: Element | null = el
  while (cursor) {
    const candidate = cursor.closest('.browser-page-slot[data-browser-tab-id]') as HTMLElement | null
    if (!candidate) return null
    if (isBrowserPageSlot(candidate)) return candidate
    cursor = candidate.parentElement
  }
  return null
}

/** Resolve a model-writable boundary. A selector alone is never authority to
 * rewrite arbitrary app chrome: the opening kit must explicitly mark a typed
 * slot, while browser page slots use their stricter runtime-owned marker. */
function requireSlotTarget(d: Document, selector: string, kind: 'navigate' | 'content'): HTMLElement {
  const target = querySlotTarget(d, selector)
  if (!target) throw new Error(`找不到内容槽：${selector}`)
  if (target === d.body || target === d.documentElement || /^(?:html|body)$/i.test(target.tagName)) {
    throw new Error('不能把整个应用文档当作轻量内容槽。')
  }
  if (target.closest('[data-crazyos-host]')) throw new Error('不能修改 CrazyOS 宿主界面。')

  const browserPage = isBrowserPageSlot(target)
  const marker = target.getAttribute('data-crazyos-slot')?.trim().toLowerCase()
  const explicitlyTyped = marker === kind || marker === 'true' || marker === 'slot'
  const enclosingBrowserPage = owningBrowserPage(target)
  if (!browserPage && !explicitlyTyped) {
    throw new Error(`目标区域必须显式标记 data-crazyos-slot="${kind}"：${selector}`)
  }
  if (target.id === 'crazy-browser' || target.id === 'browser-pages') {
    throw new Error('不能替换浏览器壳层。')
  }
  if (target.closest('#crazy-browser') && !browserPage && (!enclosingBrowserPage || kind === 'navigate')) {
    throw new Error('不能通过页面 hook 修改浏览器壳层。')
  }
  if (browserPage) {
    const tabId = target.getAttribute('data-browser-tab-id')?.trim()
    if (!tabId || target.id !== `browser-page-${tabId}`) throw new Error('浏览器页面槽标识不一致。')
  }
  return target
}

function browserRequestFromHook(hook: Hook, target: HTMLElement): BrowserPageRequest | null {
  if (!isBrowserPageSlot(target)) return null
  const tabId = typeof hook.detail?.tabId === 'string' ? hook.detail.tabId.trim() : ''
  const requestId = typeof hook.detail?.requestId === 'string' ? hook.detail.requestId.trim() : ''
  const targetRegion = typeof hook.detail?.targetRegion === 'string' ? hook.detail.targetRegion.trim() : ''
  const actualTabId = target.getAttribute('data-browser-tab-id')?.trim() ?? ''
  if (!tabId || !requestId || tabId.length > 80 || requestId.length > 120) {
    throw new Error('浏览器页面 hook 缺少有效的 tabId/requestId。')
  }
  if (tabId !== actualTabId || (targetRegion && targetRegion !== hook.target?.trim())) {
    throw new Error('浏览器页面 hook 的标签页或目标区域不匹配。')
  }
  return { tabId, requestId }
}

function browserPageRequestIsPending(d: Document, selector: string, request: BrowserPageRequest): boolean {
  const target = querySlotTarget(d, selector)
  return !!target &&
    isBrowserPageSlot(target) &&
    target.getAttribute('data-browser-tab-id') === request.tabId &&
    target.getAttribute('data-browser-request-id') === request.requestId &&
    target.getAttribute('aria-busy') === 'true'
}

function notifyBrowserPageLifecycle(
  d: Document,
  hook: Hook,
  outcome: 'ready' | 'failed',
  message?: string
): boolean {
  const tabId = typeof hook.detail?.tabId === 'string' ? hook.detail.tabId.trim() : ''
  const requestId = typeof hook.detail?.requestId === 'string' ? hook.detail.requestId.trim() : ''
  if (!tabId || !requestId) return false
  const appObj = (d.defaultView as (Window & { app?: Record<string, unknown> }) | null)?.app
  const fn = appObj?.[outcome === 'ready' ? 'browserPageReady' : 'browserPageFailed']
  if (typeof fn !== 'function') return false
  try {
    return (fn as (payload: Record<string, string>) => boolean)({
      tabId,
      requestId,
      ...(message ? { message: message.slice(0, 160) } : {})
    }) === true
  } catch (err) {
    console.error('[AppWindow] browser page lifecycle failed:', err)
    return false
  }
}

/** Serialize browser-owned chrome while deliberately blanking every generated
 * page body. A candidate page may change its own slot, never tabs, address,
 * history state, runtime methods, or a sibling tab. */
function snapshotBrowserShell(d: Document): string {
  const root = d.getElementById('crazy-browser')
  if (!root) throw new Error('浏览器壳层已丢失。')
  const clone = root.cloneNode(true) as HTMLElement
  foldSnapshotFormValues(root, clone)
  clone.querySelectorAll('.browser-page-slot[data-browser-tab-id]').forEach((slot) => slot.replaceChildren())
  const address = d.querySelector<HTMLInputElement>('#browser-address')
  const appObj = (d.defaultView as (Window & { app?: Record<string, unknown> }) | null)?.app ?? {}
  const runtime = appObj.browserRuntime && typeof appObj.browserRuntime === 'object'
    ? (appObj.browserRuntime as Record<string, unknown>)
    : {}
  const functionSource = (value: unknown): string =>
    typeof value === 'function' ? Function.prototype.toString.call(value) : typeof value
  const appFunctions = Object.keys(appObj)
    .filter((key) => key === 'init_browser' || /^browser[A-Z]/.test(key))
    .sort()
    .map((key) => [key, functionSource(appObj[key])])
  const runtimeFunctions = Object.keys(runtime)
    .sort()
    .map((key) => [key, functionSource(runtime[key])])
  return JSON.stringify({
    stableBody: snapshotOutsideBrowserPages(d),
    chrome: clone.outerHTML,
    addressValue: address?.value ?? '',
    appFunctions,
    runtimeFunctions
  })
}

function snapshotOutsideBrowserPages(d: Document): string {
  if (!d.body) return ''
  const clone = d.body.cloneNode(true) as HTMLBodyElement
  foldSnapshotFormValues(d.body, clone)
  clone.querySelectorAll('[data-crazyos-host]').forEach((el) => el.remove())
  clone.querySelectorAll('.browser-page-slot[data-browser-tab-id]').forEach((slot) => slot.replaceChildren())
  return clone.innerHTML
}

function snapshotOutsideSlot(d: Document, selector: string): string {
  if (!d.body) return ''
  const clone = d.body.cloneNode(true) as HTMLBodyElement
  foldSnapshotFormValues(d.body, clone)
  clone.querySelectorAll('[data-crazyos-host]').forEach((el) => el.remove())
  let clonedTarget: Element | null = null
  try {
    clonedTarget = clone.querySelector(selector)
  } catch {
    // requireSlotTarget already validated the selector; keep a defensive error.
  }
  if (!clonedTarget) throw new Error(`无法建立内容槽边界：${selector}`)
  clonedTarget.replaceChildren()
  return clone.innerHTML
}

function foldSnapshotFormValues(source: ParentNode, clone: ParentNode): void {
  const liveFields = Array.from(source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
  const clonedFields = Array.from(clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
  for (let i = 0; i < Math.min(liveFields.length, clonedFields.length); i++) {
    const live = liveFields[i]
    const saved = clonedFields[i]
    if (live.tagName === 'INPUT' && saved.tagName === 'INPUT') {
      const input = live as HTMLInputElement
      saved.setAttribute('value', input.value)
      saved.toggleAttribute('checked', input.checked)
    } else if (live.tagName === 'TEXTAREA' && saved.tagName === 'TEXTAREA') {
      saved.textContent = (live as HTMLTextAreaElement).value
    } else if (live.tagName === 'SELECT' && saved.tagName === 'SELECT') {
      const selectedIndex = (live as HTMLSelectElement).selectedIndex
      Array.from((saved as HTMLSelectElement).options).forEach((option, index) => option.toggleAttribute('selected', index === selectedIndex))
    }
  }
}

function assertOutsideSlotUnchanged(d: Document, selector: string, before: string): void {
  if (snapshotOutsideSlot(d, selector) !== before) {
    throw new Error('目标区域的生成脚本试图修改应用的其他部分，已拒绝。')
  }
}

function assertBrowserShellUnchanged(d: Document, before: string): void {
  if (snapshotBrowserShell(d) !== before) {
    throw new Error('生成页面试图修改浏览器标签、地址栏、历史状态或稳定运行时，已拒绝。')
  }
}

function invokeBoundedSlotInitializer(
  d: Document,
  selector: string,
  kind: 'navigate' | 'content',
  unitId: string,
  browserRequest: BrowserPageRequest | null
): void {
  const target = requireSlotTarget(d, selector, kind)
  const boundaryBefore = kind === 'navigate' ? snapshotOutsideSlot(d, selector) : null
  const shellBefore = browserRequest ? snapshotBrowserShell(d) : null
  invokeUnitInitializerStrict(d, unitId)
  if (querySlotTarget(d, selector) !== target) {
    throw new Error('目标区域初始化器移除了自己的内容槽。')
  }
  if (boundaryBefore !== null) assertOutsideSlotUnchanged(d, selector, boundaryBefore)
  if (shellBefore !== null) assertBrowserShellUnchanged(d, shellBefore)
}

/** Run an initializer in a disposable clone before it ever receives access to
 * the live app. This catches deterministic shell/out-of-slot mutations and
 * failures without briefly damaging a visible browser tab. */
function auditSlotInitializer(
  source: Document,
  selector: string,
  kind: 'navigate' | 'content',
  unitId: string,
  browserRequest: BrowserPageRequest | null,
  dark: boolean
): void {
  const audit = createStagedRuntime(serializeRuntimeHtml(source), dark)
  try {
    invokeBoundedSlotInitializer(audit.doc, selector, kind, unitId, browserRequest)
  } finally {
    audit.dispose()
  }
}

/** The isolated audit is repeated against the live document because an
 * initializer can be state-sensitive. If it diverges, restore the exact
 * pre-init document before propagating the error into normal slot recovery. */
function invokeLiveSlotInitializer(
  d: Document,
  selector: string,
  kind: 'navigate' | 'content',
  unitId: string,
  browserRequest: BrowserPageRequest | null,
  disconnectObserver: () => void,
  installObserver: (doc: Document) => void,
  bumpLiveRevision: () => void
): void {
  const before = serializeRuntimeHtml(d)
  disconnectObserver()
  try {
    invokeBoundedSlotInitializer(d, selector, kind, unitId, browserRequest)
    bumpLiveRevision()
    installObserver(d)
  } catch (err) {
    reconcileBody(d, before, true)
    bumpLiveRevision()
    installObserver(d)
    throw err
  }
}

const FORBIDDEN_CONTENT_TAGS =
  'script,style,link,meta,base,iframe,object,embed,template,form,input,button,textarea,select,option,foreignObject,use'

function isSafeContentUrl(raw: string): boolean {
  const value = raw.trim()
  if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true
  try {
    const url = new URL(value, 'https://crazyos.invalid/')
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' || url.protocol === 'tel:'
  } catch {
    return false
  }
}

/** Content hooks are data-only. They cannot smuggle script, layout CSS, hooks,
 * browser state, active controls, or inline event handlers into their slot. */
function sanitizeContentSlotSource(d: Document, source: string): string {
  const template = d.createElement('template')
  template.innerHTML = source
  template.content.querySelectorAll(FORBIDDEN_CONTENT_TAGS).forEach((el) => el.remove())
  for (const el of Array.from(template.content.querySelectorAll<HTMLElement>('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'srcdoc' ||
        name === 'id' ||
        name === 'contenteditable' ||
        name === 'autofocus' ||
        name === 'tabindex' ||
        name === 'role' && attr.value.toLowerCase() === 'button' ||
        name.startsWith('data-hook') ||
        name === 'data-action' ||
        name === 'data-crazyos-slot' ||
        name.startsWith('data-browser') ||
        (/^(?:href|src|xlink:href|action|formaction|poster)$/i.test(name) && !isSafeContentUrl(attr.value))
      ) el.removeAttribute(attr.name)
    }
  }
  return template.innerHTML.trim()
}

function assertSafeContentTemplate(
  d: Document,
  templateHtml: string,
  selector: string,
  browserHandlerPrefix?: string
): void {
  const template = d.createElement('template')
  template.innerHTML = templateHtml
  if (template.content.querySelectorAll('[data-crazy-content]').length !== 1) {
    throw new Error(`内容模板必须且只能包含一个 data-crazy-content：${selector}`)
  }
  if (template.content.querySelector('script,style,link,meta,base,iframe,object,embed,template,form,foreignObject,use')) {
    throw new Error(`内容模板包含可执行、全局样式或嵌入式节点：${selector}`)
  }
  const appObj = (d.defaultView as (Window & { app?: Record<string, unknown> }) | null)?.app ?? {}
  const stableBrowserActions = new Set([
    'browserSearchPage',
    'browserOpenEngine',
    'browserOpenResult',
    'browserSendContent',
    'browserHome',
    'browserBack',
    'browserForward',
    'browserReload',
    'browserExternal'
  ])
  for (const el of Array.from(template.content.querySelectorAll<HTMLElement>('*'))) {
    const action = el.getAttribute('data-action')?.trim() ?? ''
    const interactive = el.matches('button,input,textarea,select,[role="button"]')
    if (interactive && (!action || typeof appObj[action] !== 'function')) {
      throw new Error(`内容模板中的控件必须连接到已存在的本地 app.* handler：${selector}`)
    }
    if (
      browserHandlerPrefix &&
      action &&
      !stableBrowserActions.has(action) &&
      !action.startsWith(browserHandlerPrefix)
    ) {
      throw new Error(`浏览器内容模板不能调用其他标签页的 handler：${action}`)
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'id' ||
        name === 'contenteditable' ||
        name === 'autofocus' ||
        name.startsWith('data-hook') ||
        name === 'data-crazyos-slot' ||
        name.startsWith('data-browser') ||
        (/^(?:href|src|xlink:href|formaction|poster)$/i.test(name) && !isSafeContentUrl(attr.value))
      ) {
        throw new Error(`内容模板含有危险或可冲突属性 ${attr.name}：${selector}`)
      }
    }
  }
}

function browserNamespace(tabId: string): { idPrefix: string; handlerPrefix: string } {
  const safe = tabId.replace(/[^a-zA-Z0-9_]/g, '_')
  return { idPrefix: `page-${safe}-`, handlerPrefix: `page_${safe}_` }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Keep JavaScript punctuation/identifiers while blanking comments and quoted
 * contents. Capability checks should inspect executable structure, not reject a
 * harmless selector such as "[data-crazy-content]" inside a string. */
function stripJsLiteralsAndComments(source: string): string {
  let out = ''
  let index = 0
  let mode: 'code' | 'single' | 'double' | 'line' | 'block' = 'code'
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (mode === 'code') {
      if (char === "'") {
        mode = 'single'
        out += char
      } else if (char === '"') {
        mode = 'double'
        out += char
      } else if (char === '/' && next === '/') {
        mode = 'line'
        out += '  '
        index++
      } else if (char === '/' && next === '*') {
        mode = 'block'
        out += '  '
        index++
      } else {
        out += char
      }
    } else if (mode === 'single' || mode === 'double') {
      const quote = mode === 'single' ? "'" : '"'
      if (char === '\\') {
        out += ' '
        if (index + 1 < source.length) {
          out += source[index + 1] === '\n' ? '\n' : ' '
          index++
        }
      } else if (char === quote) {
        out += char
        mode = 'code'
      } else {
        out += char === '\n' ? '\n' : ' '
      }
    } else if (mode === 'line') {
      out += char === '\n' ? '\n' : ' '
      if (char === '\n') mode = 'code'
    } else {
      if (char === '*' && next === '/') {
        out += '  '
        index++
        mode = 'code'
      } else {
        out += char === '\n' ? '\n' : ' '
      }
    }
    index++
  }
  return out
}

/** querySelectorAll does not enter HTMLTemplateElement.content. Browser pages
 * may intentionally carry a message template, so validation must recurse into
 * those inert fragments before they can later be cloned into the live DOM. */
function fragmentElements(root: ParentNode): HTMLElement[] {
  const direct = Array.from(root.querySelectorAll<HTMLElement>('*'))
  const out = [...direct]
  for (const el of direct) {
    if (el.tagName === 'TEMPLATE') out.push(...fragmentElements((el as HTMLTemplateElement).content))
  }
  return out
}

function queryFragmentDeep(root: ParentNode, selector: string): HTMLElement | null {
  try {
    const direct = root.querySelector<HTMLElement>(selector)
    if (direct) return direct
  } catch {
    return null
  }
  for (const el of Array.from(root.querySelectorAll<HTMLTemplateElement>('template'))) {
    const nested = queryFragmentDeep(el.content, selector)
    if (nested) return nested
  }
  return null
}

function assertSlotFragmentIds(
  d: Document,
  target: HTMLElement,
  source: string,
  placement: 'replace' | 'append',
  browserRequest: BrowserPageRequest | null
): void {
  const template = d.createElement('template')
  template.innerHTML = source
  const seen = new Set<string>()
  const namespace = browserRequest ? browserNamespace(browserRequest.tabId) : null
  const allElements = fragmentElements(template.content)
  for (const el of allElements.filter((node) => node.hasAttribute('id'))) {
    const id = el.id.trim()
    if (!id || seen.has(id)) throw new Error(`生成片段含有重复或空 id：${id || '(empty)'}`)
    seen.add(id)
    if (namespace && !id.startsWith(namespace.idPrefix)) {
      throw new Error(`浏览器标签页内的 id 必须以 ${namespace.idPrefix} 开头。`)
    }
    const existing = Array.from(d.querySelectorAll<HTMLElement>('[id]')).filter((node) => node.id === id)
    const conflict = existing.some((node) => placement === 'append' || !target.contains(node))
    if (conflict) throw new Error(`生成片段的 id 与目标区域外节点冲突：${id}`)
  }
  if (namespace) {
    const stableActions = new Set([
      'browserSearchPage',
      'browserOpenEngine',
      'browserOpenResult',
      'browserSendContent',
      'browserHome',
      'browserBack',
      'browserForward',
      'browserReload',
      'browserExternal'
    ])
    for (const el of allElements.filter((node) => node.hasAttribute('data-action'))) {
      const action = el.getAttribute('data-action')?.trim() ?? ''
      if (!stableActions.has(action) && !action.startsWith(namespace.handlerPrefix)) {
        throw new Error(`浏览器页控件不能调用其他标签或无命名空间的 handler：${action}`)
      }
    }
    for (const el of allElements.filter((node) => node.hasAttribute('data-hook'))) {
      const hookKind = el.getAttribute('data-hook-kind')?.trim()
      const targetSelector = el.getAttribute('data-hook-target')?.trim() ?? ''
      if (hookKind !== 'content' || !targetSelector.startsWith(`#${namespace.idPrefix}`)) {
        throw new Error('浏览器页内只允许指向本标签命名空间的 content hook；页面跳转必须走 browser callback。')
      }
      const contentTarget = queryFragmentDeep(template.content, targetSelector)
      if (!contentTarget || contentTarget.getAttribute('data-crazyos-slot') !== 'content') {
        throw new Error(`浏览器内容 hook 的目标无效：${targetSelector}`)
      }
      const localTemplateSelector = el.getAttribute('data-hook-template')?.trim()
      if (localTemplateSelector) {
        const localTemplate = queryFragmentDeep(template.content, localTemplateSelector)
        if (!localTemplate || localTemplate.tagName !== 'TEMPLATE') throw new Error('浏览器内容 hook 的本地模板无效。')
      }
    }
  }
}

function prepareNavigateSlotSource(d: Document, source: string, browserRequest: BrowserPageRequest | null): string {
  if (!browserRequest) return source
  const template = d.createElement('template')
  template.innerHTML = source
  // A model may occasionally ignore the no-<style> instruction. Dropping the
  // tab-global CSS is safer and more resilient than failing an otherwise valid
  // page; the browser slot already supplies its complete responsive skin.
  let allElements = fragmentElements(template.content)
  allElements
    .filter((el) => el.localName.toLowerCase() === 'script' || el.localName.toLowerCase() === 'style')
    .forEach((node) => node.remove())
  allElements.filter((el) => el.hasAttribute('data-window-title')).forEach((el) => el.removeAttribute('data-window-title'))
  const reservedIds = new Set([
    'crazy-browser',
    'browser-tabs',
    'browser-address',
    'browser-pages',
    'browser-toolbar',
    'browser-status',
    'browser-page-pending'
  ])
  const reservedClasses = new Set([
    'browser-top',
    'browser-toolbar',
    'browser-tab-strip',
    'browser-tab-wrap',
    'browser-tab',
    'browser-page-slot'
  ])
  const forbiddenActiveTags = new Set(['IFRAME', 'OBJECT', 'EMBED', 'FOREIGNOBJECT', 'USE'])
  for (const el of allElements) {
    if (forbiddenActiveTags.has(el.localName.toUpperCase())) {
      el.remove()
      continue
    }
    if (reservedIds.has(el.id)) el.removeAttribute('id')
    for (const className of Array.from(el.classList)) if (reservedClasses.has(className)) el.classList.remove(className)
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'formaction' ||
        name === 'xlink:href' ||
        name.startsWith('data-browser-') ||
        name === 'data-crazy-browser-runtime' ||
        name === 'target' && /^(?:_top|_parent)$/i.test(value) ||
        /^(?:href|src|action|poster)$/i.test(name) && /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)
      ) el.removeAttribute(attr.name)
      else if (name === 'style' && /(?:position\s*:\s*fixed|url\s*\(|@import|expression\s*\()/i.test(value)) {
        el.removeAttribute('style')
      }
    }
  }
  // Normalize ids and explicit hooks before examining data-action routes too;
  // this lets a generic chat action with an old/unprefixed data-target become
  // browserSendContent instead of being mistaken for page navigation.
  template.innerHTML = normalizeBrowserPageRoutes(d, template.innerHTML, browserRequest.tabId)
  allElements = fragmentElements(template.content)
  const namespace = browserNamespace(browserRequest.tabId)
  const stableActions = new Set([
    'browserSearchPage',
    'browserOpenEngine',
    'browserOpenResult',
    'browserSendContent',
    'browserHome',
    'browserBack',
    'browserForward',
    'browserReload',
    'browserExternal'
  ])
  const contentTargets = allElements.filter((node) =>
    node.id.startsWith(namespace.idPrefix) && node.getAttribute('data-crazyos-slot') === 'content'
  )
  for (const el of allElements.filter((node) => node.hasAttribute('data-action'))) {
    const action = el.getAttribute('data-action')?.trim() ?? ''
    let contentTarget = el.getAttribute('data-target')?.trim() ?? ''
    let targetNode = contentTarget ? queryFragmentDeep(template.content, contentTarget) : null
    if (action === 'browserSendContent') {
      if ((!contentTarget.startsWith(`#${namespace.idPrefix}`) || targetNode?.getAttribute('data-crazyos-slot') !== 'content') && contentTargets.length === 1) {
        contentTarget = `#${contentTargets[0].id}`
        targetNode = contentTargets[0]
        el.setAttribute('data-target', contentTarget)
      }
      for (const attribute of ['data-user-template', 'data-reply-template']) {
        const templateSelector = el.getAttribute(attribute)?.trim() ?? ''
        const referenced = templateSelector ? queryFragmentDeep(template.content, templateSelector) : null
        if (
          templateSelector &&
          (!templateSelector.startsWith(`#${namespace.idPrefix}`) || referenced?.localName.toLowerCase() !== 'template')
        ) el.removeAttribute(attribute)
      }
      // Keep the trusted action even when no target can be inferred: the host
      // reports a visible wiring error instead of silently doing nothing or
      // escalating the click into a whole-browser fallback hook.
      continue
    }
    if (stableActions.has(action)) continue
    if (
      contentTarget.startsWith(`#${namespace.idPrefix}`) &&
      targetNode?.getAttribute('data-crazyos-slot') === 'content'
    ) {
      el.setAttribute('data-action', 'browserSendContent')
    } else {
      el.removeAttribute('data-action')
    }
  }
  // Recover harmless but unrouted browser-looking controls without escalating
  // them into an untyped whole-app hook. Their label becomes a destination or
  // search intent handled by the stable per-tab browser runtime.
  for (const el of allElements.filter((node) => node.matches('button,input[type="button"],input[type="submit"],[role="button"],.btn'))) {
    const hookKind = el.getAttribute('data-hook-kind')?.trim()
    if (hookKind === 'navigate') {
      el.removeAttribute('data-hook')
      el.removeAttribute('data-hook-kind')
      el.removeAttribute('data-hook-target')
      el.removeAttribute('data-hook-placement')
      el.removeAttribute('data-hook-role')
      el.removeAttribute('data-hook-template')
    }
    if (!el.hasAttribute('data-action') && !el.hasAttribute('data-hook')) {
      const intent = (el.getAttribute('data-url') || el.textContent || (el as HTMLInputElement).value || '').trim()
      if (intent) {
        el.setAttribute('data-action', 'browserOpenResult')
        el.setAttribute('data-url', intent.slice(0, 1000))
        el.setAttribute('data-title', intent.slice(0, 160))
      } else {
        el.setAttribute('disabled', '')
        el.setAttribute('aria-disabled', 'true')
      }
    }
  }
  for (const link of allElements.filter((node): node is HTMLAnchorElement => node.matches('a[href]'))) {
    if (link.hasAttribute('data-action') || link.hasAttribute('data-hook')) continue
    const href = link.getAttribute('href')?.trim() ?? ''
    if (!href || /^javascript:/i.test(href)) {
      link.removeAttribute('href')
      continue
    }
    link.setAttribute('data-action', 'browserOpenResult')
    link.setAttribute('data-url', href)
    link.setAttribute('data-title', (link.textContent ?? href).trim().slice(0, 160))
  }
  return normalizeBrowserPageRoutes(d, template.innerHTML, browserRequest.tabId)
}

function assertSafeNavigateFragment(d: Document, source: string, browserRequest: BrowserPageRequest | null): void {
  const browserPage = !!browserRequest
  if (/<\s*\/?\s*(?:html|head|body)\b/i.test(source) || /<\s*(?:base|meta|link)\b/i.test(source)) {
    throw new Error('页面 hook 只能生成目标区域内部的片段。')
  }
  const template = d.createElement('template')
  template.innerHTML = source
  const allElements = fragmentElements(template.content)
  const forbiddenActiveTags = new Set(['IFRAME', 'OBJECT', 'EMBED', 'FOREIGNOBJECT', 'USE'])
  for (const el of allElements) {
    if (forbiddenActiveTags.has(el.localName.toUpperCase())) {
      throw new Error(`页面 hook 不能包含主动嵌入节点 <${el.tagName.toLowerCase()}>。`)
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'formaction' ||
        name === 'xlink:href' ||
        name === 'target' && /^(?:_top|_parent)$/i.test(value) ||
        /^(?:href|src|action|poster)$/i.test(name) && /^(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)
      ) {
        throw new Error(`页面 hook 含有不安全属性 ${attr.name}。`)
      }
      if (browserPage && name === 'style' && /(?:position\s*:\s*fixed|url\s*\(|@import|expression\s*\()/i.test(value)) {
        throw new Error('浏览器页的局部样式不能越过标签页或加载外部资源。')
      }
    }
  }
  if (browserPage && allElements.some((el) => el.localName.toLowerCase() === 'style')) {
    throw new Error('浏览器标签页不能注入会影响其他标签的全局样式；请使用页面现有响应式类。')
  }
  if (browserPage) {
    const reservedIds = new Set([
      'crazy-browser',
      'browser-tabs',
      'browser-address',
      'browser-pages',
      'browser-toolbar',
      'browser-status',
      'browser-page-pending'
    ])
    const reservedClasses = new Set([
      'browser-top',
      'browser-toolbar',
      'browser-tab-strip',
      'browser-tab-wrap',
      'browser-tab',
      'browser-page-slot'
    ])
    for (const el of allElements) {
      if (reservedIds.has(el.id) || Array.from(el.classList).some((name) => reservedClasses.has(name))) {
        throw new Error('生成页面不能伪造浏览器壳层节点。')
      }
      if (Array.from(el.attributes).some((attr) => attr.name.startsWith('data-browser-') || attr.name === 'data-crazy-browser-runtime')) {
        throw new Error('生成页面不能伪造浏览器标签或稳定运行时属性。')
      }
    }
  }
  for (const script of allElements.filter((el): el is HTMLScriptElement => el.localName.toLowerCase() === 'script')) {
    if (script.src || script.hasAttribute('src')) throw new Error('页面 hook 不能加载外部脚本。')
    const code = script.textContent ?? ''
    if (code.includes('`')) throw new Error('浏览器页脚本不能使用可插值模板字符串。')
    const structuralCode = stripJsLiteralsAndComments(code)
    if (/document\s*\.\s*(?:open|write|writeln|close)\s*\(/i.test(structuralCode)) {
      throw new Error('页面脚本不能重写整个 document。')
    }
    if (
      /document\s*\.\s*(?:body|documentElement)\b/i.test(structuralCode) ||
      /\bwindow\s*\.\s*(?:parent|top)\b/i.test(structuralCode) ||
      /(^|[^\w$.])(?:parent|top)\s*\./i.test(structuralCode)
    ) {
      throw new Error('页面脚本不能越过自己的目标区域。')
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|navigator\s*\.\s*sendBeacon\s*\(/i.test(structuralCode)) {
      throw new Error('页面脚本不能直接发起网络请求；请通过 Crazy hook。')
    }
    if (browserPage) {
      const namespace = browserNamespace(browserRequest.tabId)
      const changesStableRuntime =
        /\bwindow\s*\.\s*app\s*=/i.test(structuralCode) ||
        /\bapp\s*\.\s*(?:browserRuntime|init_browser|browser[A-Z]\w*)\s*=/i.test(structuralCode) ||
        /\bObject\s*\.\s*assign\s*\(\s*app\b/i.test(structuralCode)
      const directRuntimeAccess = /\bapp\s*\.\s*browserRuntime\b/i.test(structuralCode)
      if (changesStableRuntime || directRuntimeAccess || /\bbrowserPage(?:Ready|Failed)\s*\(/i.test(structuralCode)) {
        throw new Error('生成页面不能改写或提前完成浏览器稳定运行时。')
      }
      const allowedBrowserCalls = new Set([
        'browserSearchPage',
        'browserOpenEngine',
        'browserOpenResult',
        'browserSendContent',
        'browserHome',
        'browserBack',
        'browserForward',
        'browserReload',
        'browserExternal'
      ])
      if (/\bapp\s*\.\s*init_/i.test(structuralCode)) {
        throw new Error('浏览器目标页不能定义或调用自动初始化器；请把交互放进命名空间 data-action handler。')
      }
      for (const match of structuralCode.matchAll(/\bapp\s*\.\s*(browser[A-Z]\w*)\b/g)) {
        if (!allowedBrowserCalls.has(match[1])) throw new Error(`浏览器页脚本不能调用稳定壳层方法 ${match[1]}。`)
      }
      for (const match of structuralCode.matchAll(/\bapp\s*\.\s*([A-Za-z_$][\w$]*)\b/g)) {
        const name = match[1]
        if (!allowedBrowserCalls.has(name) && !name.startsWith(namespace.handlerPrefix)) {
          throw new Error(`浏览器页脚本引用了其他标签或无命名空间的 app.${name}。`)
        }
      }
      const withoutExplicitAppMembers = structuralCode.replace(/\bapp\s*\.\s*[A-Za-z_$][\w$]*/g, '')
      if (/\bapp\b/.test(withoutExplicitAppMembers)) {
        throw new Error('浏览器页脚本不能把 app 对象作为值传递或保存别名。')
      }
      const assignedNames: string[] = []
      for (const match of structuralCode.matchAll(/\bapp\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g)) assignedNames.push(match[1])
      if (assignedNames.some((name) => !name.startsWith(namespace.handlerPrefix))) {
        throw new Error(`浏览器页内的新 app.* handler 必须使用 ${namespace.handlerPrefix} 命名空间。`)
      }
      if (/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/.test(structuralCode) || /\b(?:document|window)\s*\.\s*addEventListener\s*\(/i.test(structuralCode)) {
        throw new Error('浏览器页脚本必须使用带标签命名空间的 app.* handler，不能注册全局函数或监听器。')
      }
      if (/\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask|MutationObserver|Promise|eval|async|await)\b|\bFunction\s*\(/.test(structuralCode)) {
        throw new Error('浏览器页脚本不能安排脱离当前事务的异步或动态代码。')
      }
      const hasComputedMember = /(?:\b[A-Za-z_$][\w$]*|\)|\])\s*\[/.test(structuralCode)
      if (/\bthis\b|\b(?:Reflect|Object)\b|\b(?:open|close|print|alert|confirm|prompt|postMessage)\s*\(/.test(structuralCode) || hasComputedMember) {
        throw new Error('浏览器页脚本不能使用动态成员访问或隐式全局能力。')
      }
      if (
        /\.(?:innerHTML|outerHTML)\s*=|\binsertAdjacentHTML\s*\(|\b(?:DOMParser|Range)\b|\bcreateContextualFragment\s*\(/i.test(structuralCode) ||
        /\.(?:setAttribute|setAttributeNS|toggleAttribute)\s*\(|\.className\s*=|\.style\b|\.on[a-z]+\s*=/i.test(structuralCode)
      ) {
        throw new Error('浏览器页脚本不能在点击后注入未校验的 HTML、属性或样式；请克隆预置模板并只写 textContent/value/classList。')
      }
      const allowedDocumentAccess = new RegExp(
        `\\bdocument\\s*\\.\\s*getElementById\\s*\\(\\s*(["'])${escapeRegExp(namespace.idPrefix)}[a-zA-Z0-9_:.-]+\\1\\s*\\)`,
        'g'
      )
      const withoutSafeDocumentAccess = code.replace(allowedDocumentAccess, '')
      if (/\bwindow\s*\.\s*crazyos\s*\.\s*save\s*=/i.test(structuralCode)) {
        throw new Error('浏览器页不能改写 CrazyOS bridge。')
      }
      const withoutAllowedBridgeCalls = withoutSafeDocumentAccess.replace(
        /\bwindow\s*\.\s*crazyos\s*\.\s*save\s*\(/gi,
        '('
      )
      const remainingCapabilityCode = stripJsLiteralsAndComments(withoutAllowedBridgeCalls)
      if (/\bdocument\b|\b(?:window|crazyos|globalThis|self|location|history|localStorage|sessionStorage|indexedDB)\b|ownerDocument|getRootNode/i.test(remainingCapabilityCode)) {
        throw new Error(`浏览器页脚本只能通过 document.getElementById('${namespace.idPrefix}…') 访问本标签节点。`)
      }
      let unsafeClosest = false
      const withoutSafeClosest = code.replace(/\.closest\s*\(\s*(["'])(.*?)\1\s*\)/g, (call, _quote: string, selector: string) => {
        const safeId = new RegExp(`^#${escapeRegExp(namespace.idPrefix)}[a-zA-Z0-9_:.-]+$`)
        if (selector === '.browser-generated-page' || safeId.test(selector)) return ''
        unsafeClosest = true
        return call
      })
      if (
        unsafeClosest ||
        /\.closest\s*\(/.test(stripJsLiteralsAndComments(withoutSafeClosest)) ||
        /\.(?:parentElement|parentNode|offsetParent|assignedSlot|previousSibling|previousElementSibling|nextSibling|nextElementSibling|host|currentTarget|view)\b|\bcomposedPath\s*\(/i.test(structuralCode) ||
        /\b(?:parent|top|opener|frames|frameElement)\b|\.(?:constructor|__proto__|prototype)\b|\b(?:getPrototypeOf|getOwnPropertyDescriptor)\s*\(/i.test(structuralCode)
      ) {
        throw new Error('浏览器页脚本的 DOM 遍历可能越过当前标签页。')
      }
    }
  }
  if (browserPage && /id\s*=\s*["'](?:crazy-browser|browser-(?:tabs|address|pages|toolbar|status))["']/i.test(source)) {
    throw new Error('生成页面不能伪造浏览器壳层节点。')
  }
}

function hasRenderableSlotFragment(d: Document, html: string): boolean {
  const template = d.createElement('template')
  template.innerHTML = html
  if (template.content.textContent?.trim()) return true
  return !!template.content.querySelector('img,svg,video,canvas,hr,br')
}

async function restoreSlotSnapshot(
  d: Document,
  selector: string,
  kind: 'navigate' | 'content',
  baseHtml: string,
  persist: (html: string, title: string) => Promise<void>,
  installObserver: (doc: Document) => void,
  isCurrent: () => boolean,
  readLiveRevision: () => number,
  disconnectObserver: () => void,
  bumpLiveRevision: () => void,
  fallbackTitle = '应用'
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isCurrent()) return
    const capturedRevision = readLiveRevision()
    const liveTargetAtCapture = requireSlotTarget(d, selector, kind)
    const browserPageAtCapture = isBrowserPageSlot(liveTargetAtCapture)
    const capturedTargetHtml = browserPageAtCapture ? serializeRuntimeInner(liveTargetAtCapture) : null
    const candidate = createStagedRuntime(serializeRuntimeHtml(d), d.documentElement.classList.contains('dark'))
    try {
      const target = requireSlotTarget(candidate.doc, selector, kind)
      const browserPage = isBrowserPageSlot(target)
      const shellBefore = browserPage ? snapshotBrowserShell(candidate.doc) : null
      const boundaryBefore = kind === 'navigate' ? snapshotOutsideSlot(candidate.doc, selector) : null
      target.innerHTML = baseHtml
      if (kind === 'navigate' && !browserPage) reExec(candidate.doc, target)
      if (boundaryBefore !== null) assertOutsideSlotUnchanged(candidate.doc, selector, boundaryBefore)
      if (shellBefore !== null) assertBrowserShellUnchanged(candidate.doc, shellBefore)
      const restored = serializeRuntimeHtml(candidate.doc)
      const title = viewTitleOf(candidate.doc, fallbackTitle)
      await persist(restored, title)
      if (!isCurrent()) return
      if (browserPageAtCapture) {
        const currentTarget = requireSlotTarget(d, selector, kind)
        if (capturedTargetHtml !== serializeRuntimeInner(currentTarget)) continue
      } else if (readLiveRevision() !== capturedRevision) continue
      const liveShellBefore = browserPageAtCapture ? snapshotBrowserShell(d) : null
      const liveBoundaryBefore = kind === 'navigate' ? snapshotOutsideSlot(d, selector) : null
      disconnectObserver()
      if (browserPageAtCapture) {
        // Failure recovery owns only the rejected tab body, exactly like the
        // successful streaming path. A sibling may have been created,
        // switched, or navigated while the file write was in flight; never
        // replay the candidate's older whole-document shell over those edits.
        const candidateTarget = requireSlotTarget(candidate.doc, selector, kind)
        const currentTarget = requireSlotTarget(d, selector, kind)
        reconcileChildren(d, currentTarget, candidateTarget, true)
      } else {
        reconcileBody(d, restored, true)
      }
      bumpLiveRevision()
      if (liveBoundaryBefore !== null) assertOutsideSlotUnchanged(d, selector, liveBoundaryBefore)
      if (liveShellBefore !== null) assertBrowserShellUnchanged(d, liveShellBefore)
      installObserver(d)
      if (browserPageAtCapture) {
        // The first write may contain an older sibling shell. Put the merged
        // live document at the persistence tail before the caller records the
        // browserPageFailed lifecycle transition.
        await persist(serializeRuntimeHtml(d), viewTitleOf(d, fallbackTitle))
      }
      return
    } finally {
      candidate.dispose()
    }
  }
  throw new Error('恢复旧内容时界面持续变化，已保留用户当前操作。')
}

function cleanSlotSource(source: string): string {
  return source
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/<!--\s*(?:plan:[\s\S]*?|done:[\s\S]*?)-->/gi, '')
    .replace(/^\s*<body[^>]*>/i, '')
    .replace(/<\/body>\s*$/i, '')
    .trim()
}

function materializeSlotFragment(d: Document, content: string, templateHtml: string, itemKey: string): string {
  if (!templateHtml) return content
  const template = d.createElement('template')
  template.innerHTML = templateHtml
  const contentTarget = template.content.querySelector<HTMLElement>('[data-crazy-content]')
  if (!contentTarget) throw new Error('内容模板缺少 data-crazy-content。')
  contentTarget.innerHTML = content
  const root = template.content.firstElementChild
  if (root && !root.id && !root.hasAttribute('data-crazyos-key')) root.setAttribute('data-crazyos-key', itemKey)
  return template.innerHTML
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
