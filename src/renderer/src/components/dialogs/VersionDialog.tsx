import { type JSX, useEffect, useState } from 'react'
import type { AppInfo, UpdateStatus } from '@shared/types'
import { useStore } from '../../store'
import { appIconUrl } from '../../assets'
import { DialogShell } from '../DialogShell'

const UPDATE_REPO = 'https://github.com/Utter-pulsar/crazy-os'

function statusText(status: UpdateStatus): string {
  if (status.phase === 'checking') return '正在检查更新…'
  if (status.phase === 'downloading') {
    const version = status.version ? ` v${status.version}` : ''
    return `正在下载${version} · ${status.percent ?? 0}%`
  }
  if (status.phase === 'installing') return status.message ?? '即将自动安装并重启…'
  if (status.phase === 'none') return status.message ?? '已是最新版本 ✓'
  if (status.phase === 'dev') return status.message ?? '开发模式下不检查更新'
  if (status.phase === 'error') return `更新失败：${status.message ?? '未知错误'}`
  return '点击后会检查、下载、安装并重启'
}

export function VersionDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const status = useStore((s) => s.updateStatus)
  const setStatus = useStore((s) => s.setUpdateStatus)

  useEffect(() => {
    void window.crazyos.appInfo().then(setInfo)
  }, [])

  const busy = status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'installing'
  const check = async (): Promise<void> => {
    if (busy) return
    setStatus({ phase: 'checking', message: '正在检查 Utter-pulsar/crazy-os' })
    try {
      // Progress is authoritative from the main-process event stream. Avoid
      // letting an older IPC reply overwrite a newer download/install event.
      await window.crazyos.checkUpdate()
    } catch (error) {
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const label =
    status.phase === 'checking'
      ? '检查中…'
      : status.phase === 'downloading'
        ? `下载中 ${status.percent ?? 0}%`
        : status.phase === 'installing'
          ? '正在安装…'
          : '检查更新'

  return (
    <DialogShell onClose={onClose} width="w-[340px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <img src={appIconUrl} alt="" className="h-16 w-16" />
        <div className="text-2xl font-bold">{info?.name ?? 'Crazy OS'}</div>
        <div className="text-base opacity-70">版本 {info?.version ?? '…'}</div>
        <div className="text-sm opacity-50">作者 {info?.author ?? 'Utter_pulsar'}</div>

        <button
          onClick={() => void window.crazyos.openExternal(UPDATE_REPO)}
          className="text-xs text-marker-blue underline decoration-dotted underline-offset-4 opacity-80 hover:opacity-100"
        >
          更新源：Utter-pulsar/crazy-os
        </button>

        <div
          aria-live="polite"
          className={`mt-1 min-h-5 text-sm ${status.phase === 'error' ? 'text-marker-coral' : 'text-ink/65'}`}
          title={status.message}
        >
          {statusText(status)}
        </div>

        {status.phase === 'downloading' && (
          <div className="h-2 w-full overflow-hidden rounded-full border border-ink/30 bg-ink/10">
            <div
              className="h-full rounded-full bg-marker-blue transition-[width] duration-150"
              style={{ width: `${Math.max(0, Math.min(100, status.percent ?? 0))}%` }}
            />
          </div>
        )}

        <div className="mt-3 flex w-full gap-2">
          <button
            onClick={() => void check()}
            disabled={busy}
            className="flex-1 rounded-[10px] border-2 border-ink px-3 py-1 text-base hover:bg-marker-yellow/40 disabled:cursor-wait disabled:opacity-50"
          >
            {label}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-[10px] border-2 border-ink bg-marker-yellow/60 px-3 py-1 text-base hover:bg-marker-yellow/80"
          >
            好的
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
