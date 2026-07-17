import { randomBytes, randomUUID } from 'node:crypto'
import type { ModelProtocol } from '@shared/types'

// ---------------------------------------------------------------------------
// Unified model transport for the three wire formats crazy_os speaks:
//   * openai            → /chat/completions
//   * openai-responses  → /responses   (Codex / GPT-5 proxies)
//   * anthropic         → /messages    (Claude + relays)
// One fetch-based layer (no SDK) so we control headers — notably the Claude
// Code client disguise that makes strict relays accept an Anthropic request.
// Exposes three shapes: complete() (one-shot text), streamText() (SSE text),
// runTools() (a tool-use loop where each call is executed by the caller).
// Ported/adapted from DoodlePilot's vision-client (images stripped, tools added).
// ---------------------------------------------------------------------------

export interface ProviderCfg {
  protocol: ModelProtocol
  apiKey: string
  baseUrl: string
  model: string
}

export interface Msg {
  role: 'user' | 'assistant'
  content: string
}

/** A provider-neutral tool definition. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema (object)
}

/** One tool the model asked for, normalized across providers. */
export interface ToolInvocation {
  id: string
  name: string
  args: Record<string, unknown>
}

/** The real outcome returned by the renderer-side tool executor. */
export interface ToolExecutionResult {
  ok: boolean
  result: string
}

export type ExecTool = (name: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>

export interface RunToolsOpts {
  system: string
  history: Msg[]
  tools: ToolSpec[]
  onText: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolStart: (inv: ToolInvocation) => void
  onToolEnd: (id: string, ok: boolean, resultText: string) => void
  exec: ExecTool
  signal: AbortSignal
  maxRounds?: number
  maxTokens?: number
  /** Let the model reason (slower). Off by default — app generation always keeps it off for speed. */
  thinking?: boolean
}

// --- thinking control: OFF makes generation faster; each family gates it via a different field,
// so pick by the model id (the one cross-vendor signal). Unknown fields are ignored by servers.
function reasoningModel(m: string): boolean {
  return /^o[134](-|$|\b)/.test(m) || /gpt-?5/.test(m)
}
function openaiThinking(model: string, on: boolean): Record<string, unknown> {
  const m = model.toLowerCase()
  if (!on) {
    if (reasoningModel(m)) return { reasoning_effort: /gpt-?5/.test(m) ? 'minimal' : 'low' }
    if (/glm|doubao|hunyuan|minimax|ernie|wenxin/.test(m)) return { thinking: { type: 'disabled' } }
    if (/deepseek/.test(m)) return {}
    return { chat_template_kwargs: { enable_thinking: false } }
  }
  if (reasoningModel(m)) return {}
  if (/glm|doubao|hunyuan|minimax|ernie|wenxin/.test(m)) return { thinking: { type: 'enabled' } }
  if (/deepseek/.test(m)) return {}
  return { chat_template_kwargs: { enable_thinking: true } }
}

// --- URL normalizers (tolerate trailing slash, pasted full path, missing /v1) ---

function base(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}
function withV1(b: string): string {
  return /\/v\d+$/.test(b) ? b : b + '/v1'
}
export function chatUrl(baseUrl: string): string {
  return withV1(base(baseUrl).replace(/\/chat\/completions$/, '')) + '/chat/completions'
}
export function messagesUrl(baseUrl: string): string {
  return withV1(base(baseUrl).replace(/\/v\d+\/messages$/, '').replace(/\/messages$/, '')) + '/messages'
}
export function responsesUrl(baseUrl: string): string {
  return withV1(base(baseUrl).replace(/\/v\d+\/responses$/, '').replace(/\/responses$/, '')) + '/responses'
}

// --- Anthropic Claude-Code-client disguise (some relays only accept CLI traffic) ---

const CLIENT_DEVICE_ID = randomBytes(32).toString('hex')
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const CLAUDE_CODE_VERSION = '2.1.198'
const CLAUDE_CODE_BETAS = 'claude-code-20250219,interleaved-thinking-2025-05-14'

function anthropicHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_CODE_BETAS,
    'anthropic-dangerous-direct-browser-access': 'true',
    'User-Agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    'x-app': 'cli'
  }
  if (apiKey) {
    h['x-api-key'] = apiKey
    h.Authorization = `Bearer ${apiKey}`
  }
  return h
}
function anthropicMetadata(): Record<string, unknown> {
  return { user_id: JSON.stringify({ device_id: CLIENT_DEVICE_ID, account_uuid: '', session_id: randomUUID() }) }
}
function bearerHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * fetch() that retries transient upstream states — 429 / 502 / 503 (e.g. a relay's momentary
 * "No available accounts", or all accounts briefly rate-limited) and network blips — with a short
 * backoff, before giving up. Aborts (user cancel) are never retried. Returns the final Response
 * (the caller maps a non-ok status to a friendly error).
 */
async function resilientFetch(url: string, init: RequestInit, retries = 2): Promise<Response> {
  const TRANSIENT = new Set([429, 502, 503])
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (e) {
      if (init.signal?.aborted || attempt >= retries) throw e
      await sleep(700 * (attempt + 1))
      continue
    }
    if (res.ok || attempt >= retries || !TRANSIENT.has(res.status)) return res
    try {
      await res.body?.cancel()
    } catch {
      /* free the transient body before retrying */
    }
    await sleep(700 * (attempt + 1))
  }
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) return 'API Key 无效或缺失（或该网关分组不允许此客户端）'
  if (res.status === 404) return '接口或模型不存在，请检查 API 地址与模型名'
  return `请求失败（${res.status}）：${body.slice(0, 200)}`
}

// --- SSE line pump: yields complete `data:` payload strings from a Response body ---

async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim()
        if (d && d !== '[DONE]') yield d
      }
    }
  }
  const tail = buf.trim()
  if (tail.startsWith('data:')) {
    const d = tail.slice(5).trim()
    if (d && d !== '[DONE]') yield d
  }
}

// ===========================================================================
// complete() — one-shot text (search options / patch / connection test)
// ===========================================================================

export async function complete(
  cfg: ProviderCfg,
  system: string,
  prompt: string,
  maxTokens = 1024,
  signal?: AbortSignal
): Promise<string> {
  if (cfg.protocol === 'anthropic') {
    const res = await resilientFetch(messagesUrl(cfg.baseUrl), {
      method: 'POST',
      headers: anthropicHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        metadata: anthropicMetadata(),
        system: [{ type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `${system}\n\n${prompt}` }]
      }),
      signal
    })
    if (!res.ok) throw new Error(await readError(res))
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    return (j.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  }
  if (cfg.protocol === 'openai-responses') {
    // Responses proxies commonly require streaming; aggregate the stream to one string.
    let out = ''
    await streamText(cfg, system, prompt, [], (d) => (out += d), signal, maxTokens)
    return out
  }
  const res = await resilientFetch(chatUrl(cfg.baseUrl), {
    method: 'POST',
    headers: bearerHeaders(cfg.apiKey),
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      ...openaiThinking(cfg.model, false)
    }),
    signal
  })
  if (!res.ok) throw new Error(await readError(res))
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

// ===========================================================================
// streamText() — SSE token streaming (view generation)
// ===========================================================================

export async function streamText(
  cfg: ProviderCfg,
  system: string,
  prompt: string,
  history: Msg[],
  onChunk: (t: string) => void,
  signal?: AbortSignal,
  maxTokens = 8192
): Promise<string> {
  let full = ''
  const push = (t: string): void => {
    if (t) {
      full += t
      onChunk(t)
    }
  }

  if (cfg.protocol === 'anthropic') {
    const res = await resilientFetch(messagesUrl(cfg.baseUrl), {
      method: 'POST',
      headers: anthropicHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        stream: true,
        metadata: anthropicMetadata(),
        system: [
          { type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: system }
        ],
        messages: [...history, { role: 'user', content: prompt }]
      }),
      signal
    })
    if (!res.ok) throw new Error(await readError(res))
    for await (const data of sseLines(res)) {
      try {
        const ev = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') push(ev.delta.text ?? '')
      } catch {
        /* partial line */
      }
    }
    return full
  }

  if (cfg.protocol === 'openai-responses') {
    const res = await resilientFetch(responsesUrl(cfg.baseUrl), {
      method: 'POST',
      headers: bearerHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        store: false,
        stream: true,
        max_output_tokens: maxTokens,
        reasoning: { effort: 'minimal' },
        input: [
          ...history.map((m) => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] })),
          { role: 'user', content: [{ type: 'input_text', text: `${system}\n\n${prompt}` }] }
        ]
      }),
      signal
    })
    if (!res.ok) throw new Error(await readError(res))
    for await (const data of sseLines(res)) {
      try {
        const ev = JSON.parse(data) as { type?: string; delta?: string; text?: string }
        if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') push(ev.delta)
        else if (ev.type === 'response.output_text.done' && !full && typeof ev.text === 'string') push(ev.text)
      } catch {
        /* partial line */
      }
    }
    return full
  }

  const res = await resilientFetch(chatUrl(cfg.baseUrl), {
    method: 'POST',
    headers: bearerHeaders(cfg.apiKey),
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: true,
      ...openaiThinking(cfg.model, false)
    }),
    signal
  })
  if (!res.ok) throw new Error(await readError(res))
  for await (const data of sseLines(res)) {
    try {
      const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
      push(j.choices?.[0]?.delta?.content ?? '')
    } catch {
      /* partial line */
    }
  }
  return full
}

// ===========================================================================
// runTools() — a streaming tool-use loop, dispatched by protocol
// ===========================================================================

export async function runTools(cfg: ProviderCfg, o: RunToolsOpts): Promise<string> {
  if (cfg.protocol === 'anthropic') return runToolsAnthropic(cfg, o)
  if (cfg.protocol === 'openai-responses') return runToolsResponses(cfg, o)
  return runToolsOpenAI(cfg, o)
}

/** Execute once and normalize failures without aborting the model's tool loop. */
async function executeTool(o: RunToolsOpts, inv: ToolInvocation): Promise<ToolExecutionResult> {
  o.onToolStart(inv)
  let outcome: ToolExecutionResult
  try {
    outcome = await o.exec(inv.name, inv.args)
  } catch (err) {
    // Cancellation still ends the whole turn; an ordinary renderer/tool error is
    // returned to the model so it can inspect, retry, or choose another action.
    if (o.signal.aborted) throw err
    const message = err instanceof Error ? err.message : String(err)
    outcome = { ok: false, result: `工具执行异常：${message || '未知错误'}` }
  }
  if (!outcome.result) outcome = { ...outcome, result: outcome.ok ? '工具已完成，但没有返回详情。' : '工具失败，但没有返回原因。' }
  o.onToolEnd(inv.id, outcome.ok, outcome.result)
  return outcome
}

async function runToolsOpenAI(cfg: ProviderCfg, o: RunToolsOpts): Promise<string> {
  const tools = o.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: o.system },
    ...o.history.map((m) => ({ role: m.role, content: m.content }))
  ]
  let collected = ''
  let toolsOn = true

  for (let round = 0; round < (o.maxRounds ?? 8); round++) {
    interface Acc {
      id: string
      name: string
      args: string
    }
    const calls = new Map<number, Acc>()
    let text = ''
    let res: Response
    try {
      res = await resilientFetch(chatUrl(cfg.baseUrl), {
        method: 'POST',
        headers: bearerHeaders(cfg.apiKey),
        body: JSON.stringify({
          model: cfg.model,
          messages,
          max_tokens: o.maxTokens ?? 2048,
          stream: true,
          ...(toolsOn ? { tools } : {}),
          ...openaiThinking(cfg.model, o.thinking ?? false)
        }),
        signal: o.signal
      })
      if (!res.ok) throw new Error(await readError(res))
    } catch (err) {
      if (toolsOn && !o.signal.aborted && round === 0) {
        toolsOn = false
        const note = '（当前网关不支持工具调用，我只能给建议、无法直接操作系统）\n'
        collected += note
        o.onText(note)
        continue
      }
      throw err
    }
    for await (const data of sseLines(res)) {
      try {
        const j = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
            }
          }>
        }
        const delta = j.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          text += delta.content
          collected += delta.content
          o.onText(delta.content)
        }
        for (const tc of delta.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.name += tc.function.name
          if (tc.function?.arguments) cur.args += tc.function.arguments
          calls.set(tc.index, cur)
        }
      } catch {
        /* partial */
      }
    }
    const invs = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], i) => ({ ...c, id: c.id || `call_${i}` })).filter((c) => c.name)
    if (invs.length === 0) break
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: invs.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
    })
    for (const c of invs) {
      if (o.signal.aborted) throw new Error('aborted')
      const args = safeJson(c.args)
      const outcome = await executeTool(o, { id: c.id, name: c.name, args })
      messages.push({ role: 'tool', tool_call_id: c.id, content: outcome.result })
    }
  }
  return collected
}

async function runToolsAnthropic(cfg: ProviderCfg, o: RunToolsOpts): Promise<string> {
  const tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = o.history.map((m) => ({ role: m.role, content: m.content }))
  let collected = ''

  for (let round = 0; round < (o.maxRounds ?? 8); round++) {
    const budget = 1024
    const res = await resilientFetch(messagesUrl(cfg.baseUrl), {
      method: 'POST',
      headers: anthropicHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        // thinking (when on) needs headroom above its budget_tokens
        max_tokens: o.thinking ? (o.maxTokens ?? 2048) + budget : (o.maxTokens ?? 2048),
        stream: true,
        metadata: anthropicMetadata(),
        system: [
          { type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: o.system }
        ],
        messages,
        tools,
        ...(o.thinking ? { thinking: { type: 'enabled', budget_tokens: budget } } : {})
      }),
      signal: o.signal
    })
    if (!res.ok) throw new Error(await readError(res))

    // Rebuild the assistant's content blocks as they stream (text + tool_use w/ full input).
    const blocks: Array<Record<string, unknown>> = []
    const partial = new Map<number, string>() // block index → accumulating input json
    for await (const data of sseLines(res)) {
      try {
        const ev = JSON.parse(data) as {
          type?: string
          index?: number
          content_block?: { type?: string; id?: string; name?: string }
          delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
        }
        if (ev.type === 'content_block_start' && ev.content_block) {
          if (ev.content_block.type === 'tool_use') {
            blocks[ev.index!] = { type: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, input: {} }
            partial.set(ev.index!, '')
          } else if (ev.content_block.type === 'text') {
            blocks[ev.index!] = { type: 'text', text: '' }
          }
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            const b = blocks[ev.index!] as { text: string }
            b.text += ev.delta.text
            collected += ev.delta.text
            o.onText(ev.delta.text)
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            o.onThinking?.(ev.delta.thinking)
          } else if (ev.delta.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
            partial.set(ev.index!, (partial.get(ev.index!) ?? '') + ev.delta.partial_json)
          }
        } else if (ev.type === 'content_block_stop') {
          const raw = partial.get(ev.index!)
          if (raw !== undefined && blocks[ev.index!]) (blocks[ev.index!] as { input: unknown }).input = safeJson(raw)
        }
      } catch {
        /* partial */
      }
    }

    const toolUses = blocks.filter((b) => b && b.type === 'tool_use') as Array<{ id: string; name: string; input: Record<string, unknown> }>
    messages.push({ role: 'assistant', content: blocks.filter(Boolean) })
    if (toolUses.length === 0) break

    const results: Array<Record<string, unknown>> = []
    for (const tu of toolUses) {
      if (o.signal.aborted) throw new Error('aborted')
      const outcome = await executeTool(o, { id: tu.id, name: tu.name, args: tu.input })
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: outcome.result, is_error: !outcome.ok })
    }
    messages.push({ role: 'user', content: results })
  }
  return collected
}

async function runToolsResponses(cfg: ProviderCfg, o: RunToolsOpts): Promise<string> {
  const tools = o.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }))
  // Responses keeps conversation as a growing `input` list (store:false).
  const input: Array<Record<string, unknown>> = [
    { role: 'user', content: [{ type: 'input_text', text: o.system }] },
    ...o.history.map((m) => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] }))
  ]
  let collected = ''

  for (let round = 0; round < (o.maxRounds ?? 8); round++) {
    const res = await resilientFetch(responsesUrl(cfg.baseUrl), {
      method: 'POST',
      headers: bearerHeaders(cfg.apiKey),
      body: JSON.stringify({ model: cfg.model, store: false, stream: true, input, tools, reasoning: { effort: o.thinking ? 'medium' : 'minimal' } }),
      signal: o.signal
    })
    if (!res.ok) throw new Error(await readError(res))

    const calls = new Map<string, { call_id: string; name: string; args: string }>() // item_id → call
    let sawCall = false
    for await (const data of sseLines(res)) {
      try {
        const ev = JSON.parse(data) as {
          type?: string
          delta?: string
          item_id?: string
          item?: { id?: string; type?: string; call_id?: string; name?: string }
        }
        const ty = ev.type ?? ''
        if (ty === 'response.output_text.delta' && typeof ev.delta === 'string') {
          collected += ev.delta
          o.onText(ev.delta)
        } else if (ty === 'response.reasoning_summary_text.delta' && typeof ev.delta === 'string') {
          o.onThinking?.(ev.delta)
        } else if (ty === 'response.output_item.added' && ev.item?.type === 'function_call') {
          sawCall = true
          calls.set(ev.item.id ?? ev.item.call_id ?? '', { call_id: ev.item.call_id ?? ev.item.id ?? '', name: ev.item.name ?? '', args: '' })
        } else if (ty === 'response.function_call_arguments.delta' && ev.item_id && typeof ev.delta === 'string') {
          const c = calls.get(ev.item_id)
          if (c) c.args += ev.delta
        }
      } catch {
        /* partial */
      }
    }
    if (!sawCall || calls.size === 0) break

    for (const c of calls.values()) {
      if (o.signal.aborted) throw new Error('aborted')
      const args = safeJson(c.args)
      const outcome = await executeTool(o, { id: c.call_id, name: c.name, args })
      input.push({ type: 'function_call', call_id: c.call_id, name: c.name, arguments: c.args })
      input.push({ type: 'function_call_output', call_id: c.call_id, output: outcome.result })
    }
  }
  return collected
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}')
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
