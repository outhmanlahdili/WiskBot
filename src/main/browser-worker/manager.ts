import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { ChatEvent, Settings } from '../../shared/ipc'
import {
  BrowserStartSchema,
  WorkerMessageSchema,
  type BrowserCommand
} from '../../shared/browser'
import { logger } from '../logger'
import { getUserDataDir } from '../paths'

export type BrowserStatus = 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped'

export interface BrowserTransport {
  postMessage(message: unknown): void
  onMessage(handler: (data: unknown) => void): void
  onExit(handler: (code: number) => void): void
  kill(): void
}

export interface BrowserControl {
  readonly available: boolean
  readonly status: BrowserStatus
  waitUntilReady(timeoutMs?: number): Promise<void>
  open(url: string): Promise<{ url: string; title?: string }>
  snapshot(): Promise<{ untrustedPageContent: boolean; url: string; text: string; truncated: boolean }>
  click(selector: string): Promise<{ clicked: boolean; selector: string; url: string }>
  fill(selector: string, value: string): Promise<{ filled: boolean; selector: string; url: string }>
  screenshot(): Promise<{ path: string; bytes: number; url: string }>
  setPaused(paused: boolean): Promise<{ paused: boolean }>
  stop(): Promise<{ stopped: boolean }>
  getStatus(): { status: BrowserStatus; url?: string; message?: string }
}

type CommandInput = {
  [K in BrowserCommand['type']]: Omit<Extract<BrowserCommand, { type: K }>, 'requestId'>
}[BrowserCommand['type']]

interface ManagerOptions {
  emit: (event: ChatEvent) => void
  settings: () => Settings
  transportFactory?: () => BrowserTransport
  screenshotDir?: string
  userDataDir?: string
  testMode?: boolean
}

function utilityTransport(child: UtilityProcess): BrowserTransport {
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (handler) => child.on('message', handler),
    onExit: (handler) => child.on('exit', handler),
    kill: () => child.kill()
  }
}

export class BrowserManager implements BrowserControl {
  private transport: BrowserTransport | null = null
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private currentStatus: BrowserStatus = 'stopped'
  private currentUrl: string | undefined
  private statusMessage: string | undefined

  constructor(private readonly options: ManagerOptions) {}

  get available(): boolean {
    return this.transport !== null && (this.currentStatus === 'ready' || this.currentStatus === 'busy' || this.currentStatus === 'paused')
  }

  get status(): BrowserStatus {
    return this.currentStatus
  }

  getStatus(): { status: BrowserStatus; url?: string; message?: string } {
    return { status: this.currentStatus, url: this.currentUrl, message: this.statusMessage }
  }

  start(): void {
    const { emit, settings } = this.options
    if (this.transport) return

    const userDataDir = join(this.options.userDataDir ?? getUserDataDir(), 'browser-profile')
    mkdirSync(userDataDir, { recursive: true })
    const startMessage = BrowserStartSchema.parse({
      type: 'start',
      userDataDir,
      allowedHosts: settings().browserDomains,
      testMode: this.options.testMode ?? process.env['WISKBOT_TEST_MODE'] === '1'
    })

    try {
      this.transport = this.options.transportFactory
        ? this.options.transportFactory()
        : utilityTransport(
            utilityProcess.fork(join(__dirname, 'browser-worker', 'index.js'), [], {
              stdio: 'inherit'
            })
          )
      this.transport.onMessage((data) => this.onWorkerMessage(data))
      this.transport.onExit((code) => this.onWorkerExit(code))
      this.transport.postMessage(startMessage)
      this.setStatus('starting')
    } catch (error) {
      this.setStatus('error', undefined, error instanceof Error ? error.message : String(error))
      emit({ event: 'error', message: 'The managed browser could not start.' })
      logger.error('browser', error)
    }
  }

  private onWorkerMessage(data: unknown): void {
    const parsed = WorkerMessageSchema.safeParse(data)
    if (!parsed.success) return

    const message = parsed.data
    if (message.type === 'result') {
      const entry = this.pending.get(message.requestId)
      if (!entry) return
      this.pending.delete(message.requestId)
      clearTimeout(entry.timer)
      if (message.ok) {
        const data = message.data
        if (data && typeof data === 'object' && typeof (data as { url?: unknown }).url === 'string') {
          this.currentUrl = (data as { url: string }).url
        }
        entry.resolve(message.data)
      } else {
        entry.reject(new Error(message.error ?? 'Browser command failed.'))
      }
      return
    }

    this.setStatus(message.status, message.url, message.message)
    if (message.status === 'error') {
      this.options.emit({
        event: 'browser-status',
        status: 'error',
        url: message.url,
        message: message.message
      })
    }
  }

  private onWorkerExit(code: number): void {
    this.transport = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`The managed browser exited (code ${code}).`))
    }
    this.pending.clear()
    this.setStatus('error', undefined, `The managed browser exited unexpectedly (code ${code}). Use Restart browser to try again.`)
    this.options.emit({
      event: 'error',
      message: 'The managed browser stopped. Browser tools are unavailable until you restart it.'
    })
  }

  private setStatus(status: BrowserStatus, url?: string, message?: string): void {
    this.currentStatus = status
    this.currentUrl = url ?? this.currentUrl
    this.statusMessage = message
    this.options.emit({
      event: 'browser-status',
      status,
      url: this.currentUrl,
      message
    })
  }

  private async command<T>(command: CommandInput): Promise<T> {
    const started = Date.now()
    while (this.currentStatus === 'starting' && Date.now() - started < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.transport || !this.available) {
      throw new Error('The managed browser is not available. Restart it from Settings.')
    }
    const requestId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('The managed browser did not respond in time.'))
      }, 30000)
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      this.transport!.postMessage({ ...command, requestId })
    })
  }

  async waitUntilReady(timeoutMs = 30000): Promise<void> {
    const started = Date.now()
    while (this.currentStatus === 'starting' && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.available) {
      throw new Error('The managed browser is not available. Restart it from Settings.')
    }
  }

  async open(url: string): Promise<{ url: string; title?: string }> {
    this.setStatus('busy')
    try {
      return await this.command<{ url: string; title?: string }>({ type: 'open', url })
    } finally {
      if (this.currentStatus === 'busy') this.setStatus('ready')
    }
  }

  async snapshot() {
    return this.command<{ untrustedPageContent: boolean; url: string; text: string; truncated: boolean }>({
      type: 'snapshot'
    })
  }

  async click(selector: string) {
    this.setStatus('busy')
    try {
      return await this.command<{ clicked: boolean; selector: string; url: string }>({ type: 'click', selector })
    } finally {
      if (this.currentStatus === 'busy') this.setStatus('ready')
    }
  }

  async fill(selector: string, value: string) {
    this.setStatus('busy')
    try {
      return await this.command<{ filled: boolean; selector: string; url: string }>({
        type: 'fill',
        selector,
        value
      })
    } finally {
      if (this.currentStatus === 'busy') this.setStatus('ready')
    }
  }

  async screenshot(): Promise<{ path: string; bytes: number; url: string }> {
    const shot = await this.command<{ pngBase64: string; url: string }>({ type: 'screenshot' })
    const buffer = Buffer.from(shot.pngBase64, 'base64')
    const dir = this.options.screenshotDir ?? join(getUserDataDir(), 'screenshots')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `tab-${randomUUID()}.png`)
    writeFileSync(path, buffer, { mode: 0o600 })
    return { path, bytes: buffer.length, url: shot.url }
  }

  async setPaused(paused: boolean): Promise<{ paused: boolean }> {
    const result = await this.command<{ paused: boolean }>({ type: 'setPaused', paused })
    this.options.emit({
      event: 'browser-takeover',
      active: paused,
      message: paused ? 'Take over the visible managed browser window now.' : 'Control returned to WiskBot.'
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
