import { create } from 'zustand'
import type { AppOpenPlan, AppOption, ClockConfig, UpdateStatus } from '@shared/types'
import { appInstanceKeyOf, DEFAULT_CLOCK } from '@shared/types'

type Theme = 'paper' | 'dark'

/** Which modal dialog is open (driven from the hamburger menu). */
export type Dialog = 'settings' | 'version' | null

/** One open window on the desktop. `kind` decides what renders inside the frame. */
export interface WinState {
  /** Stable per-window key; never reused within a session. */
  instanceId: number
  /** 'generated' = model-drawn iframe app; 'settings'/'files'/'fileviewer' = built-in OS apps. */
  kind: 'generated' | 'settings' | 'files' | 'fileviewer'
  app: AppOption
  minimized: boolean
  /** Stacking order. Rendering NEVER reorders the windows array (that would reload
   *  iframes) — z goes straight to style.zIndex. */
  z: number
  /** Extra requirements for the FIRST render (e.g. the system agent's open_app). */
  instructions?: string
  /** Resolver decision for this open; generated windows use it to skip review or convert a mode. */
  openPlan?: AppOpenPlan
  /** For a 'files' window opened onto a specific file, that file's id. */
  openFileId?: string
  /** Monotonic navigation request. FilesApp reacts even when the requested id is unchanged. */
  openFileRequestId?: number
  /** Per-app theme lock: 'paper'/'dark' overrides the system theme for this window; null = follow. */
  themeOverride?: Theme | null
}

const SETTINGS_APP: AppOption = { id: '__settings', name: '系统设置', icon: '⚙️', tagline: 'crazy_os 的系统功能' }
const FILES_APP: AppOption = { id: '__files', name: '文件', icon: '🗂️', tagline: '应用数据与你的文件' }

/** How the system-agent surface is presented. */
export type AgentMode = 'sidebar' | 'window'

let nextInstanceId = 1

interface OSState {
  /** Light ('paper') vs dark; mirrored onto <html class="dark"> so DoodleBox re-roughens. */
  theme: Theme
  /** Whether a real model is configured (true) or we're in mock mode (false); null = unknown. */
  live: boolean | null
  /** All open windows, in CREATION order (stacking is z, not array order). */
  windows: WinState[]
  /** Monotonic z counter; the focused window is the non-minimized one with max z. */
  zTop: number
  /** True while a window is being dragged/resized — App puts pointer-events:none on iframes. */
  interacting: boolean
  /** Is the system-agent surface open. */
  agentOpen: boolean
  /** Sidebar (docked right) vs a free-floating window. */
  agentMode: AgentMode
  /** Sidebar width in px (user-draggable). */
  agentWidth: number
  /** Desktop clock widget config (mirrors settings.json; the agent can change it). */
  clock: ClockConfig
  /** The currently open modal dialog, or null. */
  dialog: Dialog
  /** Global updater state survives closing/reopening the version dialog. */
  updateStatus: UpdateStatus

  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setDialog: (d: Dialog) => void
  setUpdateStatus: (status: UpdateStatus) => void
  setLive: (v: boolean) => void
  setInteracting: (v: boolean) => void
  toggleAgent: () => void
  closeAgent: () => void
  setAgentMode: (m: AgentMode) => void
  setAgentWidth: (w: number) => void
  /** Load the persisted clock config into the store (no re-persist). */
  hydrateClock: (c: ClockConfig) => void
  /** Merge a clock change into the store AND persist it. */
  setClock: (patch: Partial<ClockConfig>) => void

  /** Open an app window. If one with the same app identity + variant exists, focus it instead. */
  openApp: (app: AppOption, instructions?: string, openPlan?: AppOpenPlan) => number
  /** Open (or focus) the built-in OS settings window. */
  openSettingsApp: () => void
  /** Open (or focus) the built-in file manager, optionally onto a specific file. */
  openFilesApp: (openFileId?: string) => void
  /** Open (or focus) the standalone file editor window for a file. */
  openFileViewer: (fileId: string, name: string) => void
  closeWindow: (instanceId: number) => void
  minimizeWindow: (instanceId: number) => void
  restoreWindow: (instanceId: number) => void
  focusWindow: (instanceId: number) => void
  /** Lock a window to a theme ('paper'/'dark') or null to follow the system. */
  setWindowTheme: (instanceId: number, theme: Theme | null) => void
}

export const useStore = create<OSState>((set, get) => ({
  theme: 'paper',
  live: null,
  windows: [],
  zTop: 10,
  interacting: false,
  agentOpen: false,
  agentMode: 'sidebar',
  agentWidth: 380,
  clock: { ...DEFAULT_CLOCK },
  dialog: null,
  updateStatus: { phase: 'idle' },

  setDialog: (dialog) => set({ dialog }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === 'paper' ? 'dark' : 'paper'
      document.documentElement.classList.toggle('dark', theme === 'dark')
      return { theme }
    }),
  setLive: (live) => set({ live }),
  setInteracting: (interacting) => set({ interacting }),
  toggleAgent: () => set((s) => ({ agentOpen: !s.agentOpen })),
  closeAgent: () => set({ agentOpen: false }),
  setAgentMode: (agentMode) => set({ agentMode }),
  setAgentWidth: (agentWidth) => set({ agentWidth: Math.max(300, Math.min(680, agentWidth)) }),
  hydrateClock: (clock) => set({ clock }),
  setClock: (patch) =>
    set((s) => {
      const clock = { ...s.clock, ...patch }
      void window.crazyos.updateSettings({ clock })
      return { clock }
    }),

  openApp: (app, instructions, openPlan) => {
    const s = get()
    const want = appInstanceKeyOf(app)
    const existing = s.windows.find((w) => w.kind === 'generated' && appInstanceKeyOf(w.app) === want)
    if (existing) {
      const z = s.zTop + 1
      set({
        zTop: z,
        windows: s.windows.map((w) =>
          w.instanceId === existing.instanceId
            ? {
                ...w,
                minimized: false,
                z
              }
            : w
        )
      })
      return existing.instanceId
    }
    const instanceId = nextInstanceId++
    const z = s.zTop + 1
    set({
      zTop: z,
      windows: [...s.windows, { instanceId, kind: 'generated', app: { ...app }, minimized: false, z, instructions, openPlan }]
    })
    return instanceId
  },

  openSettingsApp: () => {
    const s = get()
    const existing = s.windows.find((w) => w.kind === 'settings')
    const z = s.zTop + 1
    if (existing) {
      set({
        zTop: z,
        windows: s.windows.map((w) => (w.instanceId === existing.instanceId ? { ...w, minimized: false, z } : w))
      })
      return
    }
    const instanceId = nextInstanceId++
    set({
      zTop: z,
      windows: [...s.windows, { instanceId, kind: 'settings', app: SETTINGS_APP, minimized: false, z }]
    })
  },

  openFilesApp: (openFileId) => {
    const s = get()
    const existing = s.windows.find((w) => w.kind === 'files')
    const z = s.zTop + 1
    if (existing) {
      set({
        zTop: z,
        windows: s.windows.map((w) =>
          w.instanceId === existing.instanceId
            ? { ...w, minimized: false, z, openFileId, openFileRequestId: (w.openFileRequestId ?? 0) + 1 }
            : w
        )
      })
      return
    }
    const instanceId = nextInstanceId++
    set({
      zTop: z,
      windows: [...s.windows, { instanceId, kind: 'files', app: FILES_APP, minimized: false, z, openFileId, openFileRequestId: 1 }]
    })
  },

  openFileViewer: (fileId, name) => {
    const s = get()
    const existing = s.windows.find((w) => w.kind === 'fileviewer' && w.openFileId === fileId)
    const z = s.zTop + 1
    if (existing) {
      set({
        zTop: z,
        windows: s.windows.map((w) => (w.instanceId === existing.instanceId ? { ...w, minimized: false, z } : w))
      })
      return
    }
    const instanceId = nextInstanceId++
    const app: AppOption = { id: `__fv_${fileId}`, name, icon: '📄', tagline: '文件编辑器' }
    set({ zTop: z, windows: [...s.windows, { instanceId, kind: 'fileviewer', app, minimized: false, z, openFileId: fileId }] })
  },

  closeWindow: (instanceId) => set((s) => ({ windows: s.windows.filter((w) => w.instanceId !== instanceId) })),

  minimizeWindow: (instanceId) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.instanceId === instanceId ? { ...w, minimized: true } : w))
    })),

  restoreWindow: (instanceId) =>
    set((s) => ({
      zTop: s.zTop + 1,
      windows: s.windows.map((w) =>
        w.instanceId === instanceId ? { ...w, minimized: false, z: s.zTop + 1 } : w
      )
    })),

  focusWindow: (instanceId) =>
    set((s) => {
      const win = s.windows.find((w) => w.instanceId === instanceId)
      if (!win || (!win.minimized && win.z === s.zTop)) return s
      return {
        ...s,
        zTop: s.zTop + 1,
        windows: s.windows.map((w) =>
          w.instanceId === instanceId ? { ...w, minimized: false, z: s.zTop + 1 } : w
        )
      }
    }),

  setWindowTheme: (instanceId, themeOverride) =>
    set((s) => ({ windows: s.windows.map((w) => (w.instanceId === instanceId ? { ...w, themeOverride } : w)) }))
}))

/** The focused (top-most, non-minimized) window, or null. */
export function topWindow(windows: WinState[]): WinState | null {
  let top: WinState | null = null
  for (const w of windows) {
    if (w.minimized) continue
    if (!top || w.z > top.z) top = w
  }
  return top
}
