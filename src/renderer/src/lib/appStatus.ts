export const APP_STATUS_EVENT = 'crazyos:app-status'

export interface AppStatusTodo {
  id: string
  label: string
  done: boolean
}

export interface AppStatusDetail {
  instanceId: number
  appName: string
  title: string
  label: string
  todos: AppStatusTodo[]
  /** Optional one-line narrator text shown above the checklist, e.g. installing / preparing. */
  narrator?: string
  remove?: boolean
}

export function emitAppStatus(detail: AppStatusDetail): void {
  window.dispatchEvent(new CustomEvent<AppStatusDetail>(APP_STATUS_EVENT, { detail }))
}

export function clearAppStatus(instanceId: number): void {
  emitAppStatus({ instanceId, appName: '', title: '', label: '', todos: [], remove: true })
}
