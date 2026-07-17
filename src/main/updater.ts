import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

type StatusSink = (status: UpdateStatus) => void

let currentStatus: UpdateStatus = { phase: 'idle' }
let sink: StatusSink = () => undefined
let wired = false
let busy = false
let pendingVersion: string | undefined
let prepareInstall: () => void = () => undefined

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emit(status: UpdateStatus): UpdateStatus {
  currentStatus = status
  sink(status)
  return status
}

/**
 * Wire electron-updater once. The feed itself is generated from the GitHub
 * publish block in electron-builder.yml (Utter-pulsar/crazy-os); per the
 * electron-builder contract we intentionally do not call setFeedURL here.
 */
export function registerUpdater(statusSink: StatusSink, beforeInstall: () => void): void {
  sink = statusSink
  prepareInstall = beforeInstall
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  // Installation is explicit after update-downloaded, never on an unrelated quit.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking' }))

  autoUpdater.on('update-not-available', () => {
    busy = false
    pendingVersion = undefined
    emit({ phase: 'none', message: '已是最新版本' })
  })

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    emit({ phase: 'downloading', percent: 0, version: info.version, message: `发现新版本 ${info.version}` })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
    emit({ phase: 'downloading', percent, version: pendingVersion })
  })

  autoUpdater.on('update-downloaded', (info) => {
    busy = true
    emit({ phase: 'installing', version: info.version, message: '下载完成，即将自动安装并重启' })
    // Mark this as a real quit before updater closes windows; otherwise the
    // "run in background" close interceptor could hide the window and block it.
    setTimeout(() => {
      prepareInstall()
      autoUpdater.quitAndInstall(true, true)
    }, 400)
  })

  autoUpdater.on('update-cancelled', () => {
    busy = false
    pendingVersion = undefined
    emit({ phase: 'error', message: '更新下载已取消' })
  })

  autoUpdater.on('error', (error) => {
    busy = false
    pendingVersion = undefined
    emit({ phase: 'error', message: errorMessage(error) })
  })
}

/** User-triggered check → automatic download → install → relaunch. */
export function checkForAppUpdate(): UpdateStatus {
  if (!app.isPackaged) return emit({ phase: 'dev', message: '开发模式下不检查更新' })
  if (busy) return currentStatus

  busy = true
  emit({ phase: 'checking', message: '正在检查 Utter-pulsar/crazy-os' })
  void autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result && currentStatus.phase === 'checking') {
        busy = false
        emit({ phase: 'error', message: '当前安装包没有可用的更新配置' })
      }
    })
    .catch((error) => {
      busy = false
      pendingVersion = undefined
      emit({ phase: 'error', message: errorMessage(error) })
    })
  return currentStatus
}
