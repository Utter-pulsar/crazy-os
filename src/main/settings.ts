import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AppSettings, ClockConfig, DeepPartial, ModelPreset, SoulConfig } from '@shared/types'
import { DEFAULT_CLOCK } from '@shared/types'

// A tiny JSON-file settings store in userData. Dev mode already redirects userData to a
// "-dev" folder (see main/index.ts), so dev and installed builds never share this file.
//
// API keys never leave the main process in clear text: `maskedSettings()` is what goes
// over IPC, and `updateSettings` treats a masked key coming back as "keep the stored one".

const DEFAULTS: AppSettings = {
  launchAtLogin: false,
  runInBackground: false,
  models: [],
  activeModelId: '',
  clock: { ...DEFAULT_CLOCK }
}

function normalizeClock(c: Partial<ClockConfig> | undefined): ClockConfig {
  return { ...DEFAULT_CLOCK, ...(c ?? {}) }
}

let cache: AppSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function normalizePreset(p: Partial<ModelPreset>, i: number): ModelPreset {
  const proto = p.provider === 'openai' || p.provider === 'openai-responses' ? p.provider : 'anthropic'
  return {
    id: p.id || `m_${Date.now()}_${i}`,
    label: p.label ?? '',
    provider: proto,
    apiKey: p.apiKey ?? '',
    baseUrl: p.baseUrl ?? '',
    model: p.model ?? '',
    validated: !!p.validated
  }
}

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    const path = settingsFile()
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings> & { soul?: SoulConfig }
      const models = (parsed.models ?? []).map(normalizePreset)
      // Migrate the legacy single "soul" config into models[0] once.
      if (models.length === 0 && parsed.soul?.apiKey) {
        models.push(
          normalizePreset(
            {
              id: 'm_migrated',
              label: 'crazy模型',
              provider: parsed.soul.provider,
              apiKey: parsed.soul.apiKey,
              baseUrl: parsed.soul.baseUrl,
              model: parsed.soul.model,
              validated: false
            },
            0
          )
        )
      }
      const activeModelId =
        parsed.activeModelId && models.some((m) => m.id === parsed.activeModelId)
          ? parsed.activeModelId
          : (models[0]?.id ?? '')
      cache = {
        launchAtLogin: !!parsed.launchAtLogin,
        runInBackground: !!parsed.runInBackground,
        models,
        activeModelId,
        clock: normalizeClock(parsed.clock)
      }
    } else {
      cache = { ...DEFAULTS, models: [], clock: { ...DEFAULT_CLOCK } }
    }
  } catch (err) {
    console.error('[settings] read failed, using defaults:', err)
    cache = { ...DEFAULTS, models: [], clock: { ...DEFAULT_CLOCK } }
  }
  return cache
}

/** The preset that currently drives the OS, or null. */
export function activeModel(): ModelPreset | null {
  const s = getSettings()
  return s.models.find((m) => m.id === s.activeModelId) ?? null
}

// --- key masking (what the renderer sees) ---

const MASK_PREFIX = '••••' // "••••" — real keys can't start with this

export function maskKey(key: string): string {
  return key ? MASK_PREFIX + key.slice(-4) : ''
}

const isMasked = (key: string): boolean => key.startsWith(MASK_PREFIX)

/** Settings safe to hand to the renderer: every apiKey replaced by a mask. */
export function maskedSettings(): AppSettings {
  const s = getSettings()
  return { ...s, models: s.models.map((m) => ({ ...m, apiKey: maskKey(m.apiKey) })) }
}

export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const cur = getSettings()
  // Arrays replace wholesale; masked keys mean "keep what's stored for this preset id".
  let models = cur.models
  if (patch.models) {
    models = (patch.models as Partial<ModelPreset>[]).map((p, i) => {
      const norm = normalizePreset(p, i)
      if (isMasked(norm.apiKey)) {
        const prev = cur.models.find((m) => m.id === norm.id)
        norm.apiKey = prev?.apiKey ?? ''
      }
      return norm
    })
  }
  const next: AppSettings = {
    launchAtLogin: patch.launchAtLogin ?? cur.launchAtLogin,
    runInBackground: patch.runInBackground ?? cur.runInBackground,
    models,
    activeModelId: patch.activeModelId ?? cur.activeModelId,
    clock: patch.clock ? { ...cur.clock, ...(patch.clock as Partial<ClockConfig>) } : cur.clock
  }
  if (next.activeModelId && !next.models.some((m) => m.id === next.activeModelId)) {
    next.activeModelId = next.models[0]?.id ?? ''
  }
  cache = next
  try {
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[settings] write failed:', err)
  }
  return next
}

/** Resolve a preset "as stored" from one the renderer sent (whose key may be masked). */
export function unmaskPreset(p: ModelPreset): ModelPreset {
  if (!isMasked(p.apiKey)) return p
  const stored = getSettings().models.find((m) => m.id === p.id)
  return { ...p, apiKey: stored?.apiKey ?? '' }
}
