import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { ChatEvent, Settings } from '../../shared/ipc'
import {
  DesktopStartSchema,
  DesktopWorkerMessageSchema,
  type DesktopCommand
} from '../../shared/desktop'
import { logger } from '../logger'

export type DesktopStatus = 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped'

export interface DesktopTransport {
  postMessage(message: unknown): void
  onMessage(handler: (data: unknown) => void): void
  onExit(handler: (code: number) => void): void
  kill(): void
}

export interface DesktopNode {
  level: number
  name: string
  automationId: string
  controlType: string
  isSecret: boolean
  rect: { x: number; y: number; width: number; height: number }
  patterns: string[]
}

export interface DesktopControl {
  readonly available: boolean
  readonly status: DesktopStatus
  waitUntilReady(timeoutMs?: number): Promise<void>
  listWindows(): Promise<{ windows: Array<{ title: string; className: string }> }>
  tree(title: string): Promise<{ nodes: DesktopNode[]; truncated: boolean; untrustedDesktopData: boolean }>
  activate(title: string): Promise<{ activated: boolean }>
  invoke(title: string, selector: string): Promise<{ invoked: boolean; name: string }>
  clickPoint(title: string, x: number, y: number): Promise<{ clicked: boolean; x: number; y: number }>
  type(title: string, selector: string, value: string): Promise<{ filled: boolean }>
  readText(title: string, selector: string): Promise<{ untrustedDesktopData: boolean; text: string; truncated: boolean }>
  screenshot(title: string, screenshotDir: string): Promise<{ path: string; bytes: number }>
  setPaused(paused: boolean): Promise<{ paused: boolean }>
  stop(): Promise<{ stopped: boolean }>
  getStatus(): { status: DesktopStatus; title?: string; message?: string }
}

type CommandInput = {
  [K in DesktopCommand['type']]: Omit<Extract<DesktopCommand, { type: K }>, 'requestId'>
}[DesktopCommand['type']]

interface ManagerOptions {
  emit: (event: ChatEvent) => void
  settings: () => Settings
  transportFactory?: () => DesktopTransport
  scriptPath?: string
  screenshotDir?: string
}

function utilityTransport(child: UtilityProcess): DesktopTransport {
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (handler) => child.on('message', handler),
    onExit: (handler) => child.on('exit', handler),
    kill: () => child.kill()
  }
}

function resolveScriptPath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'scripts', 'uia.ps1'),
    join(app.getAppPath(), 'resources', 'scripts', 'uia.ps1'),
    join(`${app.getAppPath()}.unpacked`, 'resources', 'scripts', 'uia.ps1'),
    join(__dirname, '../../resources/scripts/uia.ps1')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export class DesktopManager implements DesktopControl {
  private transport: DesktopTransport | null = null
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private currentStatus: DesktopStatus = 'stopped'
  private currentTitle: string | undefined
  private statusMessage: string | undefined

  constructor(private readonly options: ManagerOptions) {}

  get available(): boolean {
    return (
      process.platform === 'win32' &&
      this.transport !== null &&
      (this.currentStatus === 'ready' || this.currentStatus === 'busy' || this.currentStatus === 'paused')
    )
  }

  get status(): DesktopStatus {
    return this.currentStatus
  }

  getStatus(): { status: DesktopStatus; title?: string; message?: string } {
    return { status: this.currentStatus, title: this.currentTitle, message: this.statusMessage }
  }

  start(): void {
    const { emit, settings } = this.options
    if (this.transport) return
    if (process.platform !== 'win32') {
      this.setStatus('error', undefined, 'Desktop control is available on Windows only.')
      emit({ event: 'error', message: 'Desktop control is available on Windows only.' })
      return
    }
    const scriptPath = this.options.scriptPath ?? resolveScriptPath()
    if (!scriptPath || !existsSync(scriptPath)) {
      this.setStatus('error', undefined, 'The UIA adapter script was not found.')
      emit({ event: 'error', message: 'The UIA adapter script was not found.' })
      return
    }

    try {
      const startMessage = DesktopStartSchema.parse({
        type: 'start',
        scriptPath,
        allowedTitles: settings().desktopWindowTitles,
        testMode: process.env['WISKBOT_TEST_MODE'] === '1'
      })
      this.transport = this.options.transportFactory
        ? this.options.transportFactory()
        : utilityTransport(
            utilityProcess.fork(join(__dirname, 'desktop-worker', 'index.js'), [], {
              stdio: 'inherit'
            })
          )
      this.transport.onMessage((data) => this.onWorkerMessage(data))
      this.transport.onExit((code) => this.onWorkerExit(code))
      this.transport.postMessage(startMessage)
      this.setStatus('starting')
    } catch (error) {
      this.setStatus('error', undefined, error instanceof Error ? error.message : String(error))
      emit({ event: 'error', message: 'The desktop worker could not start.' })
      logger.error('desktop', error)
    }
  }

  private onWorkerMessage(data: unknown): void {
    const parsed = DesktopWorkerMessageSchema.safeParse(data)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type === 'result') {
      const entry = this.pending.get(message.requestId)
      if (!entry) return
      this.pending.delete(message.requestId)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.data)
      else entry.reject(new Error(message.error ?? 'Desktop command failed.'))
      return
    }
    this.setStatus(message.status, message.title, message.message)
    if (message.status === 'error') {
      this.options.emit({
        event: 'desktop-status',
        status: 'error',
        title: message.title,
        message: message.message
      })
    }
  }

  private onWorkerExit(code: number): void {
    this.transport = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`The desktop worker exited (code ${code}).`))
    }
    this.pending.clear()
    this.setStatus(
      'error',
      undefined,
      `The desktop worker exited unexpectedly (code ${code}). Use Restart desktop control to try again.`
    )
    this.options.emit({
      event: 'error',
      message: 'Desktop control stopped. Desktop tools are unavailable until you restart it.'
    })
  }

  private setStatus(status: DesktopStatus, title?: string, message?: string): void {
    this.currentStatus = status
    this.currentTitle = title ?? this.currentTitle
    this.statusMessage = message
    this.options.emit({ event: 'desktop-status', status, title: this.currentTitle, message })
  }

  private async command<T>(command: CommandInput): Promise<T> {
    const started = Date.now()
    while (this.currentStatus === 'starting' && Date.now() - started < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.available) {
      throw new Error('Desktop control is not available. Check the window allowlist and restart it from Settings.')
    }
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('The desktop worker did not respond in time.'))
      }, 30000)
      this.pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer })
      this.transport!.postMessage({ ...command, requestId })
    })
  }

  async waitUntilReady(timeoutMs = 30000): Promise<void> {
    const started = Date.now()
    while (this.currentStatus === 'starting' && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.available) {
      throw new Error('Desktop control is not available. Check the window allowlist and restart it from Settings.')
    }
  }

  listWindows() {
    return this.command<{ windows: Array<{ title: string; className: string }> }>({ type: 'listWindows' })
  }

  tree(title: string) {
    return this.command<{ nodes: DesktopNode[]; truncated: boolean; untrustedDesktopData: boolean }>({
      type: 'tree',
      title
    })
  }

  activate(title: string) {
    return this.command<{ activated: boolean }>({ type: 'activate', title })
  }

  invoke(title: string, selector: string) {
    return this.command<{ invoked: boolean; name: string }>({ type: 'invoke', title, selector })
  }

  clickPoint(title: string, x: number, y: number) {
    return this.command<{ clicked: boolean; x: number; y: number }>({ type: 'clickPoint', title, x, y })
  }

  type(title: string, selector: string, value: string) {
    return this.command<{ filled: boolean }>({ type: 'type', title, selector, value })
  }

  readText(title: string, selector: string) {
    return this.command<{ untrustedDesktopData: boolean; text: string; truncated: boolean }>({
      type: 'readText',
      title,
      selector
    })
  }

  async screenshot(title: string, screenshotDir: string): Promise<{ path: string; bytes: number }> {
    mkdirSync(screenshotDir, { recursive: true })
    const path = join(screenshotDir, `window-${randomUUID()}.png`)
    return this.command<{ path: string; bytes: number }>({ type: 'screenshot', title, path })
  }

  async setPaused(paused: boolean): Promise<{ paused: boolean }> {
    const result = await this.command<{ paused: boolean }>({ type: 'setPaused', paused })
    this.options.emit({
      event: 'desktop-takeover',
      active: paused,
      message: paused ? 'Take over the visible Windows desktop now.' : 'Control returned to WiskBot.'
    })
    return result
  }

  async stop(): Promise<{ stopped: boolean }> {
    await this.setPaused(true)
    return { stopped: true }
  }

  async restart(): Promise<{ restarted: boolean }> {
    this.transport?.kill()
    this.transport = null
    this.setStatus('stopped')
    this.start()
    return { restarted: true }
  }
}
