import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DoodleBox } from './DoodleBox'
import { useStore, type Dialog } from '../store'

/** A floating, draggable top bar: hamburger menu (left) + window controls (right). */
export function TitleBar(): JSX.Element {
  const setDialog = useStore((s) => s.setDialog)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const open = (d: Dialog): void => {
    setDialog(d)
    setMenuOpen(false)
  }

  // macOS draws its own traffic-light close/min/zoom buttons top-left, so there we drop our custom
  // window controls entirely and move the hamburger to the RIGHT (clear of the native buttons).
  const isMac = window.crazyos.platform === 'darwin'

  const hamburger = (
    <div ref={menuRef} className="app-no-drag relative">
      <button
        aria-label="菜单"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition hover:bg-ink/10"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3.5" y1="6" x2="16.5" y2="6" />
          <line x1="3.5" y1="10" x2="16.5" y2="10" />
          <line x1="3.5" y1="14" x2="16.5" y2="14" />
        </svg>
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.78, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.82, y: -6 }}
            transition={{ type: 'spring', stiffness: 460, damping: 22, mass: 0.7 }}
            style={{ transformOrigin: isMac ? 'top right' : 'top left' }}
            className={`absolute top-10 w-44 ${isMac ? 'right-0' : 'left-0'}`}
          >
            <DoodleBox fill="--card" radius={10}>
              {/* Shell-level entries only (this Electron app itself); OS-level features
                  (models, theme…) live in the dock's 系统设置 app window. */}
              <div className="flex flex-col p-1.5 text-ink">
                <MenuItem icon="⚙️" label="设置" onClick={() => open('settings')} />
                <MenuItem icon="🏷️" label="版本" onClick={() => open('version')} />
              </div>
            </DoodleBox>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <div className={`app-drag absolute inset-x-0 top-0 z-[160000] flex h-10 items-center px-2 ${isMac ? 'justify-end' : 'justify-between'}`}>
      {isMac ? (
        hamburger
      ) : (
        <>
          {hamburger}
          {/* window controls (Windows/Linux only) */}
          <div className="app-no-drag flex items-center gap-1">
            <CtrlButton label="最小化" onClick={() => window.crazyos.minimizeWindow()}>
              <line x1="3" y1="8" x2="13" y2="8" />
            </CtrlButton>
            <CtrlButton label="全屏" onClick={() => window.crazyos.toggleFullscreen()}>
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
              <line x1="3" y1="6.5" x2="13" y2="6.5" />
            </CtrlButton>
            <CtrlButton label="关闭" onClick={() => window.crazyos.closeWindow()} danger>
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </CtrlButton>
          </div>
        </>
      )}
    </div>
  )
}

function CtrlButton({
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
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition ${
        danger ? 'hover:bg-marker-coral/50' : 'hover:bg-ink/10'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  )
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-left transition hover:bg-marker-yellow/40"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
