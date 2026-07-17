import { useEffect, type JSX } from 'react'
import { AnimatePresence } from 'framer-motion'
import { topWindow, useStore } from './store'
import { Desktop } from './components/Desktop'
import { AppWindow } from './components/AppWindow'
import { SettingsApp } from './components/SettingsApp'
import { FilesApp } from './components/FilesApp'
import { FileViewerApp } from './components/FileViewerApp'
import { AgentPanel } from './components/AgentPanel'
import { TitleBar } from './components/TitleBar'
import { Dock } from './components/Dock'
import { DoodleFilter } from './components/DoodleFilter'
import { VersionDialog } from './components/dialogs/VersionDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { initAgentTools } from './agentTools'

export function App(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const setLive = useStore((s) => s.setLive)
  const windows = useStore((s) => s.windows)
  const interacting = useStore((s) => s.interacting)
  const dialog = useStore((s) => s.dialog)
  const setDialog = useStore((s) => s.setDialog)

  // One-time wiring: theme, live-mode flag, agent tool bridge, keyboard shortcuts.
  useEffect(() => {
    setTheme(theme)
    void window.crazyos.isLive().then(setLive)
    void window.crazyos.getSettings().then((s) => useStore.getState().hydrateClock(s.clock))
    const offTools = initAgentTools()
    const offUpdate = window.crazyos.onUpdateStatus((status) => useStore.getState().setUpdateStatus(status))

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Don't steal Esc from text fields such as the agent panel input.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
        const s = useStore.getState()
        if (s.dialog) s.setDialog(null)
        else {
          // Close the top-most (focused) window; Esc inside an iframe reaches us via
          // the host script's forwarded message instead (events don't cross iframes).
          const top = topWindow(s.windows)
          if (top) s.closeWindow(top.instanceId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offTools()
      offUpdate()
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // `iframes-inert` (while dragging/resizing any window) keeps iframes from
    // swallowing pointermove — without it a drag dies the moment the cursor
    // crosses another window's content.
    <div className={`relative h-full w-full overflow-hidden ${interacting ? 'iframes-inert' : ''}`}>
      <DoodleFilter />
      <Desktop />
      {/* Windows render in CREATION order — stacking is style.zIndex. Reordering this
          list would remount iframes and wipe their content. AnimatePresence gives each
          a springy open and a fade-out close. */}
      <AnimatePresence>
        {windows.map((w) =>
          w.kind === 'settings' ? (
            <SettingsApp key={w.instanceId} win={w} />
          ) : w.kind === 'files' ? (
            <FilesApp key={w.instanceId} win={w} />
          ) : w.kind === 'fileviewer' ? (
            <FileViewerApp key={w.instanceId} win={w} />
          ) : (
            <AppWindow key={w.instanceId} win={w} />
          )
        )}
      </AnimatePresence>
      <Dock />
      {/* Always mounted (even when collapsed) so a running turn keeps streaming and reopening
          shows the live conversation instead of a fresh session. */}
      <AgentPanel />
      <TitleBar />
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'version' && <VersionDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
