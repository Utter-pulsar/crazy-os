import { useEffect, useRef, useState, type JSX } from 'react'
import { motion } from 'framer-motion'
import type { AppInfo, AppSettings, ModelPreset, ModelProtocol } from '@shared/types'
import { defaultBaseUrlFor, detectProtocol, KNOWN_DEFAULT_BASE_URLS } from '@shared/types'
import { useStore, type WinState } from '../store'
import { WindowFrame } from './WindowFrame'
import { DoodleToggle } from './DoodleToggle'
import { DoodleInput, DoodleTextarea } from './DoodleField'
import { Icon, type IconName } from './Icon'
import { useDoodleScrollbar } from '../lib/useDoodleScrollbar'

const PROTO_LABEL: Record<ModelProtocol, string> = {
  openai: 'OpenAI',
  'openai-responses': 'Codex',
  anthropic: 'Anthropic'
}

type Page = 'models' | 'appearance' | 'system' | 'about'
const NAV: Array<{ key: Page; icon: IconName; label: string }> = [
  { key: 'models', icon: 'soul', label: 'crazy模型' },
  { key: 'appearance', icon: 'palette', label: '外观' },
  { key: 'system', icon: 'monitor', label: '系统' },
  { key: 'about', icon: 'tag', label: '关于' }
]

/**
 * The built-in OS settings app (kind:'settings'). Pre-written React — never model
 * generated. Left nav / right detail; the first page is the soul-model CRUD:
 * multiple presets (Anthropic / OpenAI format), test-connection gating and one
 * active model that drives the whole OS.
 *
 * API keys arrive MASKED from main ("••••" + last 4); sending a masked key back
 * means "keep the stored one", so the clear key never exists in this process.
 */
export function SettingsApp({ win }: { win: WinState }): JSX.Element {
  const [page, setPage] = useState<Page>('models')
  const scrollRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(scrollRef)

  return (
    <WindowFrame win={win} initialWidth={720} initialHeight={520} titleIcon={<Icon name="gear" size={19} />}>
      <div className="flex h-full font-doodle text-ink">
        <nav className="flex w-40 shrink-0 flex-col gap-1 border-r-2 border-dashed border-ink/25 p-2">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setPage(n.key)}
              className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-left transition ${
                page === n.key ? 'bg-marker-yellow/50 font-bold' : 'hover:bg-ink/5'
              }`}
            >
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div ref={scrollRef} className="grow overflow-auto p-4">
          {/* Q弹 page transition: the `key` remounts on page change so the new content springs
              in immediately — no AnimatePresence "wait" for the old page's exit (that was the lag). */}
          <motion.div
            key={page}
            initial={{ opacity: 0, x: 20, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 480, damping: 26 }}
          >
            {page === 'models' && <ModelsPage />}
            {page === 'appearance' && <AppearancePage />}
            {page === 'system' && <SystemPage />}
            {page === 'about' && <AboutPage />}
          </motion.div>
        </div>
      </div>
    </WindowFrame>
  )
}

// --- crazy模型: preset CRUD + test + activate --------------------------------------


function freshPreset(): ModelPreset {
  return {
    id: `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`,
    label: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    validated: false
  }
}

function ModelsPage(): JSX.Element {
  const setLive = useStore((s) => s.setLive)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void window.crazyos.getSettings().then((s) => {
      setSettings(s)
      setEditingId(s.activeModelId || s.models[0]?.id || null)
    })
  }, [])

  const persist = async (models: ModelPreset[], activeModelId?: string): Promise<void> => {
    const next = await window.crazyos.updateSettings({
      models,
      ...(activeModelId !== undefined ? { activeModelId } : {})
    })
    setSettings(next)
    void window.crazyos.isLive().then(setLive)
    // let the crazy 助手 panel pick up the new model list / active model immediately
    window.dispatchEvent(new CustomEvent('crazyos:settings'))
  }

  if (!settings) return <p className="text-ink/50">读取中…</p>

  const models = settings.models
  const editing = models.find((m) => m.id === editingId) ?? null

  const patchEditing = (p: Partial<ModelPreset>): void => {
    if (!editing) return
    // Any field change invalidates the previous 测试连接 result.
    const next = models.map((m) => (m.id === editing.id ? { ...m, ...p, validated: false } : m))
    setSettings({ ...settings, models: next })
    setTestResult(null)
  }

  const saveEditing = (): void => {
    void persist(models)
  }

  const addPreset = (): void => {
    const p = freshPreset()
    const next = [...models, p]
    setSettings({ ...settings, models: next })
    setEditingId(p.id)
    setTestResult(null)
    void persist(next, models.length === 0 ? p.id : undefined)
  }

  const removePreset = (id: string): void => {
    const next = models.filter((m) => m.id !== id)
    const nextActive = settings.activeModelId === id ? (next[0]?.id ?? '') : settings.activeModelId
    setSettings({ ...settings, models: next, activeModelId: nextActive })
    if (editingId === id) setEditingId(next[0]?.id ?? null)
    void persist(next, nextActive)
  }

  const activate = (id: string): void => {
    void persist(models, id)
  }

  const test = async (): Promise<void> => {
    if (!editing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.crazyos.testModel(editing)
      setTestResult(res)
      if (res.ok) {
        const next = models.map((m) => (m.id === editing.id ? { ...m, validated: true } : m))
        setSettings({ ...settings, models: next })
        void persist(next)
      }
    } finally {
      setTesting(false)
    }
  }

  // Reveal the FULL key on demand: the stored value is masked (••••1234), so on first "show" we
  // fetch the real key from main and drop it into the field. Toggle FIRST so the button always
  // responds even if the reveal call fails.
  const revealToggle = async (): Promise<void> => {
    const next = !showKey
    setShowKey(next)
    if (next && editing && editing.apiKey.startsWith('••••')) {
      try {
        const real = await window.crazyos.revealModelKey?.(editing.id)
        if (real) setSettings((s) => (s ? { ...s, models: s.models.map((m) => (m.id === editing.id ? { ...m, apiKey: real } : m)) } : s))
      } catch (err) {
        console.error('[settings] reveal key failed:', err)
      }
    }
  }

  // Flip the wire format; if the URL is still an untouched default, swap it to match.
  const setProtocol = (proto: ModelProtocol): void => {
    if (!editing) return
    const isDefault = !editing.baseUrl || KNOWN_DEFAULT_BASE_URLS.includes(editing.baseUrl.trim())
    patchEditing(isDefault ? { provider: proto, baseUrl: defaultBaseUrlFor(proto) } : { provider: proto })
    void persist(models.map((m) => (m.id === editing.id ? { ...m, provider: proto, validated: false } : m)))
  }
  const providerHint = editing ? detectProtocol(editing) : null

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-lg font-bold">crazy模型</div>
        <div className="text-sm text-ink/50">整台系统都由当前启用的模型实时想象出来。可以保存多个，随时切换。</div>
      </div>

      {/* preset list */}
      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <div
            key={m.id}
            onClick={() => {
              setEditingId(m.id)
              setTestResult(null)
              setShowKey(false)
            }}
            className={`flex cursor-pointer items-center gap-2 rounded-[10px] border-2 px-3 py-1.5 ${
              m.id === editingId ? 'border-ink bg-marker-yellow/20' : 'border-ink/25 hover:border-ink/60'
            }`}
          >
            <span className="font-bold">{m.label || m.model || '（未命名）'}</span>
            <span className="rounded-full border border-ink/40 px-1.5 text-xs text-ink/60">{PROTO_LABEL[m.provider]}</span>
            {m.validated && (
              <span className="flex items-center gap-0.5 text-xs text-ink/60">
                <Icon name="check" size={12} /> 已验证
              </span>
            )}
            <span className="grow" />
            {settings.activeModelId === m.id ? (
              <span className="rounded-full bg-marker-yellow/70 px-2 text-sm">正在使用</span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  activate(m.id)
                }}
                className="rounded-full border-2 border-ink px-2 text-sm hover:bg-marker-yellow/40"
              >
                启用
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                removePreset(m.id)
              }}
              title="删除"
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink hover:bg-marker-coral/40"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        <button
          onClick={addPreset}
          className="self-start rounded-[10px] border-2 border-dashed border-ink/50 px-3 py-1 text-ink/70 hover:border-ink hover:text-ink"
        >
          ＋ 添加模型
        </button>
      </div>

      {/* editor */}
      {editing && (
        <div className="flex flex-col gap-2.5 border-t-2 border-dashed border-ink/20 pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink/70">显示名称（随意起）</span>
            <DoodleInput
              value={editing.label}
              placeholder="比如：本地网关 Claude"
              onChange={(e) => patchEditing({ label: e.target.value })}
              onBlur={saveEditing}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-ink/70">
              接口格式
              {providerHint && providerHint !== editing.provider && (
                <span className="ml-2 text-xs text-marker-coral">看起来像 {PROTO_LABEL[providerHint]} 格式？</span>
              )}
            </span>
            <div className="flex overflow-hidden rounded-[12px] border-2 border-ink">
              <ProviderTab label="OpenAI" active={editing.provider === 'openai'} onClick={() => setProtocol('openai')} />
              <div className="w-[2px] bg-ink" />
              <ProviderTab label="Codex" active={editing.provider === 'openai-responses'} onClick={() => setProtocol('openai-responses')} />
              <div className="w-[2px] bg-ink" />
              <ProviderTab label="Anthropic" active={editing.provider === 'anthropic'} onClick={() => setProtocol('anthropic')} />
            </div>
            {editing.provider === 'openai-responses' && (
              <span className="text-xs text-ink/50">用于 Codex / GPT‑5 代理：走 Responses API（/v1/responses）。</span>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink/70">API Key（保存后只显示尾号）</span>
            <div className="relative">
              {showKey ? (
                // revealed: a wrapping textarea so a long key wraps onto multiple lines
                <DoodleTextarea
                  rows={2}
                  placeholder={editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                  value={editing.apiKey}
                  onChange={(e) => patchEditing({ apiKey: e.target.value })}
                  onBlur={saveEditing}
                  className="w-full [&_textarea]:break-all [&_textarea]:pr-9"
                />
              ) : (
                <DoodleInput
                  type="password"
                  placeholder={editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                  value={editing.apiKey}
                  onChange={(e) => patchEditing({ apiKey: e.target.value })}
                  onBlur={saveEditing}
                  className="w-full [&_input]:pr-9"
                />
              )}
              <button
                type="button"
                onClick={() => void revealToggle()}
                title={showKey ? '隐藏' : '显示完整 key'}
                className="absolute right-2 top-2 z-[1] text-ink/60 hover:text-ink"
              >
                <Icon name={showKey ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink/70">
              模型 API 地址（{PROTO_LABEL[editing.provider]} 格式，可留空用官方默认）
            </span>
            <DoodleInput
              placeholder={defaultBaseUrlFor(editing.provider)}
              value={editing.baseUrl}
              onChange={(e) => patchEditing({ baseUrl: e.target.value })}
              onBlur={saveEditing}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink/70">模型名称（可选，留空用默认）</span>
            <DoodleInput
              placeholder={editing.provider === 'anthropic' ? 'claude-sonnet-4-6' : editing.provider === 'openai-responses' ? 'gpt-5' : 'gpt-4o'}
              value={editing.model}
              onChange={(e) => patchEditing({ model: e.target.value })}
              onBlur={saveEditing}
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void test()}
              disabled={testing}
              className="rounded-[10px] border-2 border-ink bg-marker-yellow/60 px-4 py-1 hover:bg-marker-yellow/80 disabled:opacity-50"
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? 'text-ink/70' : 'text-marker-coral'}`}>
                {testResult.ok ? '✓ ' : '✗ '}
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProviderTab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 transition ${active ? 'bg-marker-yellow/70 font-bold' : 'hover:bg-ink/5'}`}
    >
      {label}
    </button>
  )
}

// --- 外观 / 系统 / 关于 --------------------------------------------------------------

function AppearancePage(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-bold">外观</div>
      <div className="flex items-center justify-between border-b-2 border-dashed border-ink/20 py-3">
        <div className="flex flex-col">
          <span>夜色模式</span>
          <span className="text-sm text-ink/50">整张纸翻到深色的那一面</span>
        </div>
        <DoodleToggle checked={theme === 'dark'} onChange={() => toggleTheme()} />
      </div>
    </div>
  )
}

function SystemPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.crazyos.getSettings().then(setSettings)
  }, [])

  const update = async (patch: Partial<Pick<AppSettings, 'launchAtLogin' | 'runInBackground'>>): Promise<void> => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    const next = await window.crazyos.updateSettings(patch)
    setSettings(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 text-lg font-bold">系统</div>
      <div className="flex items-center justify-between gap-4 border-b-2 border-dashed border-ink/20 py-3">
        <div className="flex flex-col">
          <span>开机自动启动</span>
          <span className="text-sm text-ink/50">开机时自动在后台启动 Crazy OS（仅安装版生效）</span>
        </div>
        <DoodleToggle checked={!!settings?.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
      </div>
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="flex flex-col">
          <span>关闭后保持后台运行</span>
          <span className="text-sm text-ink/50">点关闭只把窗口收进系统托盘，程序继续运行</span>
        </div>
        <DoodleToggle checked={!!settings?.runInBackground} onChange={(v) => void update({ runInBackground: v })} />
      </div>
    </div>
  )
}

function AboutPage(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.crazyos.appInfo().then(setInfo)
  }, [])
  return (
    <div className="flex flex-col gap-2">
      <div className="text-lg font-bold">关于</div>
      <p>
        {info ? `${info.name} v${info.version}` : '…'}
        <span className="ml-2 text-sm text-ink/50">by {info?.author ?? ''}</span>
      </p>
      <p className="text-sm text-ink/50">一个手绘风格的想象操作系统：界面是模型现写的文件，系统把它实时画出来。</p>
    </div>
  )
}
