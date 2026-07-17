import { useRef, useState, type JSX, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DoodleBox } from './DoodleBox'
import { Icon } from './Icon'
import { topWindow, useStore, type WinState } from '../store'

/**
 * A macOS-style dock at the bottom: system icons on the left, one icon per OPEN
 * window in the middle (the icon is whatever emoji/char the model invented), and
 * the system-agent toggle on the far right — which uses the crazy_os rope-ring
 * logo, because the assistant IS the system. "About" now lives only in the
 * top-left hamburger menu. Hover-hold shows a hand-drawn (Xiaolai) tooltip.
 *
 * Running-icon click cycle: minimized → restore; focused → minimize; behind → raise.
 * The whole bar layout-animates, so adding/removing an app icon springs the width.
 */
export function Dock(): JSX.Element {
  const openSettingsApp = useStore((s) => s.openSettingsApp)
  const openFilesApp = useStore((s) => s.openFilesApp)
  const toggleAgent = useStore((s) => s.toggleAgent)
  const agentOpen = useStore((s) => s.agentOpen)
  const windows = useStore((s) => s.windows)
  const minimizeWindow = useStore((s) => s.minimizeWindow)
  const restoreWindow = useStore((s) => s.restoreWindow)
  const focusWindow = useStore((s) => s.focusWindow)

  const top = topWindow(windows)
  // Windows other than the built-in apps already have their own dock entries; the
  // built-ins (settings/files) get their icons on the left, so show ALL windows here.
  const appWindows = windows

  const onWindowIcon = (instanceId: number, minimized: boolean): void => {
    if (minimized) restoreWindow(instanceId)
    else if (top?.instanceId === instanceId) minimizeWindow(instanceId)
    else focusWindow(instanceId)
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-[150000] -translate-x-1/2">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.15 }}
      >
        <DoodleBox fill="--card" radius={18} roughness={1.6}>
          <motion.div layout className="flex items-end gap-3 px-4 py-2">
            <DockIcon label="文件" onClick={() => openFilesApp()}>
              <FolderIcon />
            </DockIcon>
            <DockIcon label="系统设置" onClick={openSettingsApp}>
              <GearIcon />
            </DockIcon>

            {/* one icon per open window */}
            <AnimatePresence mode="popLayout">
              {appWindows.length > 0 && (
                <motion.div
                  layout
                  key="divider-apps"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="mx-1 h-9 w-[2px] self-center rounded bg-ink/15"
                />
              )}
              {appWindows.map((w) => (
                <motion.div
                  layout
                  key={w.instanceId}
                  initial={{ scale: 0, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  className="relative flex flex-col items-center"
                >
                  <DockIcon
                    label={
                      w.minimized
                        ? `还原 ${w.app.name}`
                        : top?.instanceId === w.instanceId
                          ? `最小化 ${w.app.name}`
                          : `切到 ${w.app.name}`
                    }
                    onClick={() => onWindowIcon(w.instanceId, w.minimized)}
                  >
                    <span className={w.minimized ? 'opacity-45' : ''}>
                      <WindowIcon win={w} />
                    </span>
                  </DockIcon>
                  <span
                    className={`absolute -bottom-0.5 h-1.5 w-1.5 rounded-full border border-ink ${
                      w.minimized ? 'bg-transparent' : 'bg-ink'
                    }`}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            <div className="mx-1 h-9 w-[2px] self-center rounded bg-ink/15" />
            <DockIcon label={agentOpen ? '收起 crazy 助手' : 'crazy 助手'} onClick={toggleAgent} markAgentToggle>
              <span className={`transition ${agentOpen ? '' : 'opacity-90'}`}>
                <img src="/icon.png" alt="" className="h-9 w-9" draggable={false} />
              </span>
            </DockIcon>
          </motion.div>
        </DoodleBox>
      </motion.div>
    </div>
  )
}

/** A window's dock glyph: hand-drawn icon for built-ins, the model's emoji/char otherwise. */
function WindowIcon({ win }: { win: WinState }): JSX.Element {
  if (win.kind === 'settings') return <Icon name="gear" size={26} />
  if (win.kind === 'files') return <Icon name="folder" size={26} />
  if (win.kind === 'fileviewer') return <Icon name="doc" size={26} />
  return <span className="text-[26px] leading-none">{win.app.icon}</span>
}

function DockIcon({
  label,
  onClick,
  markAgentToggle,
  children
}: {
  label: string
  onClick: () => void
  markAgentToggle?: boolean
  children: ReactNode
}): JSX.Element {
  const [hover, setHover] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const enter = (): void => {
    timer.current = setTimeout(() => setHover(true), 550)
  }
  const leave = (): void => {
    clearTimeout(timer.current)
    setHover(false)
  }

  return (
    <button
      aria-label={label}
      {...(markAgentToggle ? { 'data-agent-toggle': 'true' } : {})}
      onClick={() => {
        leave()
        onClick()
      }}
      onPointerEnter={enter}
      onPointerLeave={leave}
      className="relative flex h-12 w-12 items-center justify-center rounded-[12px] text-ink transition-transform duration-100 hover:-translate-y-1.5 hover:bg-marker-yellow/25"
    >
      {children}
      {/* hand-drawn (Xiaolai/doodle stack) tooltip, appears after a hover-hold */}
      <AnimatePresence>
        {hover && (
          <motion.span
            initial={{ opacity: 0, y: 6, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-[10px_6px_11px_6px] border-2 border-ink bg-card px-2.5 py-0.5 font-doodle text-sm text-ink shadow-doodle"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

function FolderIcon(): JSX.Element {
  return (
    <svg className="doodle-edge" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5c0-.6.5-1 1-1h5l2 2h9c.6 0 1 .5 1 1V18c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V6.5Z" />
    </svg>
  )
}

function GearIcon(): JSX.Element {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const cx = 12
    const cy = 12
    const r1 = 7.5
    const r2 = 10
    return <line key={i} x1={cx + Math.cos(a) * r1} y1={cy + Math.sin(a) * r1} x2={cx + Math.cos(a) * r2} y2={cy + Math.sin(a) * r2} />
  })
  return (
    <svg className="doodle-edge" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      {teeth}
    </svg>
  )
}
