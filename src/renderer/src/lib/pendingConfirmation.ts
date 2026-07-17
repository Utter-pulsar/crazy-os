export const PENDING_CONFIRMATION_EVENT = 'crazyos:pending-confirmation'

export interface PendingConfirmationDetail {
  id: string
  source: 'assistant' | 'reopen'
  appName: string
  variantKey: string
  message: string
  payload: {
    name: string
    icon?: string
    tagline?: string
    instructions?: string
    mode?: string
  }
}

export function emitPendingConfirmation(detail: PendingConfirmationDetail): void {
  window.dispatchEvent(new CustomEvent<PendingConfirmationDetail>(PENDING_CONFIRMATION_EVENT, { detail }))
}
