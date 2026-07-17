import { useRef, useState, type JSX, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useStore, type WinState } from '../store'
import { DoodleBox } from './DoodleBox'

/**
 * The OS-style window shell shared by every window kind: hand-drawn frame, draggable
 * title bar, 8-way resize, stacking (z via style.zIndex — the windows array is NEVER
 * reordered, that would reload iframes), and minimize-to-dock.
 *
 * While any drag/resize is active the store's `interacting` flag puts
 * pointer-events:none on every iframe (App root class), otherwise iframes swallow
 * pointermove and windows get stuck mid-drag.
 */

const MIN_W = 340
const MIN_H = 240

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const DIRS: Array<{ dir: ResizeDir; className: string; cursor: string }> = [
  { dir: 'n', className: 'rzh-n', cursor: 'ns-resize' },
  { dir: 's', className: 'rzh-s', cursor: 'ns-resize' },
  { dir: 'e', className: 'rzh-e', cursor: 'ew-resize' },
  { dir: 'w', className: 'rzh-w', cursor: 'ew-resize' },
  { dir: 'ne', className: 'rzh-ne', cursor: 'nesw-resize' },
  { dir: 'nw', className: 'rzh-nw', cursor: 'nwse-resize' },
  { dir: 'se', className: 'rzh-se', cursor: 'nwse-resize' },
  { dir: 'sw', className: 'rzh-sw', cursor: 'nesw-resize' }
]

export function WindowFrame({
  win,
  initialWidth,
  initialHeight,
  title,
  titleIcon,
  children
}: {
  win: WinState
  initialWidth?: number
  initialHeight?: number
  /** Override the title text shown in the frame. */
  title?: string
  /** Hand-drawn icon node for built-in apps; falls back to the app's emoji/char. */
  titleIcon?: ReactNode
  children: ReactNode
}): JSX.Element {
  const closeWindow = useStore((s) => s.closeWindow)
  const minimizeWindow = useStore((s) => s.minimizeWindow)
  const focusWindow = useStore((s) => s.focusWindow)
  const setInteracting = useStore((s) => s.setInteracting)

  const [maxed, setMaxed] = useState(false)
  // Live geometry stays in local state during drag/resize (a per-frame store write would
  // re-render the whole desktop); the store only carries minimized/z.
  const W = initialWidth ?? Math.min(880, window.innerWidth * 0.92)
  const H = initialHeight ?? window.innerHeight * 0.78
  const [rect, setRect] = useState(() => {
    const cascade = ((win.instanceId - 1) % 5) * 26
    return {
      x: Math.max(12, (window.innerWidth - W) / 2 + cascade),
      y: Math.max(48, (window.innerHeight - H) / 2 - 10 + cascade * 0.6),
      w: W,
      h: H
    }
  })
  const [interactingLocal, setInteractingLocal] = useState(false)
  const gestureRef = useRef<{
    kind: 'drag' | ResizeDir
    startX: number
    startY: number
    rect: { x: number; y: number; w: number; h: number }
  } | null>(null)

  const shown = maxed
    ? { x: 8, y: 46, w: window.innerWidth - 16, h: window.innerHeight - 150 }
    : rect

  const beginGesture = (e: React.PointerEvent, kind: 'drag' | ResizeDir): void => {
    if (e.button !== 0 || maxed) return
    // preventDefault on pointerdown suppresses the derived dblclick — which would kill
    // the title bar's double-click-to-maximize — so only resize handles get it.
    if (kind !== 'drag') e.preventDefault()
    e.stopPropagation()
    gestureRef.current = { kind, startX: e.clientX, startY: e.clientY, rect }
    setInteractingLocal(true)
    setInteracting(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const moveGesture = (e: React.PointerEvent): void => {
    const g = gestureRef.current
    if (!g) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (g.kind === 'drag') {
      setRect({
        ...g.rect,
        x: Math.min(window.innerWidth - 80, Math.max(-g.rect.w + 120, g.rect.x + dx)),
        y: Math.min(window.innerHeight - 40, Math.max(4, g.rect.y + dy))
      })
      return
    }
    let { x, y, w, h } = g.rect
    if (g.kind.includes('e')) w = g.rect.w + dx
    if (g.kind.includes('s')) h = g.rect.h + dy
    if (g.kind.includes('w')) {
      w = g.rect.w - dx
      x = g.rect.x + dx
    }
    if (g.kind.includes('n')) {
      h = g.rect.h - dy
      y = g.rect.y + dy
    }
    if (w < MIN_W) {
      if (g.kind.includes('w')) x -= MIN_W - w
      w = MIN_W
    }
    if (h < MIN_H) {
      if (g.kind.includes('n')) y -= MIN_H - h
      h = MIN_H
    }
    y = Math.max(4, y)
    setRect({ x, y, w, h })
  }

  const endGesture = (e: React.PointerEvent): void => {
    if (!gestureRef.current) return
    gestureRef.current = null
    setInteractingLocal(false)
    setInteracting(false)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
  }

  return (
    <motion.div
      className={`absolute rounded-[14px] bg-card window-shadow ${
        interactingLocal ? '' : 'transition-[left,top,width,height] duration-200 ease-out'
      }`}
      style={{
        left: shown.x,
        top: shown.y,
        width: shown.w,
        height: shown.h,
        zIndex: win.z,
        pointerEvents: win.minimized ? 'none' : 'auto'
      }}
      onPointerDownCapture={() => focusWindow(win.instanceId)}
      initial={{ scale: 0.68, opacity: 0, y: 22 }}
      animate={
        win.minimized
          ? { scale: 0.12, opacity: 0, y: window.innerHeight * 0.5 }
          : { scale: 1, opacity: 1, y: 0 }
      }
      exit={{ scale: 0.55, opacity: 0, y: 16, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 460, damping: 22, mass: 0.85 }}
    >
      <DoodleBox fill="--card" radius={14} className="absolute inset-0" />

      {/* resize handles: invisible hit areas on all 4 edges + 4 corners; the inner bar
          is the hand-drawn affordance that appears/thickens on hover */}
      {!maxed &&
        DIRS.map(({ dir, className, cursor }) => (
          <div
            key={dir}
            className={`rzh ${className}`}
            style={{ cursor }}
            onPointerDown={(e) => beginGesture(e, dir)}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <div className="rzh-bar" />
          </div>
        ))}

      <div className="relative flex h-full w-full flex-col">
        <div
          onPointerDown={(e) => {
            // buttons handle their own clicks
            if ((e.target as HTMLElement).closest('button')) return
            beginGesture(e, 'drag')
          }}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onDoubleClick={() => setMaxed((v) => !v)}
          className={`relative flex select-none items-center gap-2 border-b-2 border-dashed border-ink/25 px-3 py-2 ${
            maxed ? '' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          {titleIcon ?? <span className="text-lg leading-none">{win.app.icon}</span>}
          <span className="max-w-[55%] truncate font-doodle font-bold text-ink">{title ?? win.app.name}</span>
          <span className="grow" />
          <WinBtn label="最小化" onClick={() => minimizeWindow(win.instanceId)}>
            <line x1="4" y1="11" x2="12" y2="11" />
          </WinBtn>
          <WinBtn label={maxed ? '还原' : '窗口内全屏'} onClick={() => setMaxed((v) => !v)}>
            <rect x="4" y="4" width="8" height="8" rx="1.5" />
          </WinBtn>
          <WinBtn label="关闭 (Esc)" onClick={() => closeWindow(win.instanceId)} danger>
            <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" />
            <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" />
          </WinBtn>
        </div>

        <div className="relative grow overflow-hidden rounded-b-[14px]">{children}</div>
      </div>
    </motion.div>
  )
}

function WinBtn({
  label,
  onClick,
  danger,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink text-ink transition ${
        danger ? 'hover:bg-marker-coral/50' : 'hover:bg-ink/10'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  )
}
