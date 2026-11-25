import type { WiskBotBridge } from '../shared/ipc'

declare global {
  interface Window {
    wiskbot: WiskBotBridge
  }
}

export {}
