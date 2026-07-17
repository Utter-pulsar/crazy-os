import type { CrazyOSApi } from '@shared/types'

declare global {
  interface Window {
    crazyos: CrazyOSApi
  }
}

export {}
