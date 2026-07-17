// Shared contracts between main, preload and renderer.
// Keep this file dependency-free — it is imported by all three build targets.

/** A STABLE per-app persistence key derived from the app's display name (not its window id),
 *  so the same app reopened via search OR the agent shares one saved-data folder. */
export function appKeyOf(name: string): string {
  const normalized = name.normalize('NFKC').toLowerCase()
  const slug = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  if (slug) return slug
  // Pure-symbol names (often emoji) still need distinct, deterministic folders.
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `app-${(hash >>> 0).toString(36)}`
}

/** Current canonical id fallback: the first saved/opened name becomes the base identity. */
export function canonicalAppIdForName(name: string): string {
  const key = appKeyOf(name)
  // app_soul is the OS's protected long-term memory directory, not a generated
  // application. Keep a user-created app named “Soul” in its own namespace.
  return key === 'soul' ? 'generated-soul' : key
}

/** A generated/openable application descriptor with stable persistence identity. */
export interface AppOption {
  /** Stable canonical id used for de-duping windows and reusing one persistence folder. */
  id: string
  /** Display name, e.g. "浏览器". */
  name: string
  /** A single emoji used as the hand-drawn icon. */
  icon: string
  /** One-line description shown under the name. */
  tagline: string
  /** UI/cache variant inside the same app identity (e.g. default / work / privacy). */
  variantKey?: string
  /** Optional durable opening-kit HTML shown immediately while the model checks/rebuilds the app. */
  seedHtml?: string
  /** Optional durable opening-kit title paired with seedHtml. */
  seedTitle?: string
}

/** One stable app instance slot on the desktop: canonical app id + variant. */
export function appInstanceKeyOf(app: Pick<AppOption, 'id' | 'variantKey'>): string {
  return `${app.id}::${app.variantKey ?? 'default'}`
}

export interface ResolveAppOpenRequest {
  name: string
  icon?: string
  tagline?: string
  instructions?: string
  /** Explicit mode/variant request from the crazy assistant when it wants to branch the same app. */
  mode?: string
  /** Set only after the user confirms a privacy-sensitive mode change inside CrazyOS. */
  confirmedSensitive?: boolean
}

/** One-shot decision made before a generated window opens.
 *
 * `reuse` means the requested app/variant already has a usable durable home and
 * must open directly without asking a model to review it. `convert-mode` keeps
 * the same canonical app identity but streams a new explicitly requested mode
 * from `sourceVariantKey` into `targetVariantKey`. */
export interface AppOpenPlan {
  disposition: 'reuse' | 'create' | 'convert-mode'
  requestedName: string
  targetVariantKey: string
  sourceVariantKey?: string
  /** True only when the caller supplied non-empty requirements beyond opening. */
  requirementsChanged: boolean
}

export interface CachedAppView {
  variantKey: string
  title: string
  html: string
  tags: string[]
  updatedAt: number
}

export interface ResolvedAppOpen {
  app: AppOption
  variantKey: string
  cachedView: CachedAppView | null
  openPlan: AppOpenPlan
  needsConfirmation?: {
    id: string
    message: string
  }
}

export interface AppViewSnapshot {
  appId: string
  name: string
  variantKey: string
  title?: string
  html: string
  /** Reject a durable commit if either source file changed since it was read. */
  baseLongTermUpdatedAt?: number
  baseTemporaryUpdatedAt?: number
}

/** The two source files that define one generated app variant.
 *
 * `<variant>.long-term.html` is the durable opening/home view. It changes only
 * when the app is first installed or explicitly upgraded. The running iframe is
 * backed by `<variant>.temporary.html`; that file changes with every live DOM
 * edit and is copied back from long-term when the window closes. */
export interface AppRuntimeFiles {
  appId: string
  name: string
  variantKey: string
  title: string
  longTermHtml: string
  temporaryHtml: string
  /** Revision of long-term.html specifically, for compare-and-swap commits. */
  longTermUpdatedAt: number
  /** Revision of temporary.html specifically, for compare-and-swap commits. */
  temporaryUpdatedAt: number
  updatedAt: number
}

/** A snapshot written by a running app into its temporary source file. */
export interface AppRuntimeSnapshot extends AppViewSnapshot {}

export interface AppRuntimeCommitResult {
  applied: boolean
  files: AppRuntimeFiles
}

export interface AppViewCommitResult extends AppRuntimeCommitResult {}

/** What kind of persistence this render should produce once it succeeds. */
export type ViewPersistenceIntent = 'runtime' | 'create-kit' | 'upgrade-kit'

/**
 * A request to (re)render a view. The model rewrites the whole view document
 * for the given app + interaction. `intent` describes what just happened.
 */
export interface ViewRequest {
  /** Which app this view belongs to. */
  app: AppOption
  /** What the user just did. "open" for first render; otherwise an intent from the UI. */
  intent: Intent
  /**
   * Prior turns for this app window (compacted), so the model keeps continuity
   * across regenerations without re-deriving state. Newest last.
   */
  history?: Turn[]
  /** Extra free-form requirements (e.g. from the system agent: "补上缺的功能 X"). */
  instructions?: string
  /** Should a successful full render become the durable opening kit, or just runtime state? */
  persistence?: ViewPersistenceIntent
  /**
   * Optional named region contract for a lightweight hook stream. The model
   * receives only this region's semantic context, never the whole app source.
   */
  slot?: ViewSlotRequest
}

export type HookKind = 'navigate' | 'content'
export type HookPlacement = 'replace' | 'append'

export interface ViewSlotRequest {
  /** CSS selector of the already-designed region to update. */
  target: string
  /** navigate may design a new interactive sub-page; content only fills the existing format. */
  kind: HookKind
  /** Replace the region or append one newly generated item/message. */
  placement: HookPlacement
  /** Human-readable contract such as "assistant reply card" or "browser page". */
  role?: string
  /** Optional selector of a local <template>; only its existence/selector is sent, never app source. */
  template?: string
  /** Compact text-only context from this region (never the full app HTML). */
  context?: string
}

/**
 * A structured action emitted by the rendered (imagined) UI back to the host.
 */
export interface Intent {
  /** "open" = first render. "ui" = a generic in-view action that should re-imagine the view. */
  kind: 'open' | 'ui'
  /** Free-form label of what happened, e.g. "navigate", "play", "back". */
  action: string
  /** Arbitrary payload from the clicked element's data-* attributes. */
  payload?: Record<string, string>
}

/** One conversational turn kept for an app window. */
export interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** A streamed chunk of a view document body. */
export interface ViewChunk {
  /** Correlates chunks to a single generation request. */
  streamId: string
  /** A piece of the HTML body the model is writing. */
  text: string
}

/** Sent when a view generation finishes. */
export interface ViewDone {
  streamId: string
  /** The full body HTML, for history/debugging. */
  html: string
  /** True when the stream was cancelled (window closed / superseded). */
  cancelled?: boolean
}

/** One planned generation unit, announced by the model via the <!--plan:…--> sentinel. */
export interface PlanUnit {
  id: string
  label: string
}

// --- Harness v2: hooks + scoped patches ---

/** A request from the running app's code back to the OS model. */
export interface Hook {
  action: string
  /** Defaults to the legacy whole-view stream when omitted. */
  kind?: HookKind
  /** Required for navigate/content hooks; must name an existing stable region. */
  target?: string
  /** content commonly appends; navigate commonly replaces. */
  placement?: HookPlacement
  /** Describes the fragment format that the initial app already designed. */
  role?: string
  /** Optional local <template> cloned by the host for fixed-format content items. */
  template?: string
  detail?: Record<string, unknown>
}

/** One targeted DOM change inside the running app. Selectors are CSS selectors. */
export type MutateOp =
  | { op: 'replaceInner'; selector: string; html: string }
  | { op: 'replaceOuter'; selector: string; html: string }
  | { op: 'append'; selector: string; html: string }
  | { op: 'remove'; selector: string }
  | { op: 'setText'; selector: string; text: string }
  | { op: 'setAttr'; selector: string; name: string; value: string }

/** The model's scoped response to a hook: change part, add an overlay, swap the page, or nothing. */
export type Patch =
  | { mode: 'mutate'; ops: MutateOp[] }
  | { mode: 'overlay'; html: string }
  | { mode: 'replace'; html: string }
  | { mode: 'none' }

export interface PatchRequest {
  app: AppOption
  /** Current body innerHTML of the running app (may be truncated for context). */
  currentHtml: string
  hook: Hook
  history?: Turn[]
}

// --- Soul models (the model presets that drive the OS) ---

/** Wire format of a model endpoint.
 *  - `openai` = /v1/chat/completions (OpenAI, vLLM, Ollama, most gateways)
 *  - `openai-responses` = /v1/responses (OpenAI Responses API; Codex / GPT-5 proxies)
 *  - `anthropic` = /v1/messages (Claude models + relays) */
export type ModelProtocol = 'openai' | 'openai-responses' | 'anthropic'

/** Suggested API base for a wire format — prefills the field and swaps when the user flips 接口格式. */
export function defaultBaseUrlFor(protocol: ModelProtocol): string {
  return protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}

/** Every known default base URL — a URL equal to one of these is "untouched" and safe to replace. */
export const KNOWN_DEFAULT_BASE_URLS: readonly string[] = [
  'https://api.openai.com/v1',
  'https://api.anthropic.com'
]

/** Best-effort guess of the wire format from an endpoint's shape, when `provider` is unset. */
export function detectProtocol(cfg: { baseUrl?: string; apiKey?: string; model?: string; provider?: ModelProtocol }): ModelProtocol {
  if (cfg.provider === 'anthropic' || cfg.provider === 'openai' || cfg.provider === 'openai-responses') {
    return cfg.provider
  }
  const url = (cfg.baseUrl ?? '').toLowerCase()
  const key = (cfg.apiKey ?? '').toLowerCase()
  const model = (cfg.model ?? '').toLowerCase()
  if (key.startsWith('sk-ant') || /anthropic|\/messages\b/.test(url) || /^claude/.test(model)) return 'anthropic'
  if (/\/responses\b/.test(url) || /codex/.test(model)) return 'openai-responses'
  return 'openai'
}

/** One saved model endpoint. The user keeps several and activates one. */
export interface ModelPreset {
  id: string
  /** Display name, independent of the model name (e.g. "本地网关 Claude"). */
  label: string
  /** Wire format. (Historically 'provider'; now one of three protocols.) */
  provider: ModelProtocol
  /**
   * Bearer/API key. Over IPC to the renderer this is MASKED ("••••" + last 4);
   * a masked value sent back in an update means "keep the stored key".
   */
  apiKey: string
  /** Optional custom endpoint (e.g. a gateway); blank = provider default. */
  baseUrl: string
  /** Model name; blank = a sensible default per provider. */
  model: string
  /** True after 测试连接 succeeds; editing any field clears it. */
  validated: boolean
}

/** Legacy single-model config (pre-presets); only used to migrate old settings.json. */
export interface SoulConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  baseUrl: string
  model: string
}

/** The desktop clock widget (reads the host time; the assistant can reconfigure it). */
export interface ClockConfig {
  visible: boolean
  showDate: boolean
  showSeconds: boolean
  /** 12-hour clock with AM/PM (true) vs 24-hour (false). */
  hour12: boolean
  /** Optional custom line shown under the time (e.g. a greeting the assistant set). */
  label: string
  /** IANA timezone (e.g. "America/New_York"); '' = follow the host system's timezone. */
  timeZone: string
}

export const DEFAULT_CLOCK: ClockConfig = {
  visible: true,
  showDate: true,
  showSeconds: false,
  hour12: false,
  label: '',
  timeZone: ''
}

export interface AppSettings {
  /** Start Crazy OS automatically on login (packaged builds only). */
  launchAtLogin: boolean
  /** Closing the window hides it to the tray instead of quitting. */
  runInBackground: boolean
  /** Saved model presets (the OS settings app edits these). */
  models: ModelPreset[]
  /** id of the preset that drives the OS; '' = none. */
  activeModelId: string
  /** Desktop clock widget config. */
  clock: ClockConfig
}

export interface ModelTestResult {
  ok: boolean
  message: string
}

// --- Virtual file system (the file-manager app + per-app persistence) ---

export type FsKind = 'folder' | 'file' | 'shortcut'

/** One entry in the virtual FS tree. Folders have children; files have text content. */
export interface FsNode {
  /** Stable id (also used as the drag key). */
  id: string
  kind: FsKind
  name: string
  /** File body (text only — txt / md / json). Undefined for folders. */
  content?: string
  /** Stable target node id for kind='shortcut'. The shortcut remains valid when
   * the target is renamed or moved; a missing target is rendered as broken. */
  targetId?: string
  /** Child ids in display order (folders only). Order is user-editable via drag. */
  children?: string[]
  /** ms epoch of last change (set by the main process). */
  updatedAt: number
  /** Free-drag position on the DESKTOP surface (only meaningful for children of files/Desktop).
   *  Undefined → auto-arranged into the grid. "整理" clears these back to undefined. */
  x?: number
  y?: number
  /** ms epoch when moved to the recycle bin (only set for items inside files/Trash). Auto-purged
   *  after 30 days; restoring or emptying clears/removes it. */
  deletedAt?: number
  /** The folder id this item was in before being trashed, for "还原". */
  deletedFrom?: string
}

/** A flat map id → node, plus the root id. The renderer walks it; main persists it. */
export interface FsTree {
  rootId: string
  nodes: Record<string, FsNode>
  /** Monotonic main-process revision used to reject stale whole-tree writes. */
  revision?: number
}

export interface FsWriteResult {
  applied: boolean
  tree: FsTree
}

/** Compact per-app memory the model reads before re-imagining an app it has seen before. */
export interface AppData {
  /** The app's stable key (slug of the canonical name). */
  appId: string
  name: string
  /** Known aliases that should reuse this app's folder. */
  aliases?: string[]
  /** The default / last-used UI variant. */
  defaultVariantKey?: string
  /** Saved UI/cache variants keyed inside this app's folder. */
  views?: CachedAppView[]
  /** Freeform JSON the app's own code persisted (messages, notes, items…). */
  state: unknown
  updatedAt: number
}

// --- System agent (the vibe-coding side panel) ---

/** A saved agent conversation the user can revisit. */
export interface AgentSessionMeta {
  id: string
  title: string
  updatedAt: number
}

/** One stored message in an agent session (for reload). */
export interface AgentStoredMsg {
  role: 'user' | 'assistant'
  text: string
}

/** Streamed events from a running agent turn, main → renderer. */
export type AgentEvent =
  | { sessionId: string; type: 'text'; text: string }
  | { sessionId: string; type: 'thinking'; text: string }
  | { sessionId: string; type: 'tool-start'; callId: string; tool: string; label: string }
  | { sessionId: string; type: 'tool-end'; callId: string; ok: boolean; summary: string }
  | { sessionId: string; type: 'done' }
  | { sessionId: string; type: 'error'; message: string }

/** A tool the agent wants executed in the renderer (where the DOM/store live). */
export interface AgentToolCall {
  callId: string
  tool: string
  args: Record<string, unknown>
}

export interface AgentToolResult {
  callId: string
  ok: boolean
  /** Human/model-readable result text (JSON for structured data). */
  result: string
}

/** The API surface exposed to the renderer via contextBridge as `window.crazyos`. */
export interface CrazyOSApi {
  /** The host platform ('darwin' | 'win32' | 'linux'), for platform-specific chrome. */
  platform: string
  /** Resolve a user-facing app name to a canonical app + cached UI variant. */
  resolveAppOpen(req: ResolveAppOpenRequest): Promise<ResolvedAppOpen>
  /**
   * Start streaming a view document. `streamId` tags every chunk so the renderer can
   * ignore chunks from a superseded generation. Resolves with the final body HTML.
   */
  generateView(req: ViewRequest, streamId: string): Promise<ViewDone>
  /** Abort a running view generation (window closed or superseded). */
  cancelView(streamId: string): void
  /** Subscribe to streamed body chunks. Returns an unsubscribe fn. */
  onViewChunk(cb: (chunk: ViewChunk) => void): () => void
  /** A hook fired inside the running app; the model returns a scoped patch. */
  patchView(req: PatchRequest): Promise<Patch>
  /** Whether a real model is configured (true) or we're in mock mode (false). */
  isLive(): Promise<boolean>
  /** Fire a minimal request against a preset to prove the endpoint works. */
  testModel(preset: ModelPreset): Promise<ModelTestResult>
  /** Return the FULL (unmasked) API key for a preset — only when the user asks to reveal it. */
  revealModelKey(presetId: string): Promise<string>

  // --- system agent ---
  /** Send a user message to the agent; resolves when the whole turn (incl. tools) is done. */
  agentSend(sessionId: string, text: string, modelId: string, thinking: boolean): Promise<void>
  /** Append a new user thought to the currently running turn without cancelling it. */
  agentSteer(sessionId: string, text: string): Promise<boolean>
  /** Abort the current agent turn for a session. */
  agentCancel(sessionId: string): void
  /** Subscribe to streamed agent events. Returns an unsubscribe fn. */
  onAgentEvent(cb: (ev: AgentEvent) => void): () => void
  /** Subscribe to tool-execution requests (main asks the renderer to act). */
  onAgentTool(cb: (call: AgentToolCall) => void): () => void
  /** Send a tool-execution result back to main. */
  agentToolResult(res: AgentToolResult): void
  /** List saved agent sessions (newest first). */
  agentSessions(): Promise<AgentSessionMeta[]>
  /** Load one session's stored messages. */
  agentLoadSession(id: string): Promise<AgentStoredMsg[]>
  /** Delete a saved session. */
  agentDeleteSession(id: string): Promise<void>

  // --- virtual file system + per-app memory ---
  /** Read the whole virtual FS tree. */
  fsRead(): Promise<FsTree>
  /** Persist the whole tree (after a rename / move / create / delete / edit). */
  fsWrite(tree: FsTree): Promise<FsWriteResult>
  /** Read one app's saved memory, or null if it has never been used. */
  appDataGet(appId: string): Promise<AppData | null>
  /** Ensure the app's folder + baseline data file exist as soon as it is actually opened. */
  appScaffoldEnsure(
    appId: string,
    name: string,
    variantKey?: string,
    step?: 'data' | 'long-term' | 'temporary' | 'all'
  ): Promise<AppRuntimeFiles | null>
  /** Persist one app's memory (called by the app's own code via a hook). */
  appDataSet(appId: string, name: string, state: unknown): Promise<void>
  /** Save a durable opening-kit snapshot for this app/variant. */
  appViewSet(snapshot: AppViewSnapshot): Promise<AppViewCommitResult>
  /** Start a fresh window session by copying long-term HTML to temporary HTML. */
  appRuntimeOpen(appId: string, name: string, variantKey?: string, requestedAlias?: string): Promise<AppRuntimeFiles>
  /** Read the files that currently back one app variant. */
  appRuntimeGet(appId: string, name: string, variantKey?: string): Promise<AppRuntimeFiles>
  /** Persist the live iframe DOM into the app's temporary HTML file. */
  appRuntimeSet(snapshot: AppRuntimeSnapshot): Promise<AppRuntimeCommitResult>
  /** Close/revert a window session by copying long-term HTML over temporary HTML. */
  appRuntimeReset(appId: string, name: string, variantKey?: string): Promise<AppRuntimeFiles>
  // --- OS shell ---
  /** Open an explicitly requested HTTP(S) URL in the user's system browser. */
  openExternal(url: string): Promise<boolean>
  /** App name / version / author for the Version panel. */
  appInfo(): Promise<AppInfo>
  /** Read persisted settings (model keys arrive masked). */
  getSettings(): Promise<AppSettings>
  /** Patch + persist settings; returns the merged (masked) result. */
  updateSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings>
  /** Minimize the main window. */
  minimizeWindow(): void
  /** Toggle fullscreen on the main window. */
  toggleFullscreen(): void
  /** Close the main window (hides to tray if "run in background" is on). */
  closeWindow(): void
  /** Trigger an update check; resolves with the current status. */
  checkUpdate(): Promise<UpdateStatus>
  /** Subscribe to check/download/install progress pushed by the main process. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
}

export interface AppInfo {
  name: string
  version: string
  author: string
}

export interface UpdateStatus {
  phase: 'idle' | 'checking' | 'none' | 'downloading' | 'installing' | 'error' | 'dev'
  percent?: number
  version?: string
  message?: string
}

/** Recursive Partial — lets the renderer patch nested settings. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
