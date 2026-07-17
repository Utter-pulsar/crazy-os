import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import type { FsNode, FsTree } from '@shared/types'
import { useStore, type WinState } from '../store'
import { WindowFrame } from './WindowFrame'
import { Icon, type IconName } from './Icon'
import { useDoodleScrollbar } from '../lib/useDoodleScrollbar'
import { cloneInto, commitFsDraft, dispatchFs, emptyTrash, FS_CHANGED_EVENT, getClip, iconFor, isOwnFs, moveInto as moveNodesInto, newOrigin, removeNodes, resolveShortcutTarget, restoreNodes, setClip, trashNodes, TRASH_ID } from '../lib/fsClipboard'

/**
 * The built-in file manager. Hand-drawn throughout. Dragging a tile does an INSERTION reorder
 * (siblings smoothly push aside via layout animation — never a swap); dropping onto a folder's
 * center moves it in. Click a name to rename; new items start in rename mode; right-click menu;
 * marquee box-select; Del + Ctrl+C/V/X. apps/files/soul/Desktop are locked system folders.
 * Opening a file launches the standalone editor window (not an in-app overlay).
 */
const SYSTEM_IDS = new Set(['root', 'apps', 'files', 'app_soul', 'files_desktop', 'files_trash'])

interface Menu {
  x: number
  y: number
  nodeId?: string
}

export function FilesApp({ win }: { win: WinState }): JSX.Element {
  const openFileViewer = useStore((s) => s.openFileViewer)
  const [tree, setTree] = useState<FsTree | null>(null)
  const [folderId, setFolderId] = useState('root')
  const [order, setOrder] = useState<string[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [moveInto, setMoveInto] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const tileRefs = useRef<Map<string, HTMLElement>>(new Map())
  const marqueeRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef<string | null>(null)
  const originRef = useRef(newOrigin())
  useDoodleScrollbar(gridRef)

  useEffect(() => {
    void window.crazyos.fsRead().then(setTree)
    const onFs = (e: Event): void => {
      if (isOwnFs(e, originRef.current)) return // our own change is already applied optimistically
      if (draggingRef.current) return // don't yank the tree out from under an active drag
      void window.crazyos.fsRead().then(setTree)
    }
    window.addEventListener(FS_CHANGED_EVENT, onFs)
    return () => window.removeEventListener(FS_CHANGED_EVENT, onFs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!win.openFileId) return
    let cancelled = false
    void window.crazyos.fsRead().then((fresh) => {
      if (cancelled) return
      setTree(fresh)
      const requested = fresh.nodes[win.openFileId!]
      const target = requested ? resolveShortcutTarget(fresh, requested) : null
      if (target?.kind === 'folder') setFolderId(target.id)
      else if (target?.kind === 'file') openFileViewer(target.id, target.name)
    })
    return () => {
      cancelled = true
    }
  }, [openFileViewer, win.openFileId, win.openFileRequestId])

  const folder = tree?.nodes[folderId] ?? tree?.nodes[tree.rootId]

  useEffect(() => {
    if (tree && tree.nodes[folderId]?.kind !== 'folder') setFolderId(tree.rootId)
  }, [folderId, tree])

  // keep the local display order in sync with the folder (but not mid-drag)
  useEffect(() => {
    if (draggingRef.current) return
    setOrder(folder?.children ?? [])
  }, [folder?.children, folderId])

  const mutate = (fn: (draft: FsTree) => void): void => {
    setTree((cur) => {
      if (!cur) return cur
      const draft: FsTree = { rootId: cur.rootId, nodes: structuredClone(cur.nodes), revision: cur.revision }
      fn(draft)
      // persist THEN notify (cross-view re-reads see flushed data); tag with our origin so our
      // own listener ignores it and can't clobber this optimistic update.
      void commitFsDraft(draft, fn)
        .then((saved) => {
          setTree(saved)
          dispatchFs(originRef.current)
        })
        .catch((err) => {
          console.error('[FilesApp] filesystem commit failed:', err)
          void window.crazyos.fsRead().then(setTree)
        })
      return draft
    })
  }

  const children = useMemo(() => (tree ? order.map((id) => tree.nodes[id]).filter(Boolean) : []), [tree, order])

  if (!tree || !folder) {
    return (
      <WindowFrame win={win} initialWidth={720} initialHeight={520} titleIcon={<Icon name="folder" size={19} />}>
        <div className="flex h-full items-center justify-center text-ink/50">读取中…</div>
      </WindowFrame>
    )
  }

  const path = pathTo(tree, folder.id)
  const parentOf = (id: string): FsNode | undefined => Object.values(tree.nodes).find((n) => n.children?.includes(id))
  const canEdit = (id: string): boolean => !SYSTEM_IDS.has(id)
  const openNode = (node: FsNode): void => {
    const target = resolveShortcutTarget(tree, node)
    if (target?.kind === 'folder') setFolderId(target.id)
    else if (target?.kind === 'file') openFileViewer(target.id, target.name)
  }

  const createNode = (kind: 'file' | 'folder'): void => {
    const id = `${kind}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`
    mutate((d) => {
      d.nodes[id] =
        kind === 'file'
          ? { id, kind: 'file', name: '未命名.md', content: '', updatedAt: Date.now() }
          : { id, kind: 'folder', name: '新文件夹', children: [], updatedAt: Date.now() }
      const f = d.nodes[folderId]
      f.children = [...(f.children ?? []), id]
    })
    setOrder((o) => [...o, id])
    setRenamingId(id)
    setMenu(null)
  }

  const inTrash = folder.id === TRASH_ID
  // Normal folders: Del soft-deletes (to the bin). Inside the bin: Del permanently removes.
  const del = (ids: string[]): void => {
    mutate((d) => (inTrash ? removeNodes(d, ids, SYSTEM_IDS) : trashNodes(d, ids, SYSTEM_IDS)))
    setOrder((o) => o.filter((id) => !ids.includes(id) || SYSTEM_IDS.has(id)))
    setSel(new Set())
    setMenu(null)
  }
  const restore = (ids: string[]): void => {
    mutate((d) => restoreNodes(d, ids))
    setOrder((o) => o.filter((id) => !ids.includes(id)))
    setSel(new Set())
    setMenu(null)
  }
  const empty = (): void => {
    mutate((d) => emptyTrash(d))
    setOrder([])
    setSel(new Set())
    setMenu(null)
  }

  const rename = (id: string, name: string): void => {
    if (!canEdit(id) || !name.trim()) return
    mutate((d) => {
      if (d.nodes[id]) d.nodes[id] = { ...d.nodes[id], name: name.trim(), updatedAt: Date.now() }
    })
  }

  const doCopy = (cut: boolean): void => {
    const ids = [...sel].filter(canEdit)
    if (ids.length) setClip({ mode: cut ? 'cut' : 'copy', ids })
  }
  const doPaste = (): void => {
    const clip = getClip()
    if (!clip) return
    if (clip.mode === 'cut') {
      mutate((d) => moveNodesInto(d, clip.ids, folderId, SYSTEM_IDS))
      setClip(null)
    } else {
      mutate((d) => clip.ids.forEach((id) => cloneInto(d, id, folderId)))
    }
    setMenu(null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Delete' && sel.size) {
      e.preventDefault()
      del([...sel].filter(canEdit))
      return
    }
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'c') doCopy(false)
    else if (k === 'x') doCopy(true)
    else if (k === 'v') doPaste()
    else if (k === 'a') {
      e.preventDefault()
      setSel(new Set(children.map((c) => c.id)))
    }
  }

  // --- drag: insertion reorder (push) + move-into-folder ---
  const centerHit = (el: HTMLElement, point: { x: number; y: number }): boolean => {
    const r = el.getBoundingClientRect()
    const mx = r.left + r.width / 2
    const my = r.top + r.height / 2
    return Math.abs(point.x - mx) < r.width * 0.28 && Math.abs(point.y - my) < r.height * 0.28
  }

  const onTileDrag = (id: string, info: PanInfo): void => {
    const el = document.elementFromPoint(info.point.x, info.point.y)?.closest('[data-node-id]') as HTMLElement | null
    const targetId = el?.dataset.nodeId
    if (!targetId || targetId === id) {
      setMoveInto(null)
      return
    }
    const target = tree.nodes[targetId]
    if (target?.kind === 'folder' && centerHit(el!, info.point) && canEdit(id)) {
      setMoveInto(targetId) // drop-into intent — leave the order alone
      return
    }
    setMoveInto(null)
    // insertion reorder: place `id` at the target's slot (before/after by pointer vs center)
    setOrder((o) => {
      const from = o.indexOf(id)
      let to = o.indexOf(targetId)
      if (from < 0 || to < 0) return o
      const r = el!.getBoundingClientRect()
      const after = info.point.x > r.left + r.width / 2
      const next = o.filter((x) => x !== id)
      to = next.indexOf(targetId)
      next.splice(after ? to + 1 : to, 0, id)
      return next.join() === o.join() ? o : next
    })
  }

  const onTileDragEnd = (id: string): void => {
    const into = moveInto
    setMoveInto(null)
    draggingRef.current = null
    if (into) {
      const moving = sel.has(id) ? [...sel] : [id]
      mutate((d) => moveNodesInto(d, moving, into, SYSTEM_IDS))
      setSel(new Set())
    } else {
      // commit the reordered sequence to the folder
      const committed = order
      mutate((d) => {
        const f = d.nodes[folderId]
        // keep any children not in `order` (shouldn't happen) appended
        const extra = (f.children ?? []).filter((c) => !committed.includes(c))
        f.children = [...committed, ...extra]
      })
    }
  }

  // --- marquee (box select) ---
  const onGridPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('[data-node-id]')) return
    if (e.button !== 0) return
    marqueeRef.current = { x: e.clientX, y: e.clientY }
    setSel(new Set())
    setMenu(null)
  }
  const onGridPointerMove = (e: React.PointerEvent): void => {
    const start = marqueeRef.current
    if (!start) return
    const rect = gridRef.current!.getBoundingClientRect()
    const x0 = Math.min(start.x, e.clientX)
    const y0 = Math.min(start.y, e.clientY)
    const x1 = Math.max(start.x, e.clientX)
    const y1 = Math.max(start.y, e.clientY)
    setMarquee({ x: x0 - rect.left + gridRef.current!.scrollLeft, y: y0 - rect.top + gridRef.current!.scrollTop, w: x1 - x0, h: y1 - y0 })
    const hit = new Set<string>()
    tileRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect()
      if (r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1) hit.add(id)
    })
    setSel(hit)
  }
  const onGridPointerUp = (): void => {
    marqueeRef.current = null
    setMarquee(null)
  }

  const isSystemFolder = SYSTEM_IDS.has(folder.id)

  return (
    <WindowFrame win={win} initialWidth={720} initialHeight={520} titleIcon={<Icon name="folder" size={19} />}>
      <div className="flex h-full flex-col font-doodle text-ink" tabIndex={0} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
        {/* toolbar / breadcrumb */}
        <div className="flex items-center gap-2 border-b-2 border-dashed border-ink/25 px-3 py-2">
          <button
            onClick={() => {
              const p = parentOf(folder.id)
              if (p) setFolderId(p.id)
            }}
            disabled={folder.id === 'root'}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink hover:bg-ink/10 disabled:opacity-30"
            title="上一级"
          >
            <Icon name="back" size={14} />
          </button>
          <div className="flex items-center gap-1 text-sm">
            {path.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-ink/40">/</span>}
                <button onClick={() => setFolderId(n.id)} className="rounded px-1 hover:bg-marker-yellow/40">
                  {n.id === 'root' ? 'crazy_os' : n.name}
                </button>
              </span>
            ))}
          </div>
          <span className="grow" />
          {inTrash ? (
            children.length > 0 && (
              <button onClick={empty} className="flex items-center gap-1 rounded-[8px] border-2 border-ink px-2 py-0.5 text-sm hover:bg-marker-coral/40">
                <Icon name="trash" size={13} />清空垃圾箱
              </button>
            )
          ) : (
            <>
              {getClip() && (
                <button onClick={doPaste} className="rounded-[8px] border-2 border-ink px-2 py-0.5 text-sm hover:bg-marker-yellow/40">
                  粘贴
                </button>
              )}
              <button onClick={() => createNode('file')} className="flex items-center gap-1 rounded-[8px] border-2 border-ink px-2 py-0.5 text-sm hover:bg-marker-yellow/40">
                <Icon name="plus" size={13} />文件
              </button>
              <button onClick={() => createNode('folder')} className="flex items-center gap-1 rounded-[8px] border-2 border-ink px-2 py-0.5 text-sm hover:bg-marker-yellow/40">
                <Icon name="plus" size={13} />文件夹
              </button>
            </>
          )}
        </div>

        {/* grid */}
        <div
          ref={gridRef}
          className="relative grow overflow-auto p-3"
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
          onPointerCancel={onGridPointerUp}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[data-node-id]')) return
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {children.length === 0 ? (
            <p className="pt-8 text-center text-sm text-ink/40">
              {folder.id === 'apps' ? '用过的应用会在这里各自建一个文件夹存数据。' : '这个文件夹是空的。'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {children.map((node) => (
                <Tile
                  key={node.id}
                  node={node}
                  tree={tree}
                  selected={sel.has(node.id)}
                  isDropTarget={moveInto === node.id}
                  renaming={renamingId === node.id}
                  canEdit={canEdit(node.id)}
                  registerRef={(el) => (el ? tileRefs.current.set(node.id, el) : tileRefs.current.delete(node.id))}
                  onSelect={(additive) =>
                    setSel((prev) => {
                      if (!additive) return new Set([node.id])
                      const n = new Set(prev)
                      n.has(node.id) ? n.delete(node.id) : n.add(node.id)
                      return n
                    })
                  }
                  onOpen={() => openNode(node)}
                  onStartRename={() => canEdit(node.id) && setRenamingId(node.id)}
                  onRename={(name) => {
                    rename(node.id, name)
                    setRenamingId(null)
                  }}
                  onContextMenu={(x, y) => {
                    if (!sel.has(node.id)) setSel(new Set([node.id]))
                    setMenu({ x, y, nodeId: node.id })
                  }}
                  dragging={draggingId === node.id}
                  onDragStartTile={() => {
                    draggingRef.current = node.id
                    setDraggingId(node.id)
                    if (!sel.has(node.id)) setSel(new Set([node.id]))
                  }}
                  onDragTile={(info) => onTileDrag(node.id, info)}
                  onDragEndTile={() => {
                    setDraggingId(null)
                    onTileDragEnd(node.id)
                  }}
                />
              ))}
            </div>
          )}
          {marquee && <div className="marquee-box" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>

      <AnimatePresence>
        {menu && (
          <ContextMenu
            menu={menu}
            node={menu.nodeId ? tree.nodes[menu.nodeId] : undefined}
            canEdit={menu.nodeId ? canEdit(menu.nodeId) : true}
            hasClip={!!getClip()}
            selectionCount={sel.size}
            inSystemFolder={isSystemFolder && folder.id !== 'files'}
            inTrash={inTrash}
            onRestore={() => restore(menu.nodeId ? (sel.has(menu.nodeId) ? [...sel] : [menu.nodeId]) : [...sel])}
            onEmpty={empty}
            onClose={() => setMenu(null)}
            onOpen={() => {
              const n = menu.nodeId ? tree.nodes[menu.nodeId] : undefined
              if (n) openNode(n)
              setMenu(null)
            }}
            onRename={() => {
              if (menu.nodeId) setRenamingId(menu.nodeId)
              setMenu(null)
            }}
            onDelete={() => del(menu.nodeId ? (sel.has(menu.nodeId) ? [...sel] : [menu.nodeId]) : [...sel])}
            onCopy={() => {
              doCopy(false)
              setMenu(null)
            }}
            onCut={() => {
              doCopy(true)
              setMenu(null)
            }}
            onPaste={doPaste}
            onNewFolder={() => createNode('folder')}
            onNewFile={() => createNode('file')}
          />
        )}
      </AnimatePresence>
    </WindowFrame>
  )
}

// --- helpers ----------------------------------------------------------------------

function pathTo(tree: FsTree, id: string): FsNode[] {
  const chain: FsNode[] = []
  let cur: string | undefined = id
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    const node: FsNode | undefined = tree.nodes[cur]
    if (!node) break
    chain.unshift(node)
    const childId: string = node.id
    cur = Object.values(tree.nodes).find((n) => n.children?.includes(childId))?.id
  }
  return chain
}

// --- tile -------------------------------------------------------------------------

function Tile({
  node,
  tree,
  selected,
  isDropTarget,
  renaming,
  canEdit,
  dragging,
  registerRef,
  onSelect,
  onOpen,
  onStartRename,
  onRename,
  onContextMenu,
  onDragStartTile,
  onDragTile,
  onDragEndTile
}: {
  node: FsNode
  tree: FsTree
  selected: boolean
  isDropTarget: boolean
  renaming: boolean
  canEdit: boolean
  dragging: boolean
  registerRef: (el: HTMLElement | null) => void
  onSelect: (additive: boolean) => void
  onOpen: () => void
  onStartRename: () => void
  onRename: (name: string) => void
  onContextMenu: (x: number, y: number) => void
  onDragStartTile: () => void
  onDragTile: (info: PanInfo) => void
  onDragEndTile: () => void
}): JSX.Element {
  const [name, setName] = useState(node.name)
  const dragged = useRef(false)

  return (
    <motion.div
      ref={registerRef}
      data-node-id={node.id}
      // layout="position" makes NEIGHBOURS slide (push) to their new slots when the order changes,
      // giving the insertion "挤过去" animation; the dragged tile snaps to its new slot on release.
      layout="position"
      drag={canEdit}
      dragSnapToOrigin
      dragElastic={0.12}
      whileDrag={{ scale: 1.06, zIndex: 60 }}
      // While dragging, ignore pointer events on THIS tile so the hit-test (elementFromPoint) under
      // the cursor returns the sibling underneath — otherwise it'd hit the dragged tile itself and
      // the reorder target would always be the dragged item (no reorder).
      style={{ pointerEvents: dragging ? 'none' : undefined }}
      onDragStart={() => {
        dragged.current = true
        onDragStartTile()
      }}
      onDrag={(_e, info) => onDragTile(info)}
      onDragEnd={() => {
        onDragEndTile()
        setTimeout(() => (dragged.current = false), 0)
      }}
      onClick={(e) => {
        if (dragged.current) return
        onSelect(e.ctrlKey || e.metaKey)
      }}
      onDoubleClick={() => !dragged.current && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e.clientX, e.clientY)
      }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      className={`relative flex w-24 cursor-pointer flex-col items-center gap-1 overflow-hidden rounded-[12px] border-2 p-2 ${
        isDropTarget ? 'border-marker-sky bg-marker-sky/15' : selected ? 'border-ink bg-marker-yellow/25' : 'border-transparent hover:border-ink/25 hover:bg-ink/5'
      }`}
    >
      <div className="relative">
        <Icon name={iconFor(node, tree) as IconName} size={40} />
        {node.kind === 'shortcut' && (
          <span className="absolute -bottom-1 -left-2 rounded-full bg-card p-0.5 text-ink" aria-label="快捷方式">
            <Icon name="shortcut" size={15} />
          </span>
        )}
      </div>
      {renaming ? (
        <input
          autoFocus
          value={name}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setName(node.name)
              onRename(node.name)
            }
          }}
          className="w-full rounded border-2 border-ink bg-paper px-1 text-center text-xs outline-none"
        />
      ) : (
        <span
          className="line-clamp-2 block w-full min-w-0 max-w-full break-all text-center text-xs leading-tight [overflow-wrap:anywhere] hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            if (!dragged.current && canEdit) onStartRename()
          }}
          title={
            node.kind === 'shortcut' && !resolveShortcutTarget(tree, node)
              ? `${node.name}\n快捷方式目标不存在`
              : canEdit
                ? `${node.name}\n${node.kind === 'shortcut' ? '快捷方式 · ' : ''}单击改名 · 双击打开 · 右键更多 · 拖动整理`
                : node.name
          }
        >
          {node.name}
        </span>
      )}
    </motion.div>
  )
}

// --- context menu -----------------------------------------------------------------

function ContextMenu({
  menu,
  node,
  canEdit,
  hasClip,
  selectionCount,
  inSystemFolder,
  inTrash,
  onRestore,
  onEmpty,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  onNewFolder,
  onNewFile
}: {
  menu: Menu
  node: FsNode | undefined
  canEdit: boolean
  hasClip: boolean
  selectionCount: number
  inSystemFolder: boolean
  inTrash: boolean
  onRestore: () => void
  onEmpty: () => void
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onNewFolder: () => void
  onNewFile: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // close only on a pointerdown OUTSIDE the menu (clicking an item must reach its onClick)
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const item = (label: string, fn: () => void, danger = false): JSX.Element => (
    <button onClick={fn} className={`rounded-[8px] px-3 py-1.5 text-left text-sm ${danger ? 'hover:bg-marker-coral/40' : 'hover:bg-marker-yellow/40'}`}>
      {label}
    </button>
  )

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }}
      className="fixed z-[220000] w-40"
    >
      <div className="flex flex-col rounded-[10px] border-2 border-ink bg-card p-1 font-doodle text-ink shadow-doodle">
        {node ? (
          inTrash ? (
            <>
              {item('还原', onRestore)}
              {item(selectionCount > 1 ? `彻底删除 ${selectionCount} 项` : '彻底删除', onDelete, true)}
            </>
          ) : (
            <>
              {item('打开', onOpen)}
              {canEdit && item('重命名', onRename)}
              {canEdit && item('复制', onCopy)}
              {canEdit && item('剪切', onCut)}
              {canEdit && item(selectionCount > 1 ? `删除 ${selectionCount} 项` : node.kind === 'shortcut' ? '移除快捷方式' : '删除', onDelete, true)}
              {!canEdit && <span className="px-3 py-1.5 text-sm text-ink/40">系统文件夹</span>}
            </>
          )
        ) : inTrash ? (
          item('清空垃圾箱', onEmpty, true)
        ) : (
          <>
            {!inSystemFolder && item('新建文件夹', onNewFolder)}
            {!inSystemFolder && item('新建文件', onNewFile)}
            {hasClip && !inSystemFolder && item('粘贴', onPaste)}
            {inSystemFolder && <span className="px-3 py-1.5 text-sm text-ink/40">系统文件夹</span>}
          </>
        )}
      </div>
    </motion.div>
  )
}
