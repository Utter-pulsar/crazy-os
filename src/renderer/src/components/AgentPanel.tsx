import { useEffect, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AgentEvent, AgentSessionMeta, ModelPreset } from '@shared/types'
import { useStore } from '../store'
import { APP_STATUS_EVENT, type AppStatusDetail } from '../lib/appStatus'
import { PENDING_CONFIRMATION_EVENT, type PendingConfirmationDetail } from '../lib/pendingConfirmation'
import { DoodleBox } from './DoodleBox'
import { DoodleTextarea } from './DoodleField'
import { Icon } from './Icon'
import { useDoodleScrollbar } from '../lib/useDoodleScrollbar'

/**
 * The system-agent surface (dock's rope-ring icon). Two shapes:
 *   * sidebar — docked right; width springs via a per-frame RAF spring (Q弹) driven from a
 *     left-edge handle; clicking the blank desktop dismisses it.
 *   * window — a proper opaque, bordered, shadowed app window (drag the header to move).
 * Dragging the header morphs between them. This component stays MOUNTED even when hidden,
 * so a running turn keeps streaming and reopening shows the live conversation (never a new
 * session). New/history sessions are explicit buttons in the header.
 */

type Item =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; callId: string; label: string; status: 'running' | 'ok' | 'fail'; summary?: string }
  | { type: 'app-status'; key: string; appName: string; title: string; label: string; narrator?: string; todos: Array<{ id: string; label: string; done: boolean }> }
  | { type: 'confirm'; key: string; appName: string; variantKey: string; message: string; payload: { name: string; icon?: string; tagline?: string; instructions?: string; mode?: string }; status: 'pending' | 'confirmed' | 'cancelled' }

const newSessionId = (): string => `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`

// width spring (per-frame): underdamped → a little overshoot = Q弹 (from DoodlePilot)
const STIFF = 0.2
const DAMP = 0.72

function confirmationPromptText(it: Extract<Item, { type: 'confirm' }>): string {
  return `Confirmed privacy-sensitive mode change for ${it.appName} (${it.variantKey}). Continue the update now.`
}

export function AgentPanel(): JSX.Element {
  const open = useStore((s) => s.agentOpen)
  const mode = useStore((s) => s.agentMode)
  const setMode = useStore((s) => s.setAgentMode)
  const storeWidth = useStore((s) => s.agentWidth)
  const setWidth = useStore((s) => s.setAgentWidth)
  const closeAgent = useStore((s) => s.closeAgent)
  const setInteracting = useStore((s) => s.setInteracting)
  const live = useStore((s) => s.live)

  const [sessionId, setSessionId] = useState(newSessionId)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<ModelPreset[]>([])
  const [modelId, setModelId] = useState('')
  const [thinking, setThinking] = useState(false)
  const [sessions, setSessions] = useState<AgentSessionMeta[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  useDoodleScrollbar(listRef)

  // free-floating rect (window mode)
  const [rect, setRect] = useState(() => ({ x: window.innerWidth - 420, y: 60, w: 380, h: Math.min(560, window.innerHeight - 160) }))

  // --- width spring (sidebar) ---
  const [dispWidth, setDispWidth] = useState(storeWidth)
  const targetW = useRef(storeWidth)
  const dispW = useRef(storeWidth)
  const vel = useRef(0)
  const raf = useRef<number | undefined>(undefined)
  const draggingW = useRef(false)
  const step = (): void => {
    vel.current = (vel.current + (targetW.current - dispW.current) * STIFF) * DAMP
    dispW.current += vel.current
    if (!draggingW.current && Math.abs(targetW.current - dispW.current) < 0.4 && Math.abs(vel.current) < 0.4) {
      dispW.current = Math.round(targetW.current)
      setDispWidth(dispW.current)
      setWidth(dispW.current)
      raf.current = undefined
      return
    }
    setDispWidth(dispW.current)
    raf.current = requestAnimationFrame(step)
  }
  const kick = (): void => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(step)
  }
  useEffect(
    () => () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current)
    },
    []
  )

  useEffect(() => {
    const loadModels = (): void => {
      void window.crazyos.getSettings().then((s) => {
        setModels(s.models)
        setModelId((prev) => (prev && s.models.some((m) => m.id === prev) ? prev : s.activeModelId || s.models[0]?.id || ''))
      })
    }
    loadModels()
    void refreshSessions()
    // re-read when the settings app changes / enables a model
    const onSettings = (): void => loadModels()
    window.addEventListener('crazyos:settings', onSettings)
    return () => window.removeEventListener('crazyos:settings', onSettings)
  }, [])

  const refreshSessions = async (): Promise<void> => {
    setSessions(await window.crazyos.agentSessions())
  }

  useEffect(() => {
    const off = window.crazyos.onAgentEvent((ev: AgentEvent) => {
      if (ev.sessionId !== sessionIdRef.current) return
      setItems((prev) => reduceEvent(prev, ev))
      if (ev.type === 'done' || ev.type === 'error') {
        setBusy(false)
        void refreshSessions()
      }
    })
    const onAppStatus = (e: Event): void => {
      const detail = (e as CustomEvent<AppStatusDetail>).detail
      setItems((prev) => reduceAppStatus(prev, detail))
    }
    const onPending = (e: Event): void => {
      const detail = (e as CustomEvent<PendingConfirmationDetail>).detail
      setItems((prev) => reducePending(prev, detail))
    }
    window.addEventListener(APP_STATUS_EVENT, onAppStatus)
    window.addEventListener(PENDING_CONFIRMATION_EVENT, onPending)
    return () => {
      off()
      window.removeEventListener(APP_STATUS_EVENT, onAppStatus)
      window.removeEventListener(PENDING_CONFIRMATION_EVENT, onPending)
    }
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  // close the history dropdown when clicking anywhere outside it
  const historyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!historyOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false)
    }
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [historyOpen])

  // click the blank desktop to dismiss the SIDEBAR (popover-style)
  useEffect(() => {
    if (!open || mode !== 'sidebar') return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null
      if (panelRef.current?.contains(t)) return
      if (t?.closest('[data-agent-toggle]')) return
      closeAgent()
    }
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, mode, closeAgent])

  const send = (): void => {
    const text = input.trim()
    if (!text) return
    if (busy) {
      const targetSessionId = sessionIdRef.current
      setInput('')
      const restore = (): void => {
        if (sessionIdRef.current === targetSessionId) setInput((current) => (current.trim() ? `${text}\n${current}` : text))
      }
      void window.crazyos.agentSteer(targetSessionId, text)
        .then((accepted) => {
          if (accepted && sessionIdRef.current === targetSessionId) setItems((prev) => [...prev, { type: 'user', text }])
          else restore()
        })
        .catch(restore)
      return
    }
    setInput('')
    setItems((prev) => [...prev, { type: 'user', text }])
    setBusy(true)
    void window.crazyos.agentSend(sessionIdRef.current, text, modelId, thinking).catch(() => setBusy(false))
  }
  const stop = (): void => window.crazyos.agentCancel(sessionIdRef.current)

  const confirmPending = (key: string): void => {
    const found = items.find((it): it is Extract<Item, { type: 'confirm' }> => it.type === 'confirm' && it.key === key)
    if (!found) return
    setItems((prev) => prev.map((it) => (it.type === 'confirm' && it.key === key ? { ...it, status: 'confirmed' } : it)))
    const text = `${confirmationPromptText(found)}\nMode: ${found.payload.mode ?? found.variantKey}. Open or update the same app using the confirmed privacy-sensitive scope.`
    setInput('')
    setItems((prev) => [...prev, { type: 'assistant', text }])
    setBusy(true)
    void window.crazyos.agentSend(sessionIdRef.current, text, modelId, thinking).catch(() => setBusy(false))
  }

  const cancelPending = (key: string): void => {
    setItems((prev) => prev.map((it) => (it.type === 'confirm' && it.key === key ? { ...it, status: 'cancelled' } : it)))
  }

  const startNewSession = (): void => {
    window.crazyos.agentCancel(sessionIdRef.current)
    setSessionId(newSessionId())
    setItems([])
    setBusy(false)
    setHistoryOpen(false)
  }
  const openSession = async (id: string): Promise<void> => {
    window.crazyos.agentCancel(sessionIdRef.current)
    const msgs = await window.crazyos.agentLoadSession(id)
    setSessionId(id)
    setItems(msgs.map((m) => (m.role === 'user' ? { type: 'user', text: m.text } : { type: 'assistant', text: m.text })))
    setBusy(false)
    setHistoryOpen(false)
  }
  const deleteSession = async (id: string): Promise<void> => {
    await window.crazyos.agentDeleteSession(id)
    await refreshSessions()
    if (id === sessionIdRef.current) startNewSession()
  }

  // --- header drag: morph sidebar <-> window (1:1, no layout lag) ---
  const gestureRef = useRef<{ lastX: number; lastY: number } | null>(null)
  const onHeaderDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button, select, input, textarea')) return
    e.preventDefault()
    gestureRef.current = { lastX: e.clientX, lastY: e.clientY }
    setInteracting(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeaderMove = (e: React.PointerEvent): void => {
    const g = gestureRef.current
    if (!g) return
    const dx = e.clientX - g.lastX
    const dy = e.clientY - g.lastY
    g.lastX = e.clientX
    g.lastY = e.clientY
    if (mode === 'sidebar') {
      if (e.clientX < window.innerWidth - 44) {
        setRect({ x: Math.max(8, e.clientX - 80), y: Math.max(48, e.clientY - 16), w: dispWidth, h: Math.min(560, window.innerHeight - 160) })
        setMode('window')
      }
    } else {
      setRect((r) => ({
        ...r,
        x: Math.min(window.innerWidth - 80, Math.max(-r.w + 120, r.x + dx)),
        y: Math.min(window.innerHeight - 40, Math.max(4, r.y + dy))
      }))
    }
  }
  const onHeaderUp = (e: React.PointerEvent): void => {
    if (!gestureRef.current) return
    gestureRef.current = null
    setInteracting(false)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
    if (mode === 'window' && rect.x + rect.w >= window.innerWidth - 56) setMode('sidebar')
  }

  // --- sidebar width handle (RAF spring) ---
  const widthGesture = useRef<{ startX: number; startW: number } | null>(null)
  const onWidthDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    widthGesture.current = { startX: e.clientX, startW: dispW.current }
    draggingW.current = true
    setInteracting(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onWidthMove = (e: React.PointerEvent): void => {
    const w = widthGesture.current
    if (!w) return
    targetW.current = Math.max(300, Math.min(680, w.startW + (w.startX - e.clientX))) // drag left = wider
    kick()
  }
  const onWidthUp = (e: React.PointerEvent): void => {
    if (!widthGesture.current) return
    widthGesture.current = null
    draggingW.current = false
    setInteracting(false)
    kick()
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
  }

  const isWindow = mode === 'window'
  const geometry = isWindow
    ? { top: rect.y, left: rect.x, width: rect.w, height: rect.h }
    : { top: 48, right: 12, bottom: 88, width: dispWidth }

  return (
    <motion.div
      ref={panelRef}
      className={`absolute z-[140000] rounded-[14px] bg-card ${isWindow ? 'window-shadow' : ''}`}
      style={{ ...geometry, pointerEvents: open ? 'auto' : 'none' }}
      initial={false}
      animate={open ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: isWindow ? 0 : 80, scale: isWindow ? 0.94 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
    >
      <DoodleBox fill="--card" radius={14} className="absolute inset-0" />

      {/* sidebar width handle (left edge) */}
      {!isWindow && (
        <div
          className="rzh absolute -left-1 top-0 z-10 h-full w-2 cursor-ew-resize"
          onPointerDown={onWidthDown}
          onPointerMove={onWidthMove}
          onPointerUp={onWidthUp}
          onPointerCancel={onWidthUp}
        >
          <div className="rzh-bar" style={{ width: 3, height: '46%' }} />
        </div>
      )}

      <div className="relative flex h-full flex-col p-3 font-doodle text-ink">
        {/* header (drag to morph) */}
        <div
          onPointerDown={onHeaderDown}
          onPointerMove={onHeaderMove}
          onPointerUp={onHeaderUp}
          onPointerCancel={onHeaderUp}
          className="flex select-none items-center gap-1.5 border-b-2 border-dashed border-ink/25 pb-2 cursor-grab active:cursor-grabbing"
        >
          <img src="/icon.png" alt="" className="h-6 w-6" draggable={false} />
          <span className="font-bold">crazy 助手</span>
          <span className="grow" />
          <HeaderBtn label="新会话" onClick={startNewSession} icon="new-chat" />
          <div className="relative" ref={historyRef}>
            <HeaderBtn label="历史会话" onClick={() => setHistoryOpen((v) => !v)} icon="history" />
            <AnimatePresence>
              {historyOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.85, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  style={{ transformOrigin: 'top right' }}
                  className="absolute right-0 top-8 z-20 w-56"
                >
                  <DoodleBox fill="--card" radius={10}>
                    <div className="flex max-h-72 flex-col gap-0.5 overflow-auto p-1.5">
                      {sessions.length === 0 && <div className="px-2 py-1 text-sm text-ink/45">还没有历史会话</div>}
                      {sessions.map((s) => (
                        <div
                          key={s.id}
                          className={`flex items-center gap-1 rounded-[8px] px-2 py-1 ${s.id === sessionId ? 'bg-marker-yellow/25' : 'hover:bg-ink/5'}`}
                        >
                          <button onClick={() => void openSession(s.id)} className="grow truncate text-left text-sm" title={s.title}>
                            {s.title || '（空会话）'}
                          </button>
                          <button onClick={() => void deleteSession(s.id)} title="删除" className="shrink-0 text-ink/50 hover:text-marker-coral">
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </DoodleBox>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <HeaderBtn label={isWindow ? '停靠右侧' : '浮动窗口'} onClick={() => setMode(isWindow ? 'sidebar' : 'window')} icon="dock" />
          <HeaderBtn label="收起" onClick={closeAgent} icon="close" danger />
        </div>

        {live === false && (
          <div className="mt-2 rounded-[10px] border-2 border-dashed border-ink/40 px-2 py-1 text-xs text-ink/60">
            还没接上真模型（mock 模式）——去系统设置里添加一个 crazy模型。
          </div>
        )}

        <div ref={listRef} className="grow overflow-auto py-2">
          {items.length === 0 && (
            <p className="px-1 pt-2 text-sm text-ink/45">跟我说想对这台系统做什么——给刚打开的应用补个缺的功能、再开一个具备某些能力的应用、换个主题…</p>
          )}
          <div className="flex flex-col gap-2">
            {items.map((it, i) => (
              <ItemView key={i} it={it} confirmPending={confirmPending} cancelPending={cancelPending} />
            ))}
          </div>
        </div>

        {/* input bar: model picker + thinking toggle on the left */}
        <div className="border-t-2 border-dashed border-ink/25 pt-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <select
              value={modelId}
              onChange={async (e) => {
                const nextId = e.target.value
                setModelId(nextId)
                await window.crazyos.updateSettings({ activeModelId: nextId })
                window.dispatchEvent(new CustomEvent('crazyos:settings'))
              }}
              className="max-w-[55%] truncate rounded-[8px] border-2 border-ink bg-paper px-1.5 py-0.5 text-xs text-ink outline-none"
              title="这轮对话用哪个模型"
            >
              {models.length === 0 && <option value="">（无模型）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.model || m.provider}
                </option>
              ))}
            </select>
            <button
              onClick={() => setThinking((v) => !v)}
              className={`flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs transition ${thinking ? 'bg-marker-violet/40 font-bold' : 'hover:bg-ink/5'}`}
              title="开启后展示模型的思考过程"
            >
              <Icon name="brain" size={13} /> 思考{thinking ? '开' : '关'}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <DoodleTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="想让系统怎么变？(Enter 发送)"
              className="grow"
            />
            {busy && input.trim() ? (
              <button
                onClick={send}
                className="rounded-[10px] border-2 border-ink bg-marker-yellow/60 px-3 py-1.5 text-sm hover:bg-marker-yellow/80"
                title="发送并追加到当前运行中的任务"
              >
                发送/追加
              </button>
            ) : busy ? (
              <button onClick={stop} className="rounded-[10px] border-2 border-ink px-3 py-1.5 text-sm hover:bg-marker-coral/40">
                停止
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="rounded-[10px] border-2 border-ink bg-marker-yellow/60 px-3 py-1.5 text-sm hover:bg-marker-yellow/80 disabled:opacity-40"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function reduceEvent(prev: Item[], ev: AgentEvent): Item[] {
  const next = [...prev]
  const appendTo = (type: 'assistant' | 'thinking', text: string): void => {
    const last = next[next.length - 1]
    if (last?.type === type) next[next.length - 1] = { ...last, text: last.text + text }
    else next.push({ type, text })
  }
  if (ev.type === 'text') appendTo('assistant', ev.text)
  else if (ev.type === 'thinking') appendTo('thinking', ev.text)
  else if (ev.type === 'tool-start') next.push({ type: 'tool', callId: ev.callId, label: ev.label, status: 'running' })
  else if (ev.type === 'tool-end') {
    for (let i = next.length - 1; i >= 0; i--) {
      const it = next[i]
      if (it.type === 'tool' && it.callId === ev.callId) {
        next[i] = { ...it, status: ev.ok ? 'ok' : 'fail', summary: ev.summary }
        break
      }
    }
  } else if (ev.type === 'error') next.push({ type: 'assistant', text: `⚠️ ${ev.message}` })
  return next
}

// Some OpenAI-compatible servers (vLLM/qwen) stream a leading newline or inline <think>…</think>
// before the tool call, which would render as a blank/whitespace bubble. Clean + hide those.
function cleanText(s: string): string {
  return s
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    // During streaming the closing tag may not have arrived yet. Hide the
    // unfinished block instead of briefly leaking reasoning into the reply.
    .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
    .replace(/<\/?think(?:ing)?>/gi, '')
    // A token boundary can split the opening tag itself (for example "<thi").
    .replace(/<think(?:ing)?[^>]*$/gi, '')
    .replace(/<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/gi, '')
    .trim()
}

function reduceAppStatus(prev: Item[], detail: AppStatusDetail): Item[] {
  const key = `${detail.instanceId}:${detail.label}`
  const next = prev.filter((it) => it.type !== 'app-status' || it.key !== key)
  if (detail.remove) return next.filter((it) => it.type !== 'app-status' || !it.key.startsWith(`${detail.instanceId}:`))
  next.push({ type: 'app-status', key, appName: detail.appName, title: detail.title, label: detail.label, narrator: detail.narrator, todos: detail.todos })
  return next
}

function reducePending(prev: Item[], detail: PendingConfirmationDetail): Item[] {
  const next = prev.filter((it) => it.type !== 'confirm' || it.key !== detail.id)
  next.push({ type: 'confirm', key: detail.id, appName: detail.appName, variantKey: detail.variantKey, message: detail.message, payload: detail.payload, status: 'pending' })
  return next
}

function ItemView({ it, confirmPending, cancelPending }: { it: Item; confirmPending: (key: string) => void; cancelPending: (key: string) => void }): JSX.Element | null {
  if (it.type === 'user') {
    return <div className="self-end rounded-[12px_4px_12px_12px] border-2 border-ink bg-marker-yellow/30 px-3 py-1.5 text-sm">{it.text}</div>
  }
  if (it.type === 'assistant') {
    const t = cleanText(it.text)
    if (!t) return null // don't render an empty/whitespace-only bubble
    return <div className="self-start whitespace-pre-wrap rounded-[4px_12px_12px_12px] border-2 border-ink/60 bg-paper px-3 py-1.5 text-sm">{t}</div>
  }
  if (it.type === 'thinking') {
    const t = it.text.trim()
    if (!t) return null
    return (
      <div className="flex items-start gap-1 self-start whitespace-pre-wrap rounded-[12px] border-2 border-dashed border-ink/30 bg-marker-violet/10 px-3 py-1.5 text-xs text-ink/60">
        <Icon name="brain" size={13} className="mt-0.5 shrink-0" /> <span>{t}</span>
      </div>
    )
  }
  if (it.type === 'app-status') {
    return (
      <div className="self-start rounded-[12px] border-2 border-dashed border-ink/35 bg-marker-sky/10 px-3 py-2 text-sm text-ink/75">
        <div className="mb-1 flex items-center gap-2">
          <span className="animate-[wiggle_0.9s_ease-in-out_infinite]">✎</span>
          <span className="font-bold">{it.title || it.appName}</span>
          <span className="text-xs text-ink/55">{it.label}</span>
        </div>
        {it.narrator && <div className="mb-1 text-xs text-ink/60">{it.narrator}</div>}
        {it.todos.length > 0 && (
          <div className="flex flex-col gap-1 text-xs text-ink/65">
            {it.todos.map((todo) => (
              <div key={todo.id} className="flex items-center gap-1.5">
                <span>{todo.done ? '✓' : '·'}</span>
                <span className={todo.done ? 'line-through opacity-60' : ''}>{todo.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (it.type === 'confirm') {
    return (
      <div className="self-start rounded-[12px] border-2 border-dashed border-marker-coral bg-marker-coral/10 px-3 py-2 text-sm text-ink/80">
        <div className="mb-1 font-bold">{it.appName}</div>
        <div className="mb-2 text-xs text-ink/65">{it.message}</div>
        <div className="mb-2 flex items-center gap-2 text-xs text-ink/60">
          <span>Variant: {it.variantKey}</span>
          <span>Status: {it.status}</span>
        </div>
        {it.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => confirmPending(it.key)} className="rounded-[8px] border-2 border-ink bg-marker-yellow/50 px-2 py-1 text-xs hover:bg-marker-yellow/70">
              Confirm
            </button>
            <button onClick={() => cancelPending(it.key)} className="rounded-[8px] border-2 border-ink px-2 py-1 text-xs hover:bg-ink/5">
              Keep current
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 self-start px-1 text-sm text-ink/70" title={it.summary}>
      {it.status === 'running' ? (
        <span className="animate-[wiggle_0.9s_ease-in-out_infinite]">✎</span>
      ) : it.status === 'ok' ? (
        <span className="text-ink/70">
          <Icon name="check" size={15} />
        </span>
      ) : (
        <span className="text-marker-coral">
          <Icon name="cross" size={15} />
        </span>
      )}
      <span className={it.status === 'running' ? '' : 'text-ink/50'}>{it.label}</span>
    </div>
  )
}

function HeaderBtn({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: Parameters<typeof Icon>[0]['name']; danger?: boolean }): JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink text-ink transition ${danger ? 'hover:bg-marker-coral/50' : 'hover:bg-ink/10'}`}
    >
      <Icon name={icon} size={15} />
    </button>
  )
}
