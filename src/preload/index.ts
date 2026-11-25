import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_EVENT_CHANNEL,
  AppEventSchema,
  type IpcChannel,
  type IpcRequest,
  type IpcResultMap,
  type WiskBotBridge
} from '../shared/ipc'

function send<C extends IpcChannel>(
  channel: C,
  ...args: [IpcRequest<C>] extends [void] ? [] : [payload: IpcRequest<C>]
): Promise<IpcResultMap[C]> {
  return ipcRenderer.invoke(channel, ...(args as unknown[])) as Promise<IpcResultMap[C]>
}

function onEvent(handler: (event: import('../shared/ipc').AppEvent) => void): () => void {
  const listener = (_event: unknown, raw: unknown) => {
    const parsed = AppEventSchema.safeParse(raw)
    if (parsed.success) handler(parsed.data)
  }
  ipcRenderer.on(APP_EVENT_CHANNEL, listener)
  return () => ipcRenderer.removeListener(APP_EVENT_CHANNEL, listener)
}

/** The ONLY API given to the renderer: no ipcRenderer or Node API is exposed. */
const bridge: WiskBotBridge = { send, onEvent }

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('wiskbot', bridge)
} else {
  // This must never happen: contextIsolation and sandbox are both enabled.
  console.error('WiskBot requires context isolation; the secure bridge was not installed.')
}
