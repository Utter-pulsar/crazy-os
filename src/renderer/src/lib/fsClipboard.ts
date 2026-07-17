import type { FsNode, FsTree } from '@shared/types'

// The event that keeps every FS view (file manager, desktop, file editor, agent) in sync. Each
// dispatch carries an `origin` token so a view can ignore the event IT caused — otherwise a view's
// own optimistic update would be clobbered by a re-read of the (async, not-yet-flushed) store.
export const FS_CHANGED_EVENT = 'crazyos:fs'
let originSeq = 0
export const newOrigin = (): string => `o${++originSeq}`
export function dispatchFs(origin?: string): void {
  window.dispatchEvent(new CustomEvent(FS_CHANGED_EVENT, { detail: { origin } }))
}
/** True when a received FS-changed event was caused by `origin` itself (ignore it). */
export function isOwnFs(e: Event, origin: string): boolean {
  return (e as CustomEvent<{ origin?: string }>).detail?.origin === origin
}

/** Commit a prepared optimistic draft with revision/CAS retry. If another
 * window or a running app changed the tree meanwhile, reapply only this small
 * mutation to the fresh tree instead of overwriting the newer runtime files. */
export async function commitFsDraft(
  initialDraft: FsTree,
  reapply: (fresh: FsTree) => void,
  maxAttempts = 5
): Promise<FsTree> {
  let draft = initialDraft
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await window.crazyos.fsWrite(draft)
    if (result.applied) return result.tree
    draft = structuredClone(result.tree)
    reapply(draft)
  }
  throw new Error('文件系统同时发生了太多修改，请重试。')
}

export async function commitFsMutation(mutate: (fresh: FsTree) => void, maxAttempts = 5): Promise<FsTree> {
  let base = await window.crazyos.fsRead()
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const draft = structuredClone(base)
    mutate(draft)
    const result = await window.crazyos.fsWrite(draft)
    if (result.applied) return result.tree
    base = result.tree
  }
  throw new Error('文件系统同时发生了太多修改，请重试。')
}

// A tiny module-level clipboard shared by the file manager and the desktop, so copy/cut in one
// surface can be pasted in the other. Holds node ids + whether it's a copy (duplicate) or cut (move).

export interface Clip {
  mode: 'copy' | 'cut'
  ids: string[]
}

let clip: Clip | null = null
export const getClip = (): Clip | null => clip
export const setClip = (c: Clip | null): void => {
  clip = c
}

const rid = (kind: string): string => `${kind}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`

/** Resolve a shortcut chain to its real node. Broken links and cycles return null. */
export function resolveShortcutTarget(tree: FsTree, node: FsNode): FsNode | null {
  let current: FsNode | undefined = node
  const seen = new Set<string>()
  while (current?.kind === 'shortcut') {
    if (seen.has(current.id) || !current.targetId) return null
    seen.add(current.id)
    current = tree.nodes[current.targetId]
  }
  return current ?? null
}

/** Create an independent link entry inside any folder. The real target keeps its
 * single parent, so deleting/moving the shortcut can never move the target. */
export function createShortcutInto(
  tree: FsTree,
  targetId: string,
  parentId: string,
  preferredName?: string
): FsNode | null {
  const parent = tree.nodes[parentId]
  const requestedTarget = tree.nodes[targetId]
  if (!parent || parent.kind !== 'folder' || !requestedTarget) return null
  const target = resolveShortcutTarget(tree, requestedTarget)
  if (!target) return null

  const existingNames = new Set((parent.children ?? []).map((id) => tree.nodes[id]?.name).filter(Boolean))
  const base = preferredName?.trim() || target.name
  let name = base
  if (existingNames.has(name)) {
    name = `${base} - 快捷方式`
    let index = 2
    while (existingNames.has(name)) name = `${base} - 快捷方式 (${index++})`
  }
  const id = rid('shortcut')
  const shortcut: FsNode = { id, kind: 'shortcut', name, targetId: target.id, updatedAt: Date.now() }
  tree.nodes[id] = shortcut
  parent.children = [...(parent.children ?? []), id]
  return shortcut
}

/** Deep-clone a subtree into a target folder, returning the new root id. */
export function cloneInto(tree: FsTree, id: string, targetFolder: string): string | null {
  const src = tree.nodes[id]
  if (!src) return null
  const clone = (nid: string): string => {
    const n = tree.nodes[nid]
    const newId = rid(n.kind)
    tree.nodes[newId] = { ...n, id: newId, updatedAt: Date.now(), children: n.children ? n.children.map(clone) : undefined, x: undefined, y: undefined }
    return newId
  }
  const newId = clone(id)
  const to = tree.nodes[targetFolder]
  if (to) to.children = [...(to.children ?? []), newId]
  return newId
}

export const TRASH_ID = 'files_trash'

/** Move nodes into a folder (skips system nodes, self, and descendants). Moving OUT of the trash
 *  (target isn't the trash) also restores — clears the trashed metadata. */
export function moveInto(tree: FsTree, ids: string[], targetId: string, systemIds: ReadonlySet<string>): void {
  for (const id of ids) {
    if (systemIds.has(id) || id === targetId || isAncestor(tree, id, targetId)) continue
    const from = Object.values(tree.nodes).find((n) => n.children?.includes(id))
    if (from) from.children = from.children!.filter((c) => c !== id)
    const to = tree.nodes[targetId]
    if (to && !to.children?.includes(id)) to.children = [...(to.children ?? []), id]
    const node = tree.nodes[id]
    if (node) {
      node.x = undefined // moving off the desktop clears any free position
      node.y = undefined
      if (targetId !== TRASH_ID) {
        node.deletedAt = undefined // restored / moved out of the bin
        node.deletedFrom = undefined
      }
    }
  }
}

/** Soft-delete: move nodes into the recycle bin, remembering where they came from. */
export function trashNodes(tree: FsTree, ids: string[], systemIds: ReadonlySet<string>): void {
  const trash = tree.nodes[TRASH_ID]
  if (!trash) return
  for (const id of ids) {
    if (systemIds.has(id)) continue
    const from = Object.values(tree.nodes).find((n) => n.children?.includes(id))
    if (from) from.children = from.children!.filter((c) => c !== id)
    const node = tree.nodes[id]
    if (node?.kind === 'shortcut') {
      // Removing a shortcut never moves or deletes its target. Deleting it
      // directly also avoids placing a Trash shortcut inside Trash itself.
      delete tree.nodes[id]
      continue
    }
    if (node) {
      node.deletedFrom = from?.id ?? 'files'
      node.deletedAt = Date.now()
      node.x = undefined
      node.y = undefined
    }
    if (!trash.children?.includes(id)) trash.children = [...(trash.children ?? []), id]
  }
}

/** Restore trashed nodes to where they came from (or files/ if that's gone). */
export function restoreNodes(tree: FsTree, ids: string[]): void {
  const trash = tree.nodes[TRASH_ID]
  for (const id of ids) {
    const node = tree.nodes[id]
    if (!node) continue
    const dest = (node.deletedFrom && tree.nodes[node.deletedFrom]?.kind === 'folder' && node.deletedFrom) || 'files'
    if (trash?.children) trash.children = trash.children.filter((c) => c !== id)
    node.deletedAt = undefined
    node.deletedFrom = undefined
    const to = tree.nodes[dest]
    if (to && !to.children?.includes(id)) to.children = [...(to.children ?? []), id]
  }
}

/** Permanently empty the recycle bin. */
export function emptyTrash(tree: FsTree): void {
  const trash = tree.nodes[TRASH_ID]
  if (!trash?.children) return
  removeNodes(tree, [...trash.children], new Set())
  trash.children = []
}

/** Remove nodes (and their subtrees) from the tree. */
export function removeNodes(tree: FsTree, ids: string[], systemIds: ReadonlySet<string>): void {
  const drop = (nid: string): void => {
    const n = tree.nodes[nid]
    if (n?.children) n.children.forEach(drop)
    delete tree.nodes[nid]
  }
  for (const id of ids) {
    if (systemIds.has(id)) continue
    const from = Object.values(tree.nodes).find((n) => n.children?.includes(id))
    if (from) from.children = from.children!.filter((c) => c !== id)
    drop(id)
  }
}

export function isAncestor(tree: FsTree, ancestorId: string, nodeId: string): boolean {
  let cur: string | undefined = nodeId
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    if (cur === ancestorId) return true
    const p: string = cur
    cur = Object.values(tree.nodes).find((n) => n.children?.includes(p))?.id
  }
  return false
}

export function iconFor(node: FsNode, tree?: FsTree): 'folder' | 'doc' | 'json' | 'file' | 'trash' | 'cross' {
  const displayed = node.kind === 'shortcut' && tree ? resolveShortcutTarget(tree, node) : node
  if (!displayed) return 'cross'
  if (displayed.id === TRASH_ID) return 'trash'
  if (displayed.kind === 'folder') return 'folder'
  if (/\.(md|markdown)$/i.test(displayed.name)) return 'doc'
  if (/\.json$/i.test(displayed.name)) return 'json'
  return 'file'
}
