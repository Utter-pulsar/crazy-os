import { useEffect, useRef, useState, type JSX } from 'react'
import { motion } from 'framer-motion'
import type { FsNode, FsTree } from '@shared/types'
import { useStore } from '../store'
import { Icon, type IconName } from './Icon'
import { Clock } from './Clock'
import { appIconUrl } from '../assets'
import { cloneInto, commitFsDraft, dispatchFs, FS_CHANGED_EVENT, getClip, iconFor, isOwnFs, moveInto as moveNodesInto, newOrigin, resolveShortcutTarget, setClip, trashNodes } from '../lib/fsClipboard'

/**
 * The desktop surface: centered branding + the contents of files/Desktop as real, interactive
 * icons. Icons free-drag to any position (persisted as x/y on the node); right-click for
 * open/rename/delete/copy/cut and, on empty space, paste / 整理 (snap to grid) / new. Del +
 * Ctrl+C/V/X work when the desktop (not a window) holds the selection. Always in sync with the
 * file manager via the FS-changed event.
 */
const GRID = { x0: 16, y0: 56, dx: 92, dy: 90, rows: 6 }
const DESKTOP_ID = 'files_desktop'

interface Menu {
  x: number
  y: number
  nodeId?: string
}

export function Desktop(): JSX.Element {
  const openFileViewer = useStore((s) => s.openFileViewer)
  const openFilesApp = useStore((s) => s.openFilesApp)
  const [tree, setTree] = useState<FsTree | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const marqueeRef = useRef<{ x: number; y: number } | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const tileRefs = useRef<Map<string, HTMLElement>>(new Map())
  const originRef = useRef(newOrigin())

  useEffect(() => {
    void window.crazyos.fsRead().then(setTree)
    const onFs = (e: Event): void => {
      if (isOwnFs(e, originRef.current)) return // our own optimistic update stands
      void window.crazyos.fsRead().then(setTree)
    }
    window.addEventListener(FS_CHANGED_EVENT, onFs)
    return () => window.removeEventListener(FS_CHANGED_EVENT, onFs)
  }, [])

  const mutate = (fn: (draft: FsTree) => void): void => {
    setTree((cur) => {
      if (!cur) return cur
      const draft: FsTree = { rootId: cur.rootId, nodes: structuredClone(cur.nodes), revision: cur.revision }
      fn(draft)
      void commitFsDraft(draft, fn)
        .then((saved) => {
          setTree(saved)
          dispatchFs(originRef.current)
        })
        .catch((err) => {
          console.error('[Desktop] filesystem commit failed:', err)
          void window.crazyos.fsRead().then(setTree)
        })
      return draft
    })
  }

  const entries: FsNode[] = tree ? (tree.nodes[DESKTOP_ID]?.children ?? []).map((id) => tree.nodes[id]).filter(Boolean) : []

  const posOf = (node: FsNode, index: number): { x: number; y: number } => {
    if (typeof node.x === 'number' && typeof node.y === 'number') return { x: node.x, y: node.y }
    const col = Math.floor(index / GRID.rows)
    const row = index % GRID.rows
    return { x: GRID.x0 + col * GRID.dx, y: GRID.y0 + row * GRID.dy }
  }

  // --- keyboard (only when the desktop, not a window/input, owns the selection) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!sel.size) return
      const ae = document.activeElement
      if (ae && ae !== document.body && ae.tagName !== 'HTML') return // a window/input has focus
      if (e.key === 'Delete') {
        mutate((d) => trashNodes(d, [...sel], new Set([DESKTOP_ID])))
        setSel(new Set())
      } else if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'c') setClip({ mode: 'copy', ids: [...sel] })
        else if (k === 'x') setClip({ mode: 'cut', ids: [...sel] })
        else if (k === 'v') paste()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  const paste = (): void => {
    const clip = getClip()
    if (!clip) return
    if (clip.mode === 'cut') {
      mutate((d) => moveNodesInto(d, clip.ids, DESKTOP_ID, new Set(['root', 'apps', 'files', 'app_soul', DESKTOP_ID])))
      setClip(null)
    } else {
      mutate((d) => clip.ids.forEach((id) => cloneInto(d, id, DESKTOP_ID)))
    }
    setMenu(null)
  }

  // Tidy: sort the desktop items, then clear free positions so they fall into the grid
  // (column-major: top→bottom, then the next column to the right).
  const createNode = (kind: 'file' | 'folder', at?: { x: number; y: number }): void => {
    const id = `${kind}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`
    mutate((d) => {
      d.nodes[id] =
        kind === 'file'
          ? { id, kind: 'file', name: '未命名.md', content: '', updatedAt: Date.now(), x: at?.x, y: at?.y }
          : { id, kind: 'folder', name: '新文件夹', children: [], updatedAt: Date.now(), x: at?.x, y: at?.y }
      const desk = d.nodes[DESKTOP_ID]
      desk.children = [...(desk.children ?? []), id]
    })
    setRenamingId(id)
    setMenu(null)
  }

  const arrange = (by: 'name' | 'type'): void => {
    mutate((d) => {
      const desk = d.nodes[DESKTOP_ID]
      if (!desk?.children) return
      const nodes = desk.children.map((id) => d.nodes[id]).filter(Boolean)
      nodes.sort((a, b) => {
        if (by === 'type' && a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      desk.children = nodes.map((n) => n.id)
      for (const n of nodes) {
        n.x = undefined
        n.y = undefined
      }
    })
    setMenu(null)
  }

  // --- free-drag an icon ---
  const onIconDown = (e: React.PointerEvent, node: FsNode, base: { x: number; y: number }): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    dragRef.current = { id: node.id, startX: e.clientX, startY: e.clientY, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // stash base so move can compute absolute
    setDrag({ id: node.id, dx: 0, dy: 0 })
    baseRef.current = base
  }
  const baseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const onIconMove = (e: React.PointerEvent): void => {
    const g = dragRef.current
    if (!g) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true
    setDrag({ id: g.id, dx, dy })
  }
  const onIconUp = (e: React.PointerEvent, node: FsNode): void => {
    const g = dragRef.current
    if (!g) return
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
    const d = drag
    setDrag(null)
    if (g.moved && d) {
      const nx = Math.max(4, baseRef.current.x + d.dx)
      const ny = Math.max(48, baseRef.current.y + d.dy)
      mutate((t) => {
        const n = t.nodes[node.id]
        if (n) {
          n.x = nx
          n.y = ny
        }
      })
    }
  }

  // --- marquee select on empty desktop ---
  const onSurfaceDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('[data-node-id]')) return
    if (e.button !== 0) return
    setMenu(null)
    setSel(new Set())
    marqueeRef.current = { x: e.clientX, y: e.clientY }
  }
  const onSurfaceMove = (e: React.PointerEvent): void => {
    const start = marqueeRef.current
    if (!start) return
    const x0 = Math.min(start.x, e.clientX)
    const y0 = Math.min(start.y, e.clientY)
    const x1 = Math.max(start.x, e.clientX)
    const y1 = Math.max(start.y, e.clientY)
    setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    const hit = new Set<string>()
    tileRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect()
      if (r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1) hit.add(id)
    })
    setSel(hit)
  }
  const onSurfaceUp = (): void => {
    marqueeRef.current = null
    setMarquee(null)
  }

  const open = (node: FsNode): void => {
    if (!tree) return
    const target = resolveShortcutTarget(tree, node)
    if (target?.kind === 'folder') openFilesApp(target.id)
    else if (target?.kind === 'file') openFileViewer(target.id, target.name)
  }

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0"
      onPointerDown={onSurfaceDown}
      onPointerMove={onSurfaceMove}
      onPointerUp={onSurfaceUp}
      onPointerCancel={onSurfaceUp}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-node-id]')) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* desktop icons */}
      {entries.map((node, i) => {
        const base = posOf(node, i)
        const isDragging = drag?.id === node.id
        const pos = isDragging ? { x: base.x + drag!.dx, y: base.y + drag!.dy } : base
        return (
          <div
            key={node.id}
            ref={(el) => {
              if (el) tileRefs.current.set(node.id, el)
              else tileRefs.current.delete(node.id)
            }}
            data-node-id={node.id}
            className="absolute"
            style={{ left: pos.x, top: pos.y, transition: isDragging ? 'none' : 'left 260ms cubic-bezier(.2,1.3,.4,1), top 260ms cubic-bezier(.2,1.3,.4,1)', zIndex: isDragging ? 50 : 1 }}
            onPointerDown={(e) => onIconDown(e, node, base)}
            onPointerMove={onIconMove}
            onPointerUp={(e) => onIconUp(e, node)}
            onClick={(e) => {
              e.stopPropagation()
              setSel((prev) => {
                if (e.ctrlKey || e.metaKey) {
                  const n = new Set(prev)
                  n.has(node.id) ? n.delete(node.id) : n.add(node.id)
                  return n
                }
                return new Set([node.id])
              })
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              open(node)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!sel.has(node.id)) setSel(new Set([node.id]))
              setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
            }}
          >
            <div
              className={`flex w-20 select-none flex-col items-center gap-1 rounded-[12px] p-2 text-ink ${
                sel.has(node.id) ? 'bg-ink/15' : 'hover:bg-ink/10'
              }`}
              title={
                node.kind === 'shortcut' && tree && !resolveShortcutTarget(tree, node)
                  ? '快捷方式目标不存在'
                  : `${node.kind === 'shortcut' ? '快捷方式 · ' : ''}双击打开 · 拖动摆放 · 右键更多`
              }
            >
              <div className="relative">
                <Icon name={iconFor(node, tree ?? undefined) as IconName} size={40} />
                {node.kind === 'shortcut' && (
                  <span className="absolute -bottom-1 -left-2 rounded-full bg-paper p-0.5 text-ink" aria-label="快捷方式">
                    <Icon name="shortcut" size={15} />
                  </span>
                )}
              </div>
              {renamingId === node.id ? (
                <RenameInput node={node} onDone={(name) => { if (name && name !== node.name) mutate((t) => { const n = t.nodes[node.id]; if (n) n.name = name }); setRenamingId(null) }} />
              ) : (
                <span
                  className="line-clamp-2 text-center text-xs leading-tight hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!dragRef.current) setRenamingId(node.id)
                  }}
                >
                  {node.name}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {marquee && <div className="marquee-box" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}

      {/* host-time clock (top-center) */}
      <Clock />

      {/* centered branding */}
      <div className="pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center gap-3">
        <img src={appIconUrl} alt="" className="h-40 w-40 opacity-95 drop-shadow-[3px_4px_0_rgba(43,43,43,0.18)]" />
        <h1 className="font-doodle text-6xl font-bold tracking-wide text-ink">Crazy OS</h1>
      </div>

      {menu && (
        <DesktopMenu
          menu={menu}
          node={menu.nodeId && tree ? tree.nodes[menu.nodeId] : undefined}
          hasClip={!!getClip()}
          selectionCount={sel.size}
          onClose={() => setMenu(null)}
          onOpen={() => {
            const n = menu.nodeId && tree ? tree.nodes[menu.nodeId] : undefined
            if (n) open(n)
            setMenu(null)
          }}
          onRename={() => {
            if (menu.nodeId) setRenamingId(menu.nodeId)
            setMenu(null)
          }}
          onDelete={() => {
            mutate((d) => trashNodes(d, menu.nodeId ? (sel.has(menu.nodeId) ? [...sel] : [menu.nodeId]) : [...sel], new Set([DESKTOP_ID])))
            setSel(new Set())
            setMenu(null)
          }}
          onCopy={() => {
            setClip({ mode: 'copy', ids: menu.nodeId ? (sel.has(menu.nodeId) ? [...sel] : [menu.nodeId]) : [...sel] })
            setMenu(null)
          }}
          onCut={() => {
            setClip({ mode: 'cut', ids: menu.nodeId ? (sel.has(menu.nodeId) ? [...sel] : [menu.nodeId]) : [...sel] })
            setMenu(null)
          }}
          onPaste={paste}
          onArrangeName={() => arrange('name')}
          onArrangeType={() => arrange('type')}
          onNewFolder={() => createNode('folder', { x: menu.x - 40, y: menu.y - 20 })}
          onNewFile={() => createNode('file', { x: menu.x - 40, y: menu.y - 20 })}
        />
      )}
    </div>
  )
}

function RenameInput({ node, onDone }: { node: FsNode; onDone: (name: string) => void }): JSX.Element {
  const [name, setName] = useState(node.name)
  return (
    <input
      autoFocus
      value={name}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => onDone(name.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') onDone(node.name)
      }}
      className="w-full rounded border-2 border-ink bg-paper px-1 text-center text-xs outline-none"
    />
  )
}

function DesktopMenu({
  menu,
  node,
  hasClip,
  selectionCount,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  onArrangeName,
  onArrangeType,
  onNewFolder,
  onNewFile
}: {
  menu: Menu
  node: FsNode | undefined
  hasClip: boolean
  selectionCount: number
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onArrangeName: () => void
  onArrangeType: () => void
  onNewFolder: () => void
  onNewFile: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // close only on a pointerdown OUTSIDE the menu — otherwise clicking a menu item would
    // unmount the menu on pointerdown and the item's click would never fire.
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
      // the menu is a DOM child of the desktop surface, whose own onPointerDown clears the menu;
      // stop the event here so clicking a menu item doesn't close the menu before the click lands.
      onPointerDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }}
      className="fixed z-[220000] w-40"
    >
      <div className="flex flex-col rounded-[10px] border-2 border-ink bg-card p-1 font-doodle text-ink shadow-doodle">
        {node ? (
          <>
            {item('打开', onOpen)}
            {item('重命名', onRename)}
            {item('复制', onCopy)}
            {item('剪切', onCut)}
            {item(selectionCount > 1 ? `删除 ${selectionCount} 项` : node.kind === 'shortcut' ? '移除快捷方式' : '删除', onDelete, true)}
          </>
        ) : (
          <>
            {item('新建文件夹', onNewFolder)}
            {item('新建文件', onNewFile)}
            {hasClip && item('粘贴', onPaste)}
            <div className="my-0.5 border-t-2 border-dashed border-ink/20" />
            {item('整理（按名称）', onArrangeName)}
            {item('整理（按类型）', onArrangeType)}
          </>
        )}
      </div>
    </motion.div>
  )
}
