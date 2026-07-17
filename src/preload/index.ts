import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, AgentToolCall, CrazyOSApi, ViewChunk, ViewRequest } from '@shared/types'

// The single, narrow bridge between the locked-down renderer and the main process.
// Nothing here exposes raw ipcRenderer or Node — only these typed calls.
const api: CrazyOSApi = {
  platform: process.platform,
  resolveAppOpen: (req) => ipcRenderer.invoke('app:resolve-open', req),
  generateView: (req: ViewRequest, streamId: string) => ipcRenderer.invoke('generate-view', req, streamId),
  cancelView: (streamId) => ipcRenderer.send('cancel-view', streamId),
  onViewChunk: (cb) => {
    const handler = (_e: unknown, chunk: ViewChunk): void => cb(chunk)
    ipcRenderer.on('view:chunk', handler)
    return () => ipcRenderer.removeListener('view:chunk', handler)
  },
  patchView: (req) => ipcRenderer.invoke('patch-view', req),
  isLive: () => ipcRenderer.invoke('is-live'),
  testModel: (preset) => ipcRenderer.invoke('model:test', preset),
  revealModelKey: (presetId) => ipcRenderer.invoke('model:reveal-key', presetId),

  agentSend: (sessionId, text, modelId, thinking) => ipcRenderer.invoke('agent:send', sessionId, text, modelId, thinking),
  agentSteer: (sessionId, text) => ipcRenderer.invoke('agent:steer', sessionId, text),
  agentCancel: (sessionId) => ipcRenderer.send('agent:cancel', sessionId),
  onAgentEvent: (cb) => {
    const handler = (_e: unknown, ev: AgentEvent): void => cb(ev)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
  onAgentTool: (cb) => {
    const handler = (_e: unknown, call: AgentToolCall): void => cb(call)
    ipcRenderer.on('agent:tool', handler)
    return () => ipcRenderer.removeListener('agent:tool', handler)
  },
  agentToolResult: (res) => ipcRenderer.send('agent:tool-result', res),
  agentSessions: () => ipcRenderer.invoke('agent:sessions'),
  agentLoadSession: (id) => ipcRenderer.invoke('agent:load-session', id),
  agentDeleteSession: (id) => ipcRenderer.invoke('agent:delete-session', id),

  fsRead: () => ipcRenderer.invoke('fs:read'),
  fsWrite: (tree) => ipcRenderer.invoke('fs:write', tree),
  appDataGet: (appId) => ipcRenderer.invoke('appdata:get', appId),
  appScaffoldEnsure: (appId, name, variantKey, step) => ipcRenderer.invoke('appscaffold:ensure', appId, name, variantKey, step),
  appDataSet: (appId, name, state) => ipcRenderer.invoke('appdata:set', appId, name, state),
  appViewSet: (snapshot) => ipcRenderer.invoke('appview:set', snapshot),
  appRuntimeOpen: (appId, name, variantKey, requestedAlias) =>
    ipcRenderer.invoke('appruntime:open', appId, name, variantKey, requestedAlias),
  appRuntimeGet: (appId, name, variantKey) => ipcRenderer.invoke('appruntime:get', appId, name, variantKey),
  appRuntimeSet: (snapshot) => ipcRenderer.invoke('appruntime:set', snapshot),
  appRuntimeReset: (appId, name, variantKey) => ipcRenderer.invoke('appruntime:reset', appId, name, variantKey),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  closeWindow: () => ipcRenderer.send('window:close'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: (cb) => {
    const handler = (_e: unknown, status: import('@shared/types').UpdateStatus): void => cb(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  }
}

contextBridge.exposeInMainWorld('crazyos', api)
