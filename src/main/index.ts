import { app, shell, BrowserWindow, ipcMain, nativeImage, Tray, Menu } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type {
  AgentToolResult,
  AppRuntimeSnapshot,
  AppSettings,
  AppViewSnapshot,
  DeepPartial,
  FsTree,
  ModelPreset,
  PatchRequest,
  ResolveAppOpenRequest,
  UpdateStatus,
  ViewRequest
} from '@shared/types'
import { APP_AUTHOR, APP_NAME, USERDATA_DIR } from '@shared/constants'
import { normalizeSafeExternalUrl } from '@shared/browserRuntime'
import { isLive, patchApp, resolveSimilarSavedApp, streamView, testModel } from './model'
import { agentSend, cancelAgent, steerAgent } from './agent'
import { getSettings, maskedSettings, updateSettings } from './settings'
import { checkForAppUpdate, registerUpdater } from './updater'
import {
  deleteSession,
  ensureAppScaffold,
  getAppData,
  getAppRuntimeFiles,
  listSessions,
  loadSession,
  openAppRuntime,
  purgeExpiredTrash,
  readTree,
  resetAllAppRuntimes,
  resetAppRuntime,
  resolveAppOpen,
  saveAppView,
  setAppRuntime,
  setAppData,
  writeTreeIfCurrent
} from './fsStore'
import type { AppScaffoldStep } from './fsStore'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** Set on before-quit so the close handler knows to really quit, not hide to tray. */
let quitting = false

async function openSafeExternal(candidate: string): Promise<boolean> {
  const url = normalizeSafeExternalUrl(candidate)
  if (!url) return false
  try {
    await shell.openExternal(url)
    return true
  } catch (err) {
    console.error('[shell] failed to open external URL:', err)
    return false
  }
}

// The rope-ring logo, used as the window/taskbar icon. In dev it lives in the project
// resources/ dir; in a packaged build electron-builder copies it next to the app.
function appIcon(): Electron.NativeImage {
  const devPath = join(process.cwd(), 'resources', 'icon.png')
  const prodPath = join(process.resourcesPath, 'icon.png')
  return nativeImage.createFromPath(app.isPackaged ? prodPath : devPath)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#fbf7ef',
    // Frameless: we draw our own hand-drawn TitleBar (hamburger + window controls).
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    icon: appIcon(),
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Generated UI is rendered inside a child iframe, never in this top frame.
      // The top frame stays locked down; the only bridge is the narrow preload API.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Close → hide to tray when "run in background" is on (and it's not a real quit).
  mainWindow.on('close', (e) => {
    if (!quitting && getSettings().runInBackground) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // External links open in the real browser, never inside the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openSafeExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects the dev server URL in development; load the built file otherwise.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMain(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

// Create/destroy the tray to match the "run in background" setting.
function syncTray(): void {
  const enabled = getSettings().runInBackground
  if (enabled && !tray) {
    const image = appIcon().resize({ width: 16, height: 16 })
    tray = new Tray(image)
    tray.setToolTip(APP_NAME)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `显示 ${APP_NAME}`, click: () => showMain() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
    )
    tray.on('click', () => showMain())
  } else if (!enabled && tray) {
    tray.destroy()
    tray = null
  }
}

// Apply OS-level settings (autostart, tray) from persisted state.
function applySettings(s: AppSettings): void {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
  syncTray()
}

// ---- IPC: the renderer's only channels to the model ----

ipcMain.handle('is-live', () => isLive())

ipcMain.handle('model:test', (_e, preset: ModelPreset) => testModel(preset))

// Reveal the full key ONLY on an explicit user click in settings (getSettings stays masked).
ipcMain.handle('model:reveal-key', (_e, presetId: string) => {
  return getSettings().models.find((m) => m.id === presetId)?.apiKey ?? ''
})

// ---- IPC: OS shell ----

ipcMain.handle('shell:open-external', (event, candidate: unknown) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof candidate !== 'string') return false
  return openSafeExternal(candidate)
})

ipcMain.handle('app:info', () => ({
  name: APP_NAME,
  version: app.getVersion(),
  author: APP_AUTHOR
}))

// The renderer only ever sees masked API keys (a same-origin iframe can reach the
// bridge through `parent`, so clear-text keys must never cross into the renderer).
ipcMain.handle('settings:get', () => maskedSettings())

ipcMain.handle('settings:update', (_e, patch: DeepPartial<AppSettings>) => {
  updateSettings(patch)
  applySettings(getSettings())
  return maskedSettings()
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()))
ipcMain.on('window:close', () => mainWindow?.close())

ipcMain.handle('update:check', (event): UpdateStatus => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { phase: 'error', message: '无效的更新请求' }
  }
  return checkForAppUpdate()
})

ipcMain.handle('app:resolve-open', async (_e, req: ResolveAppOpenRequest) => {
  let resolved = resolveAppOpen(req)
  // Exact names, aliases and containment are resolved locally. Only a genuinely
  // new id pays for the conservative semantic pass, and that pass can choose
  // only from ids that already exist under apps/.
  if (!getAppData(resolved.app.id)) {
    const similarId = await resolveSimilarSavedApp(req)
    if (similarId) resolved = resolveAppOpen(req, similarId)
  }
  return resolved
})

// ---- view generation, with cancellation (closing a window aborts its stream) ----

const viewAborts = new Map<string, AbortController>()

ipcMain.handle('generate-view', async (event, req: ViewRequest, streamId: string) => {
  const id = streamId || `v_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const sender = event.sender
  const abort = new AbortController()
  viewAborts.set(id, abort)
  try {
    const html = await streamView(
      req,
      (text) => {
        if (!sender.isDestroyed()) sender.send('view:chunk', { streamId: id, text })
      },
      abort.signal
    )
    return { streamId: id, html }
  } catch (err) {
    if (abort.signal.aborted) return { streamId: id, html: '', cancelled: true }
    throw err
  } finally {
    viewAborts.delete(id)
  }
})

ipcMain.on('cancel-view', (_e, streamId: string) => {
  viewAborts.get(streamId)?.abort()
})

ipcMain.handle('patch-view', async (_e, req: PatchRequest) => patchApp(req))

// ---- system agent: turn driver + the renderer tool-execution bridge ----

// The agent loop lives in main, but every tool touches windows/DOM that only the
// renderer has. Main sends 'agent:tool' and awaits the matching 'agent:tool-result'.
let toolSeq = 0
const pendingTools = new Map<string, (res: AgentToolResult) => void>()

function execToolInRenderer(tool: string, args: Record<string, unknown>): Promise<AgentToolResult> {
  const callId = `tool_${++toolSeq}`
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve({ callId, ok: false, result: '主窗口不存在' })
      return
    }
    pendingTools.set(callId, resolve)
    mainWindow.webContents.send('agent:tool', { callId, tool, args })
    setTimeout(() => {
      if (pendingTools.delete(callId)) resolve({ callId, ok: false, result: '工具执行超时（240s）' })
    }, 240_000)
  })
}

ipcMain.on('agent:tool-result', (_e, res: AgentToolResult) => {
  const resolve = pendingTools.get(res.callId)
  if (resolve) {
    pendingTools.delete(res.callId)
    resolve(res)
  }
})

ipcMain.handle('agent:send', async (event, sessionId: string, text: string, modelId: string, thinking: boolean) => {
  const sender = event.sender
  await agentSend(
    sessionId,
    text,
    modelId,
    !!thinking,
    (ev) => {
      if (!sender.isDestroyed()) sender.send('agent:event', ev)
    },
    execToolInRenderer
  )
})

ipcMain.handle('agent:steer', (_event, sessionId: string, text: string) => steerAgent(sessionId, text))
ipcMain.on('agent:cancel', (_e, sessionId: string) => cancelAgent(sessionId))
ipcMain.handle('agent:sessions', () => listSessions())
ipcMain.handle('agent:load-session', (_e, id: string) => loadSession(id))
ipcMain.handle('agent:delete-session', (_e, id: string) => deleteSession(id))

// ---- virtual file system + per-app memory ----

ipcMain.handle('fs:read', () => readTree())
ipcMain.handle('fs:write', (_e, tree: FsTree) => writeTreeIfCurrent(tree))
ipcMain.handle('appdata:get', (_e, appId: string) => getAppData(appId))
ipcMain.handle('appscaffold:ensure', (_e, appId: string, name: string, variantKey?: string, step?: AppScaffoldStep) => {
  return ensureAppScaffold(appId, name, variantKey, step)
})
ipcMain.handle('appdata:set', (_e, appId: string, name: string, state: unknown) => {
  setAppData(appId, name, state)
})
ipcMain.handle('appview:set', (_e, snapshot: AppViewSnapshot) => {
  return saveAppView(snapshot)
})
ipcMain.handle('appruntime:open', (_e, appId: string, name: string, variantKey?: string, requestedAlias?: string) => {
  return openAppRuntime(appId, name, variantKey, requestedAlias)
})
ipcMain.handle('appruntime:get', (_e, appId: string, name: string, variantKey?: string) => {
  return getAppRuntimeFiles(appId, name, variantKey)
})
ipcMain.handle('appruntime:set', (_e, snapshot: AppRuntimeSnapshot) => {
  return setAppRuntime(snapshot)
})
ipcMain.handle('appruntime:reset', (_e, appId: string, name: string, variantKey?: string) => {
  return resetAppRuntime(appId, name, variantKey)
})
// Single instance: a second launch focuses the existing window instead of starting a rival
// process that fights over the userData cache.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => showMain())

app.whenReady().then(() => {
  app.setName(APP_NAME)
  // Dev gets its own userData folder so it never touches an installed copy's data.
  // Must run before any window/persistence reads app.getPath('userData').
  if (!app.isPackaged) {
    const devData = join(app.getPath('appData'), `${USERDATA_DIR}-dev`)
    mkdirSync(devData, { recursive: true })
    app.setPath('userData', devData)
  }

  registerUpdater(
    (status) => {
      const window = mainWindow
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      window.webContents.send('update:status', status)
    },
    () => {
      quitting = true
    }
  )

  resetAllAppRuntimes() // a process restart also means every app is closed
  createWindow()
  applySettings(getSettings())
  purgeExpiredTrash() // drop recycle-bin items older than 30 days

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMain()
  })
})

app.on('before-quit', () => {
  quitting = true
  // This is synchronous: no temporary navigation is left behind even if the
  // renderer is destroyed before React cleanup promises can finish.
  resetAllAppRuntimes()
})

app.on('window-all-closed', () => {
  // With "run in background" the window only hides, so we won't reach here until a real
  // quit. Without it, closing the last window quits (except on macOS).
  if (process.platform !== 'darwin') app.quit()
})
