import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { appKeyOf, canonicalAppIdForName, type ResolveAppOpenRequest } from '@shared/types'
import { browserOpeningKit, isBrowserLikeApp, isLegacyStaticBrowserKit } from '@shared/browserRuntime'
import type {
  AgentSessionMeta,
  AgentStoredMsg,
  AppData,
  AppOption,
  AppRuntimeCommitResult,
  AppRuntimeFiles,
  AppRuntimeSnapshot,
  AppViewCommitResult,
  AppViewSnapshot,
  CachedAppView,
  FsNode,
  FsTree,
  FsWriteResult,
  ResolvedAppOpen
} from '@shared/types'

// ---------------------------------------------------------------------------
// The virtual file system behind the file-manager app, plus per-app memory and
// agent-session storage. All JSON files in userData. The FS tree is what the
// file manager shows and the user drags around; per-app memory lives inside it
// as apps/<appId>/data.json, so saved app state is both readable by the model
// (on reopen) and visible/manageable as a real file.
// ---------------------------------------------------------------------------

function fileIn(name: string): string {
  return join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const p = fileIn(name)
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch (err) {
    console.error(`[fsStore] read ${name} failed:`, err)
  }
  return fallback
}

function writeJson(name: string, value: unknown): void {
  const destination = fileIn(name)
  const temporary = `${destination}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8')
    renameSync(temporary, destination)
  } catch (err) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Preserve the original write failure.
    }
    console.error(`[fsStore] write ${name} failed:`, err)
    throw err
  }
}

// nowMs is injected once per mutation so the pure helpers stay testable.
const now = (): number => Date.now()

// --- FS tree ---------------------------------------------------------------

let treeCache: FsTree | null = null
/** Variants with a live renderer window. Closed variants are kept byte-identical
 * even when the user edits either source from the file manager. */
const openRuntimeCounts = new Map<string, number>()

function runtimeKey(appId: string, variantKey: string): string {
  return `${appId}::${normalizeVariantKey(variantKey)}`
}

function seedTree(): FsTree {
  const t: FsTree = {
    rootId: 'root',
    revision: 0,
    nodes: {
      root: { id: 'root', kind: 'folder', name: 'crazy_os', children: ['apps', 'files'], updatedAt: now() },
      apps: { id: 'apps', kind: 'folder', name: 'apps', children: ['app_soul'], updatedAt: now() },
      files: { id: 'files', kind: 'folder', name: 'files', children: ['files_desktop', 'files_trash'], updatedAt: now() },
      // Anything the user drops in here shows up on the desktop itself.
      files_desktop: { id: 'files_desktop', kind: 'folder', name: 'Desktop', children: [], updatedAt: now() },
      // Deleted items land here first (30-day retention); emptying the bin purges for real.
      files_trash: { id: 'files_trash', kind: 'folder', name: '垃圾箱', children: [], updatedAt: now() },
      // The system agent's long-term memory: personalization notes it chooses to keep,
      // split into files (progressive disclosure — it reads one only when relevant).
      app_soul: { id: 'app_soul', kind: 'folder', name: 'soul', children: [], updatedAt: now() }
    }
  }
  return t
}

export function readTree(): FsTree {
  if (treeCache) return treeCache
  const t = readJson<FsTree | null>('fs.json', null)
  treeCache = t && t.nodes && t.rootId ? t : seedTree()
  if (typeof treeCache.revision !== 'number') treeCache.revision = 0
  // guarantee the two system folders exist even on an older/edited file
  if (!treeCache.nodes.apps) {
    treeCache.nodes.apps = { id: 'apps', kind: 'folder', name: 'apps', children: [], updatedAt: now() }
    treeCache.nodes.root.children = [...new Set(['apps', ...(treeCache.nodes.root.children ?? [])])]
  }
  if (!treeCache.nodes.files) {
    treeCache.nodes.files = { id: 'files', kind: 'folder', name: 'files', children: [], updatedAt: now() }
    treeCache.nodes.root.children = [...new Set([...(treeCache.nodes.root.children ?? []), 'files'])]
  }
  if (!treeCache.nodes.app_soul) {
    treeCache.nodes.app_soul = { id: 'app_soul', kind: 'folder', name: 'soul', children: [], updatedAt: now() }
    treeCache.nodes.apps.children = [...new Set(['app_soul', ...(treeCache.nodes.apps.children ?? [])])]
  }
  if (!treeCache.nodes.files_desktop) {
    treeCache.nodes.files_desktop = { id: 'files_desktop', kind: 'folder', name: 'Desktop', children: [], updatedAt: now() }
    treeCache.nodes.files.children = [...new Set(['files_desktop', ...(treeCache.nodes.files.children ?? [])])]
  }
  if (!treeCache.nodes.files_trash) {
    treeCache.nodes.files_trash = { id: 'files_trash', kind: 'folder', name: '垃圾箱', children: [], updatedAt: now() }
    treeCache.nodes.files.children = [...new Set([...(treeCache.nodes.files.children ?? []), 'files_trash'])]
  }
  return treeCache
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

/** Permanently drop trashed items older than 30 days. Call at startup. */
export function purgeExpiredTrash(): void {
  const tree = readTree()
  const trash = tree.nodes.files_trash
  if (!trash?.children?.length) return
  const cutoff = now() - THIRTY_DAYS
  const survivors: string[] = []
  const drop = (nid: string): void => {
    const n = tree.nodes[nid]
    if (n?.children) n.children.forEach(drop)
    delete tree.nodes[nid]
  }
  let changed = false
  for (const id of trash.children) {
    const n = tree.nodes[id]
    if (n && typeof n.deletedAt === 'number' && n.deletedAt < cutoff) {
      drop(id)
      changed = true
    } else {
      survivors.push(id)
    }
  }
  if (changed) {
    trash.children = survivors
    writeTree(tree)
  }
}

/** The files that live on the desktop (children of files/Desktop). */
export function desktopEntries(): FsNode[] {
  const tree = readTree()
  const d = tree.nodes.files_desktop
  if (!d?.children) return []
  return d.children.map((id) => tree.nodes[id]).filter((n): n is NonNullable<typeof n> => !!n)
}

/** A compact index of the agent's soul memory (filename + first line), so each turn the
 *  agent knows WHAT it has recorded and can read a file in full only when relevant. */
export function soulIndex(): Array<{ name: string; preview: string }> {
  const tree = readTree()
  const soul = tree.nodes.app_soul
  if (!soul?.children) return []
  return soul.children
    .map((id) => tree.nodes[id])
    .filter((n): n is NonNullable<typeof n> => !!n && n.kind === 'file')
    .map((n) => ({ name: n.name, preview: (n.content ?? '').split('\n')[0].slice(0, 80) }))
}

export function writeTree(tree: FsTree): FsTree {
  const priorRevision = Math.max(treeCache?.revision ?? 0, tree.revision ?? 0)
  tree.revision = priorRevision + 1
  mirrorClosedRuntimeFiles(tree)
  try {
    writeJson('fs.json', tree)
    treeCache = tree
  } catch (err) {
    // Callers often mutate the cached object before committing. Reload the last
    // durable tree so a failed disk write cannot masquerade as an in-memory
    // success for subsequent IPC calls.
    treeCache = readJson<FsTree | null>('fs.json', null) ?? seedTree()
    throw err
  }
  return tree
}

/** Renderer file views edit a snapshot of the whole virtual tree. Reject a
 * stale snapshot instead of letting it overwrite newer temporary/long-term
 * app sources; callers reapply their small mutation to the returned tree. */
export function writeTreeIfCurrent(tree: FsTree): FsWriteResult {
  const current = readTree()
  if ((tree.revision ?? 0) !== (current.revision ?? 0)) return { applied: false, tree: current }
  return { applied: true, tree: writeTree(tree) }
}

function mirrorClosedRuntimeFiles(tree: FsTree): void {
  const apps = tree.nodes.apps
  if (!apps?.children) return
  for (const folderId of apps.children) {
    if (!folderId.startsWith('app_') || folderId === 'app_soul') continue
    const folder = tree.nodes[folderId]
    if (!folder?.children) continue
    const appId = folderId.slice(4)
    for (const childId of folder.children) {
      const longTerm = tree.nodes[childId]
      if (longTerm?.kind !== 'file') continue
      const variantKey = variantFromArtifactName(longTerm.name, 'long-term.html')
      if (!variantKey || (openRuntimeCounts.get(runtimeKey(appId, variantKey)) ?? 0) > 0) continue
      const temporary = runtimeArtifactNodeOf(tree, folderId, variantKey, 'temporary')
      if (temporary && temporary.content !== longTerm.content) {
        temporary.content = longTerm.content ?? ''
        temporary.updatedAt = longTerm.updatedAt
      }
    }
  }
}

// --- per-app memory (apps/<appId>/data.json) -------------------------------

/** The app's data.json node inside its folder, found by NAME (so the app's own save() and the
 *  system agent editing apps/<name>/data.json converge on ONE file, whatever id it has). */
function dataNodeOf(tree: FsTree, folderId: string): FsNode | null {
  const folder = tree.nodes[folderId]
  if (!folder?.children) return null
  for (const cid of folder.children) {
    const c = tree.nodes[cid]
    if (c?.kind === 'file' && c.name === 'data.json') return c
  }
  return null
}

function normalizeVariantKey(raw?: string): string {
  const key = (raw ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')
  return key.replace(/^-|-$/g, '') || 'default'
}

function viewNodeOf(tree: FsTree, folderId: string, variantKey: string): FsNode | null {
  const folder = tree.nodes[folderId]
  if (!folder?.children) return null
  const want = `${normalizeVariantKey(variantKey)}.view.json`
  for (const cid of folder.children) {
    const c = tree.nodes[cid]
    if (c?.kind === 'file' && c.name === want) return c
  }
  return null
}

function artifactNodeOf(tree: FsTree, folderId: string, variantKey: string, suffix: 'opening.html' | 'body.html' | 'logic.js'): FsNode | null {
  const folder = tree.nodes[folderId]
  if (!folder?.children) return null
  const want = `${normalizeVariantKey(variantKey)}.${suffix}`
  for (const cid of folder.children) {
    const c = tree.nodes[cid]
    if (c?.kind === 'file' && c.name === want) return c
  }
  return null
}

type RuntimeArtifactKind = 'long-term' | 'temporary'

const APP_SCAFFOLD_PLACEHOLDER_HTML =
  '<main data-crazy-app-placeholder="true" aria-label="应用安装占位"></main>'

function runtimeArtifactNodeOf(tree: FsTree, folderId: string, variantKey: string, kind: RuntimeArtifactKind): FsNode | null {
  const folder = tree.nodes[folderId]
  if (!folder?.children) return null
  const want = `${normalizeVariantKey(variantKey)}.${kind}.html`
  for (const cid of folder.children) {
    const c = tree.nodes[cid]
    if (c?.kind === 'file' && c.name === want) return c
  }
  return null
}

function runtimeArtifactIdOf(appId: string, variantKey: string, kind: RuntimeArtifactKind): string {
  const prefix = kind === 'long-term' ? 'applongterm' : 'apptemporary'
  return `${prefix}_${appId}_${normalizeVariantKey(variantKey)}`
}

function variantFromArtifactName(name: string, suffix: string): string | null {
  const marker = `.${suffix}`
  if (!name.endsWith(marker)) return null
  const raw = name.slice(0, -marker.length)
  return raw ? normalizeVariantKey(raw) : null
}

/** Installation placeholders are useful in an already-open window, but are never a cache hit. */
function isUsableAppHtml(html: string | undefined): html is string {
  if (!html?.trim()) return false
  const lower = html.toLowerCase()
  if (lower.includes('data-crazy-app-placeholder')) return false
  // Older builds wrote an unmarked, short "opening kit is being generated" card.
  if (lower.length < 600 && lower.includes('opening kit') && lower.includes('card')) return false
  return true
}

function parseViewNode(node: FsNode | null): CachedAppView | null {
  if (!node?.content) return null
  try {
    const parsed = JSON.parse(node.content) as Partial<CachedAppView>
    if (typeof parsed.html !== 'string') return null
    const variantKey = normalizeVariantKey(typeof parsed.variantKey === 'string' ? parsed.variantKey : undefined)
    return {
      variantKey,
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '未命名界面',
      html: parsed.html,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 16) : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : node.updatedAt
    }
  } catch {
    return null
  }
}

function readViews(tree: FsTree, folderId: string): CachedAppView[] {
  const folder = tree.nodes[folderId]
  if (!folder?.children) return []
  const metadata = new Map<string, CachedAppView>()
  const variants = new Set<string>()

  for (const id of folder.children) {
    const node = tree.nodes[id]
    if (!node || node.kind !== 'file') continue
    if (node.name.endsWith('.view.json')) {
      const view = parseViewNode(node)
      if (view) {
        metadata.set(view.variantKey, view)
        variants.add(view.variantKey)
      }
    }
    const longTermVariant = variantFromArtifactName(node.name, 'long-term.html')
    if (longTermVariant) variants.add(longTermVariant)
    // Legacy apps may not have been opened since long-term/temporary files were introduced.
    const openingVariant = variantFromArtifactName(node.name, 'opening.html')
    if (openingVariant) variants.add(openingVariant)
  }

  return Array.from(variants)
    .map((variantKey): CachedAppView | null => {
      const view = metadata.get(variantKey)
      const longTerm = runtimeArtifactNodeOf(tree, folderId, variantKey, 'long-term')
      const legacyOpening = artifactNodeOf(tree, folderId, variantKey, 'opening.html')
      // Once a long-term file exists it is the sole HTML authority. Before migration,
      // prefer a usable opening.html and finally fall back to the old view.json body.
      const html = longTerm
        ? longTerm.content
        : isUsableAppHtml(legacyOpening?.content)
          ? legacyOpening.content
          : view?.html
      if (!isUsableAppHtml(html)) return null
      return {
        variantKey,
        title: view?.title?.trim() || folder.name,
        html,
        tags: view?.tags ?? [variantKey],
        updatedAt: longTerm?.updatedAt ?? legacyOpening?.updatedAt ?? view?.updatedAt ?? folder.updatedAt
      }
    })
    .filter((v): v is CachedAppView => !!v)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function aliasScore(a: string, b: string): number {
  const aa = a.trim().toLowerCase()
  const bb = b.trim().toLowerCase()
  if (!aa || !bb) return 0
  if (aa === bb) return 100
  if (aa.includes(bb) || bb.includes(aa)) return 80
  const ak = appKeyOf(aa)
  const bk = appKeyOf(bb)
  if (ak === bk) return 70
  return 0
}

function deriveVariantKey(name: string, instructions?: string, state?: unknown, mode?: string): string {
  const explicit = normalizeVariantKey(mode)
  if (explicit !== 'default') return explicit
  if (state && typeof state === 'object' && state && 'defaultVariantKey' in (state as Record<string, unknown>)) {
    const k = (state as { defaultVariantKey?: string }).defaultVariantKey
    if (typeof k === 'string' && k.trim()) return normalizeVariantKey(k)
  }
  return 'default'
}

function ensureAppFolder(tree: FsTree, appId: string, name: string): FsNode {
  const folderId = `app_${appId}`
  const ts = now()
  let changed = false
  let folder = tree.nodes[folderId]

  if (!folder || folder.kind !== 'folder') {
    folder = { id: folderId, kind: 'folder', name: name || appId, children: [], updatedAt: ts }
    tree.nodes[folderId] = folder
    changed = true
  }

  // Opening an app is also an explicit restore operation. A deleted app folder
  // can still exist in the flat node map (usually under files/垃圾箱); merely
  // finding that node is not enough. The canonical running folder must be a
  // direct child of apps and must not remain referenced by any other parent.
  for (const parent of Object.values(tree.nodes)) {
    if (parent.kind !== 'folder' || parent.id === 'apps' || !parent.children?.includes(folderId)) continue
    parent.children = parent.children.filter((id) => id !== folderId)
    parent.updatedAt = ts
    changed = true
  }

  const apps = tree.nodes.apps
  const currentAppsChildren = apps.children ?? []
  const occurrences = currentAppsChildren.filter((id) => id === folderId).length
  const nextAppsChildren = occurrences === 0
    ? [...currentAppsChildren, folderId]
    : occurrences === 1
      ? currentAppsChildren
      : currentAppsChildren.filter((id, index) => id !== folderId || currentAppsChildren.indexOf(id) === index)
  if (!apps.children || nextAppsChildren !== currentAppsChildren) {
    apps.children = nextAppsChildren
    apps.updatedAt = ts
    changed = true
  }

  if (name && folder.name !== name) {
    folder.name = name
    changed = true
  }
  if (folder.deletedAt !== undefined || folder.deletedFrom !== undefined || folder.x !== undefined || folder.y !== undefined) {
    delete folder.deletedAt
    delete folder.deletedFrom
    delete folder.x
    delete folder.y
    changed = true
  }
  if (changed) folder.updatedAt = ts
  return folder
}

function appFolderNeedsRepair(tree: FsTree, appId: string, name: string): boolean {
  const folderId = `app_${appId}`
  const folder = tree.nodes[folderId]
  if (!folder || folder.kind !== 'folder') return true
  if (name && folder.name !== name) return true
  if (folder.deletedAt !== undefined || folder.deletedFrom !== undefined || folder.x !== undefined || folder.y !== undefined) return true
  if ((tree.nodes.apps.children ?? []).filter((id) => id === folderId).length !== 1) return true
  return Object.values(tree.nodes).some(
    (parent) => parent.kind === 'folder' && parent.id !== 'apps' && !!parent.children?.includes(folderId)
  )
}

function requireCanonicalAppFolder(tree: FsTree, appId: string, name: string): FsNode {
  const folder = tree.nodes[`app_${appId}`]
  if (!folder || folder.kind !== 'folder' || appFolderNeedsRepair(tree, appId, name)) {
    throw new Error(`应用 ${name || appId} 的目录不在 apps；只有显式打开应用才能恢复或重建它。`)
  }
  return folder
}

interface EnsuredRuntimePair {
  folder: FsNode
  longTerm: FsNode
  temporary: FsNode
  title: string
  changed: boolean
}

function runtimeVariantKeyOf(tree: FsTree, appId: string, requested?: string): string {
  if (requested?.trim()) return normalizeVariantKey(requested)
  const data = dataNodeOf(tree, `app_${appId}`)
  if (data?.content) {
    try {
      const parsed = JSON.parse(data.content) as { defaultVariantKey?: unknown }
      if (typeof parsed.defaultVariantKey === 'string' && parsed.defaultVariantKey.trim()) {
        return normalizeVariantKey(parsed.defaultVariantKey)
      }
    } catch {
      // An edited/broken data.json must not prevent the app's default view opening.
    }
  }
  return 'default'
}

/**
 * Lazily migrate one variant into the two-file runtime model. A temporary file
 * is deliberately never promoted to durable state: recovery sources are, in
 * order, long-term.html, legacy opening.html, and legacy view.json.
 */
function ensureRuntimePair(
  tree: FsTree,
  appId: string,
  name: string,
  variantKey: string,
  resetTemporary = false,
  activateFolder = false
): EnsuredRuntimePair {
  const normalizedVariant = normalizeVariantKey(variantKey)
  const changedByFolderRepair = activateFolder && appFolderNeedsRepair(tree, appId, name)
  const folder = activateFolder ? ensureAppFolder(tree, appId, name) : requireCanonicalAppFolder(tree, appId, name)
  let changed = changedByFolderRepair

  const legacyView = parseViewNode(viewNodeOf(tree, folder.id, normalizedVariant))
  const legacyOpening = artifactNodeOf(tree, folder.id, normalizedVariant, 'opening.html')
  let longTerm = runtimeArtifactNodeOf(tree, folder.id, normalizedVariant, 'long-term')
  const migratedHtml = isUsableAppHtml(legacyOpening?.content)
    ? legacyOpening.content
    : isUsableAppHtml(legacyView?.html)
      ? legacyView.html
      : undefined
  // If this file already exists, even empty/placeholder content is authoritative:
  // never silently resurrect stale legacy HTML over a user's durable edit.
  const durableHtml = longTerm
    ? longTerm.content ?? ''
    : migratedHtml ?? APP_SCAFFOLD_PLACEHOLDER_HTML
  const ts = now()

  if (!longTerm) {
    const id = runtimeArtifactIdOf(appId, normalizedVariant, 'long-term')
    longTerm = {
      id,
      kind: 'file',
      name: `${normalizedVariant}.long-term.html`,
      content: durableHtml,
      updatedAt: ts
    }
    tree.nodes[id] = longTerm
    folder.children = [...(folder.children ?? []), id]
    changed = true
  }

  // One-time repair for browser folders created by the old generic mock or the
  // old single-page, model-hooked browser. The fingerprint is deliberately
  // exact: all other durable edits remain authoritative, including custom
  // browser UIs. Aliases count as identity so renamed browser apps migrate too.
  const savedIdentity = readCanonicalApp(tree, appId)
  const browserIdentity = [appId, name, folder.name, ...(savedIdentity?.aliases ?? [])].join('\n')
  let migratedLegacyBrowser = false
  if (isBrowserLikeApp(browserIdentity) && isLegacyStaticBrowserKit(longTerm.content ?? '')) {
    longTerm = {
      ...longTerm,
      content: browserOpeningKit(folder.name || name),
      updatedAt: Math.max(ts, longTerm.updatedAt + 1)
    }
    tree.nodes[longTerm.id] = longTerm
    changed = true
    migratedLegacyBrowser = true
  }

  let temporary = runtimeArtifactNodeOf(tree, folder.id, normalizedVariant, 'temporary')
  if (!temporary) {
    const id = runtimeArtifactIdOf(appId, normalizedVariant, 'temporary')
    temporary = {
      id,
      kind: 'file',
      name: `${normalizedVariant}.temporary.html`,
      content: longTerm.content ?? APP_SCAFFOLD_PLACEHOLDER_HTML,
      updatedAt: ts
    }
    tree.nodes[id] = temporary
    folder.children = [...(folder.children ?? []), id]
    changed = true
  } else if (resetTemporary || (migratedLegacyBrowser && (openRuntimeCounts.get(runtimeKey(appId, normalizedVariant)) ?? 0) === 0)) {
    temporary = { ...temporary, content: longTerm.content ?? '', updatedAt: ts }
    tree.nodes[temporary.id] = temporary
    changed = true
  }

  if (changed) folder.updatedAt = ts
  return {
    folder,
    longTerm,
    temporary,
    title: legacyView?.title?.trim() || folder.name || name,
    changed
  }
}

function runtimeFilesFromPair(appId: string, variantKey: string, pair: EnsuredRuntimePair): AppRuntimeFiles {
  return {
    appId,
    name: pair.folder.name,
    variantKey: normalizeVariantKey(variantKey),
    title: pair.title,
    longTermHtml: pair.longTerm.content ?? '',
    temporaryHtml: pair.temporary.content ?? '',
    longTermUpdatedAt: pair.longTerm.updatedAt,
    temporaryUpdatedAt: pair.temporary.updatedAt,
    updatedAt: Math.max(pair.longTerm.updatedAt, pair.temporary.updatedAt)
  }
}

function readCanonicalApp(tree: FsTree, appId: string): AppData | null {
  const folderId = `app_${appId}`
  const folder = tree.nodes[folderId]
  const data = dataNodeOf(tree, folderId)
  if (!folder || !data || data.content === undefined) return null
  try {
    const parsed = JSON.parse(data.content) as Partial<AppData>
    return {
      appId,
      name: folder.name,
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases.filter((a): a is string => typeof a === 'string') : [],
      defaultVariantKey: normalizeVariantKey(typeof parsed.defaultVariantKey === 'string' ? parsed.defaultVariantKey : undefined),
      views: readViews(tree, folderId),
      state: parsed.state ?? parsed,
      updatedAt: data.updatedAt
    }
  } catch {
    return { appId, name: folder.name, aliases: [], defaultVariantKey: 'default', views: readViews(tree, folderId), state: data.content, updatedAt: data.updatedAt }
  }
}

function allCanonicalApps(tree: FsTree): AppData[] {
  const apps = tree.nodes.apps
  if (!apps?.children) return []
  return apps.children
    .filter((id) => id !== 'app_soul')
    .map((id) => id.startsWith('app_') ? readCanonicalApp(tree, id.slice(4)) : null)
    .filter((v): v is AppData => !!v)
}

export function resolveAppOpen(req: ResolveAppOpenRequest, preferredAppId?: string): ResolvedAppOpen {
  const tree = readTree()
  const name = req.name.trim()
  const requestedId = canonicalAppIdForName(name)
  const savedApps = allCanonicalApps(tree)
  let matched = preferredAppId
    ? savedApps.find((a) => a.appId === preferredAppId) ?? null
    : savedApps.find((a) => a.appId === requestedId) ?? null
  // A semantic match is deliberately below exact-name confidence so existing
  // privacy/mode confirmation rules still apply to the user's original wording.
  let bestScore = matched ? (preferredAppId ? 85 : 100) : 0
  if (!matched) {
    let best: AppData | null = null
    for (const app of savedApps) {
      const names = [app.name, ...(app.aliases ?? [])]
      const score = Math.max(...names.map((n) => aliasScore(name, n)), 0)
      if (score > bestScore) {
        best = app
        bestScore = score
      }
    }
    if (best && bestScore >= 80) matched = best
  }
  const appId = matched?.appId ?? requestedId
  const explicitMode = !!req.mode?.trim()
  let variantKey = explicitMode
    ? deriveVariantKey(name, req.instructions, matched?.state, req.mode)
    : matched
      ? normalizeVariantKey(matched.defaultVariantKey)
      : deriveVariantKey(name, req.instructions, undefined, undefined)
  const displayName = matched?.name ?? name
  const views = matched?.views ?? []
  let targetView = views.find((v) => v.variantKey === variantKey) ?? null
  const sourceView = targetView ?? views.find((v) => v.variantKey === (matched?.defaultVariantKey ?? 'default')) ?? views[0] ?? null
  // A stale/missing defaultVariantKey must not manufacture a new mode during a
  // plain reopen. Fall back to the app's real durable view and reuse it as-is.
  if (!explicitMode && !targetView && sourceView) {
    variantKey = sourceView.variantKey
    targetView = sourceView
  }
  const convertingMode = !!matched && explicitMode && !targetView && !!sourceView && sourceView.variantKey !== variantKey
  const cachedView = targetView ?? sourceView
  const disposition = !matched || !cachedView
    ? 'create'
    : convertingMode
      ? 'convert-mode'
      : 'reuse'
  const sensitive = /privacy|private|隐私|私人|隐藏/.test(`${name}\n${req.instructions ?? ''}\n${req.mode ?? ''}`.toLowerCase())
  const maybeDifferentMode = sensitive && matched && variantKey !== (matched.defaultVariantKey ?? 'default') && !req.confirmedSensitive
  return {
    variantKey,
    cachedView,
    openPlan: {
      disposition,
      requestedName: name,
      targetVariantKey: variantKey,
      sourceVariantKey: sourceView?.variantKey,
      requirementsChanged: !!req.instructions?.trim()
    },
    needsConfirmation: maybeDifferentMode && bestScore < 100 ? { id: `${appId}:${variantKey}:privacy`, message: 'This request may open or hide privacy-sensitive content. Ask the user before switching modes or changing scope.' } : undefined,
    app: {
      id: appId,
      name: displayName,
      icon: req.icon?.trim() || [...displayName.trim()][0] || '✨',
      tagline: req.tagline ?? '',
      variantKey,
      seedHtml: cachedView?.html,
      seedTitle: cachedView?.title
    }
  }
}

export function getAppData(appId: string): AppData | null {
  return readCanonicalApp(readTree(), appId)
}

export type AppScaffoldStep = 'data' | 'long-term' | 'temporary' | 'all'

/** Create one real installation artifact at a time. The renderer uses the
 * three explicit steps to drive its first-run progress bar; legacy callers can
 * still request `all` atomically. */
export function ensureAppScaffold(
  appId: string,
  name: string,
  variantKey?: string,
  step: AppScaffoldStep = 'all'
): AppRuntimeFiles | null {
  const tree = readTree()
  const folder = ensureAppFolder(tree, appId, name)
  const existing = readCanonicalApp(tree, appId)
  const normalizedVariant = variantKey?.trim()
    ? normalizeVariantKey(variantKey)
    : normalizeVariantKey(existing?.defaultVariantKey)
  const ts = now()
  let changed = false

  if (step === 'data' || step === 'all') {
    const aliases = Array.from(new Set([folder.name, name, ...(existing?.aliases ?? [])].map((s) => s.trim()).filter(Boolean)))
    const content = JSON.stringify(
      { aliases, defaultVariantKey: normalizedVariant, state: existing?.state ?? null },
      null,
      2
    )
    const data = dataNodeOf(tree, folder.id)
    if (data) {
      if (data.content !== content) {
        tree.nodes[data.id] = { ...data, content, updatedAt: ts }
        changed = true
      }
    } else {
      const dataId = `appdata_${appId}`
      tree.nodes[dataId] = { id: dataId, kind: 'file', name: 'data.json', content, updatedAt: ts }
      folder.children = [...(folder.children ?? []), dataId]
      changed = true
    }
  }

  let longTerm = runtimeArtifactNodeOf(tree, folder.id, normalizedVariant, 'long-term')
  if ((step === 'long-term' || step === 'all') && !longTerm) {
    const legacyView = parseViewNode(viewNodeOf(tree, folder.id, normalizedVariant))
    const legacyOpening = artifactNodeOf(tree, folder.id, normalizedVariant, 'opening.html')
    const durableHtml = isUsableAppHtml(legacyOpening?.content)
      ? legacyOpening.content
      : isUsableAppHtml(legacyView?.html)
        ? legacyView.html
        : APP_SCAFFOLD_PLACEHOLDER_HTML
    const id = runtimeArtifactIdOf(appId, normalizedVariant, 'long-term')
    longTerm = { id, kind: 'file', name: `${normalizedVariant}.long-term.html`, content: durableHtml, updatedAt: ts }
    tree.nodes[id] = longTerm
    folder.children = [...(folder.children ?? []), id]
    changed = true
  }

  let temporary = runtimeArtifactNodeOf(tree, folder.id, normalizedVariant, 'temporary')
  if ((step === 'temporary' || step === 'all') && !temporary) {
    if (!longTerm) throw new Error('创建 temporary.html 前必须先创建 long-term.html。')
    const id = runtimeArtifactIdOf(appId, normalizedVariant, 'temporary')
    temporary = {
      id,
      kind: 'file',
      name: `${normalizedVariant}.temporary.html`,
      content: longTerm.content ?? APP_SCAFFOLD_PLACEHOLDER_HTML,
      updatedAt: ts
    }
    tree.nodes[id] = temporary
    folder.children = [...(folder.children ?? []), id]
    changed = true
  }

  if (changed) {
    folder.updatedAt = ts
    writeTree(tree)
  }

  if (!longTerm || !temporary) return null
  return runtimeFilesFromPair(appId, normalizedVariant, {
    folder,
    longTerm,
    temporary,
    title: folder.name || name,
    changed
  })
}

export function setAppData(appId: string, name: string, state: unknown): void {
  const tree = readTree()
  const folder = requireCanonicalAppFolder(tree, appId, name)
  const existing = readCanonicalApp(tree, appId)
  const priorState = existing?.state
  const stateMode =
    state && typeof state === 'object' && typeof (state as { mode?: unknown }).mode === 'string'
      ? String((state as { mode?: unknown }).mode)
      : priorState && typeof priorState === 'object' && typeof (priorState as { mode?: unknown }).mode === 'string'
        ? String((priorState as { mode?: unknown }).mode)
        : undefined
  const variantKey = deriveVariantKey(name, undefined, existing?.state ?? state, stateMode)
  const aliases = Array.from(new Set([folder.name, name, ...(existing?.aliases ?? [])].map((s) => s.trim()).filter(Boolean)))
  const payload = {
    aliases,
    defaultVariantKey: variantKey,
    state
  }
  const content = JSON.stringify(payload, null, 2)
  const data = dataNodeOf(tree, folder.id)
  const ts = now()
  if (data) {
    tree.nodes[data.id] = { ...data, content, updatedAt: ts }
  } else {
    const dataId = `appdata_${appId}`
    tree.nodes[dataId] = { id: dataId, kind: 'file', name: 'data.json', content, updatedAt: ts }
    folder.children = [...(folder.children ?? []), dataId]
  }
  folder.updatedAt = ts
  writeTree(tree)
}

/** Persist the durable opening kit for one app variant. Ordinary runtime navigation should NOT call this. */
export function saveAppView(snapshot: AppViewSnapshot): AppViewCommitResult {
  const tree = readTree()
  const folder = requireCanonicalAppFolder(tree, snapshot.appId, snapshot.name)
  const variantKey = normalizeVariantKey(snapshot.variantKey)
  const priorLongTerm = runtimeArtifactNodeOf(tree, folder.id, variantKey, 'long-term')
  const priorTemporary = runtimeArtifactNodeOf(tree, folder.id, variantKey, 'temporary')
  if (
    (snapshot.baseLongTermUpdatedAt !== undefined && snapshot.baseLongTermUpdatedAt !== priorLongTerm?.updatedAt) ||
    (snapshot.baseTemporaryUpdatedAt !== undefined && snapshot.baseTemporaryUpdatedAt !== priorTemporary?.updatedAt)
  ) {
    return { applied: false, files: getAppRuntimeFiles(snapshot.appId, snapshot.name, variantKey) }
  }
  const updatedAt = Math.max(now(), (priorLongTerm?.updatedAt ?? 0) + 1, (priorTemporary?.updatedAt ?? 0) + 1)
  // A successful durable render becomes both the reusable home screen and the
  // currently running source. Subsequent runtime interactions only touch the
  // temporary half via setAppRuntime().
  for (const kind of ['long-term', 'temporary'] as const) {
    const runtimeNode = runtimeArtifactNodeOf(tree, folder.id, variantKey, kind)
    if (runtimeNode) {
      tree.nodes[runtimeNode.id] = { ...runtimeNode, content: snapshot.html, updatedAt }
    } else {
      const id = runtimeArtifactIdOf(snapshot.appId, variantKey, kind)
      tree.nodes[id] = {
        id,
        kind: 'file',
        name: `${variantKey}.${kind}.html`,
        content: snapshot.html,
        updatedAt
      }
      folder.children = [...(folder.children ?? []), id]
    }
  }

  const data = readCanonicalApp(tree, snapshot.appId)
  const aliases = Array.from(new Set([snapshot.name, folder.name, ...(data?.aliases ?? [])].map((s) => s.trim()).filter(Boolean)))
  const dataContent = JSON.stringify(
    {
      aliases,
      defaultVariantKey: variantKey,
      state: data?.state ?? null
    },
    null,
    2
  )
  const dataNode = dataNodeOf(tree, folder.id)
  if (dataNode) tree.nodes[dataNode.id] = { ...dataNode, content: dataContent, updatedAt }
  else {
    const dataId = `appdata_${snapshot.appId}`
    tree.nodes[dataId] = { id: dataId, kind: 'file', name: 'data.json', content: dataContent, updatedAt }
    folder.children = [...(folder.children ?? []), dataId]
  }
  folder.updatedAt = updatedAt
  writeTree(tree)
  return { applied: true, files: getAppRuntimeFiles(snapshot.appId, snapshot.name, variantKey) }
}

/** Read (and lazily migrate/scaffold) the two files backing one app variant. */
export function getAppRuntimeFiles(appId: string, name: string, variantKey?: string): AppRuntimeFiles {
  const tree = readTree()
  const resolvedVariant = runtimeVariantKeyOf(tree, appId, variantKey)
  const pair = ensureRuntimePair(tree, appId, name, resolvedVariant)
  if (pair.changed) writeTree(tree)
  return runtimeFilesFromPair(appId, resolvedVariant, pair)
}

/** Start a window at its durable home by replacing temporary HTML in-place. */
export function openAppRuntime(appId: string, name: string, variantKey?: string, requestedAlias?: string): AppRuntimeFiles {
  const tree = readTree()
  const resolvedVariant = runtimeVariantKeyOf(tree, appId, variantKey)
  const folder = ensureAppFolder(tree, appId, name)
  const durable = runtimeArtifactNodeOf(tree, folder.id, resolvedVariant, 'long-term')
  const alias = requestedAlias?.trim()
  const data = alias ? readCanonicalApp(tree, appId) : null
  if (alias && data) {
    const known = [data.name, ...(data.aliases ?? [])]
    if (!known.some((value) => value.trim().toLocaleLowerCase() === alias.toLocaleLowerCase())) {
      const node = dataNodeOf(tree, folder.id)
      if (node) {
        const updatedAt = Math.max(now(), node.updatedAt + 1)
        tree.nodes[node.id] = {
          ...node,
          content: JSON.stringify(
            {
              aliases: [...known.map((value) => value.trim()).filter(Boolean), alias],
              defaultVariantKey: data.defaultVariantKey ?? 'default',
              state: data.state
            },
            null,
            2
          ),
          updatedAt
        }
        folder.updatedAt = updatedAt
      }
    }
  }
  const key = runtimeKey(appId, resolvedVariant)
  openRuntimeCounts.set(key, (openRuntimeCounts.get(key) ?? 0) + 1)

  // A genuinely new/incomplete app opens its window with only the canonical
  // folder present. AppWindow then creates data → long-term → temporary through
  // ensureAppScaffold(), allowing the visible installer and Files app to track
  // the three real writes instead of animating after everything already exists.
  if (!isUsableAppHtml(durable?.content)) {
    writeTree(tree)
    return {
      appId,
      name: folder.name || name,
      variantKey: resolvedVariant,
      title: folder.name || name,
      longTermHtml: '',
      temporaryHtml: '',
      longTermUpdatedAt: 0,
      temporaryUpdatedAt: 0,
      updatedAt: folder.updatedAt
    }
  }

  const pair = ensureRuntimePair(tree, appId, name, resolvedVariant, true, true)
  writeTree(tree)
  return runtimeFilesFromPair(appId, resolvedVariant, pair)
}

/** Save a live DOM snapshot without ever promoting it to the durable home page. */
export function setAppRuntime(snapshot: AppRuntimeSnapshot): AppRuntimeCommitResult {
  const tree = readTree()
  const variantKey = runtimeVariantKeyOf(tree, snapshot.appId, snapshot.variantKey)
  const pair = ensureRuntimePair(tree, snapshot.appId, snapshot.name, variantKey)
  if (
    snapshot.baseTemporaryUpdatedAt !== undefined &&
    snapshot.baseTemporaryUpdatedAt !== pair.temporary.updatedAt
  ) {
    return { applied: false, files: runtimeFilesFromPair(snapshot.appId, variantKey, pair) }
  }
  const ts = Math.max(now(), pair.temporary.updatedAt + 1)
  const temporary = { ...pair.temporary, content: snapshot.html, updatedAt: ts }
  tree.nodes[temporary.id] = temporary
  // Deliberately do not touch view.json, opening.html, or long-term.html here.
  writeTree(tree)
  return {
    applied: true,
    files: runtimeFilesFromPair(snapshot.appId, variantKey, { ...pair, temporary })
  }
}

/** Revert a closing window to the durable home source. */
export function resetAppRuntime(appId: string, name: string, variantKey?: string): AppRuntimeFiles {
  const tree = readTree()
  const resolvedVariant = runtimeVariantKeyOf(tree, appId, variantKey)
  const key = runtimeKey(appId, resolvedVariant)
  const count = openRuntimeCounts.get(key) ?? 0
  if (count > 1) {
    openRuntimeCounts.set(key, count - 1)
    const pair = ensureRuntimePair(tree, appId, name, resolvedVariant)
    if (pair.changed) writeTree(tree)
    return runtimeFilesFromPair(appId, resolvedVariant, pair)
  }
  openRuntimeCounts.delete(key)
  const pair = ensureRuntimePair(tree, appId, name, resolvedVariant, true)
  writeTree(tree)
  return runtimeFilesFromPair(appId, resolvedVariant, pair)
}

/** Startup recovery: no temporary navigation is allowed to survive a process restart. */
export function resetAllAppRuntimes(): void {
  openRuntimeCounts.clear()
  const tree = readTree()
  const apps = tree.nodes.apps
  if (!apps?.children) return
  let changed = false

  for (const folderId of apps.children) {
    if (folderId === 'app_soul' || !folderId.startsWith('app_')) continue
    const folder = tree.nodes[folderId]
    if (!folder || folder.kind !== 'folder') continue
    const appId = folderId.slice(4)
    const variants = new Set<string>()

    for (const childId of folder.children ?? []) {
      const node = tree.nodes[childId]
      if (!node || node.kind !== 'file') continue
      for (const suffix of ['long-term.html', 'temporary.html', 'opening.html'] as const) {
        const variant = variantFromArtifactName(node.name, suffix)
        if (variant) variants.add(variant)
      }
      if (node.name.endsWith('.view.json')) {
        const view = parseViewNode(node)
        if (view) variants.add(view.variantKey)
      }
    }

    // A data-only app still needs one baseline runtime pair; otherwise reset only
    // variants that have (current or legacy) view artifacts.
    if (variants.size === 0) variants.add(runtimeVariantKeyOf(tree, appId))
    for (const variantKey of variants) {
      const pair = ensureRuntimePair(tree, appId, folder.name, variantKey, true)
      changed ||= pair.changed
    }
  }

  if (changed) writeTree(tree)
}

/** A compact index of every app that has saved data: display name + its data (capped). Injected
 *  on open so the model can spot when the app being opened is really an existing one under a
 *  different name (e.g. 记事本 vs 备忘录) and rebuild from its data. Excludes soul. */
export function listAppsWithData(excludeKey?: string, perAppCap = 900, totalCap = 4000): Array<{ name: string; data: string }> {
  const tree = readTree()
  const apps = tree.nodes.apps
  if (!apps?.children) return []
  const out: Array<{ name: string; data: string }> = []
  let total = 0
  for (const id of apps.children) {
    if (id === 'app_soul') continue
    if (excludeKey && id === `app_${excludeKey}`) continue
    const folder = tree.nodes[id]
    if (!folder || folder.kind !== 'folder') continue
    const app = id.startsWith('app_') ? readCanonicalApp(tree, id.slice(4)) : null
    if (!app) continue
    const payload = JSON.stringify(app.state)
    const snippet = payload.length > perAppCap ? payload.slice(0, perAppCap) + '…' : payload
    out.push({ name: folder.name, data: snippet })
    total += snippet.length
    if (total > totalCap) break
  }
  return out
}

export function listSavedApps(): AppOption[] {
  return allCanonicalApps(readTree())
    .map((app) => {
      const summary =
        app.state && typeof app.state === 'object'
          ? JSON.stringify(app.state).slice(0, 160)
          : typeof app.state === 'string'
            ? app.state.slice(0, 160)
            : 'saved app'
      const modeLabel = app.defaultVariantKey && app.defaultVariantKey !== 'default' ? `saved · ${app.defaultVariantKey} mode` : 'saved app'
      return {
        id: app.appId,
        name: app.name,
        icon: [...app.name.trim()][0] ?? '✨',
        tagline: `${modeLabel} · ${summary}`.slice(0, 180)
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/** The agent's recorded personalization (all soul files' text, capped), injected into every app
 *  generation so user preferences ("记住备忘录用某某风格") actually shape what gets drawn. */
export function soulContext(maxChars = 2000): string {
  const tree = readTree()
  const soul = tree.nodes.app_soul
  if (!soul?.children) return ''
  let out = ''
  for (const id of soul.children) {
    const n = tree.nodes[id]
    if (n?.kind === 'file' && n.content) {
      out += `# ${n.name}\n${n.content}\n\n`
      if (out.length > maxChars) break
    }
  }
  return out.slice(0, maxChars).trim()
}

// --- agent sessions --------------------------------------------------------

interface StoredSession {
  meta: AgentSessionMeta
  messages: AgentStoredMsg[]
}

function readSessions(): Record<string, StoredSession> {
  return readJson<Record<string, StoredSession>>('agent-sessions.json', {})
}

export function listSessions(): AgentSessionMeta[] {
  return Object.values(readSessions())
    .map((s) => s.meta)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadSession(id: string): AgentStoredMsg[] {
  return readSessions()[id]?.messages ?? []
}

export function saveSession(id: string, messages: AgentStoredMsg[]): void {
  if (messages.length === 0) return
  const all = readSessions()
  const firstUser = messages.find((m) => m.role === 'user')
  const title = (firstUser?.text ?? '新会话').slice(0, 24)
  all[id] = { meta: { id, title, updatedAt: now() }, messages }
  writeJson('agent-sessions.json', all)
}

export function deleteSession(id: string): void {
  const all = readSessions()
  delete all[id]
  writeJson('agent-sessions.json', all)
}
