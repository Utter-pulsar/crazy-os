import { type JSX, type ReactNode, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { DialogShell } from '../DialogShell'
import { DoodleToggle } from '../DoodleToggle'

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.crazyos.getSettings().then(setSettings)
  }, [])

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    setSettings((s) => (s ? { ...s, ...patch } : s)) // optimistic
    const next = await window.crazyos.updateSettings(patch)
    setSettings(next)
  }

  return (
    <DialogShell onClose={onClose}>
      <div className="flex flex-col gap-1">
        <div className="mb-2 text-xl font-bold">设置</div>

        <SettingRow label="开机自动启动" hint="开机时自动在后台启动 Crazy OS（仅安装版生效）">
          <DoodleToggle checked={!!settings?.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} />
        </SettingRow>

        <SettingRow label="关闭后保持后台运行" hint="点关闭只把窗口收进系统托盘，程序继续运行">
          <DoodleToggle checked={!!settings?.runInBackground} onChange={(v) => update({ runInBackground: v })} />
        </SettingRow>

        <button
          onClick={onClose}
          className="mt-4 self-end rounded-[10px] border-2 border-ink bg-marker-yellow/60 px-4 py-1 hover:bg-marker-yellow/80"
        >
          好的
        </button>
      </div>
    </DialogShell>
  )
}

function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b-2 border-dashed border-ink/20 py-3 last:border-none">
      <div className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-sm text-ink/50">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
