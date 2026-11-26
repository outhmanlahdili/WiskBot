import { chromium, type BrowserContext, type Page } from 'playwright'
import {
  BrowserCommandSchema,
  BrowserStartSchema,
  SNAPSHOT_LIMIT_BYTES,
  type WorkerMessage
} from '../../shared/browser'
import { resolveBrowserUrl } from '../allowlist'

let context: BrowserContext | null = null
let page: Page | null = null
let allowedHosts: string[] = []
let testMode = false
let paused = false

function send(message: WorkerMessage): void {
  process.parentPort.postMessage(message)
}

function status(
  value: 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped',
  extra: { url?: string; message?: string } = {}
): void {
  send({ type: 'status', status: value, ...extra })
}

function currentPage(): Page {
  if (!page || page.isClosed()) throw new Error('The managed browser has no active tab.')
  return page
}

function checkTarget(url: string): string {
  const result = resolveBrowserUrl(url, allowedHosts, testMode)
  if (!result.ok) throw new Error(result.reason)
  return result.url
}

async function handleCommand(command: ReturnType<typeof parseCommand>): Promise<unknown> {
  const pageForAction = currentPage()

  switch (command.type) {
    case 'open': {
      const url = checkTarget(command.url)
      await pageForAction.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      const finalResult = resolveBrowserUrl(pageForAction.url(), allowedHosts, testMode)
      if (!finalResult.ok) {
        throw new Error(`Navigation ended on a blocked URL: ${finalResult.reason}`)
      }
      return { url: pageForAction.url(), title: await pageForAction.title() }
    }
    case 'snapshot': {
      let text: string
      try {
        text = await pageForAction.locator('body').ariaSnapshot({ timeout: 5000 })
      } catch {
        text = await pageForAction.locator('body').innerText({ timeout: 5000 })
      }
      const truncated = Buffer.byteLength(text, 'utf8') > SNAPSHOT_LIMIT_BYTES
      const bounded = truncated ? text.slice(0, SNAPSHOT_LIMIT_BYTES) : text
      return {
        untrustedPageContent: true,
        url: pageForAction.url(),
        text: bounded,
        truncated
      }
    }
    case 'click': {
      const selector = command.selector.slice(0, 500)
      const locator = pageForAction.locator(selector)
      const count = await locator.count()
      if (count !== 1) throw new Error(`Locator must match exactly one element; matched ${count}.`)
      await locator.click({ timeout: 8000 })
      return { clicked: true, selector, url: pageForAction.url() }
    }
    case 'fill': {
      const selector = command.selector.slice(0, 500)
      const locator = pageForAction.locator(selector)
      const count = await locator.count()
      if (count !== 1) throw new Error(`Locator must match exactly one element; matched ${count}.`)
      const sensitive = await isSensitiveField(locator)
      if (sensitive) {
        throw new Error(
          'This looks like a secret field. The assistant will not fill it; enter it yourself using Take over.'
        )
      }
      await locator.fill(command.value, { timeout: 8000 })
      return { filled: true, selector, url: pageForAction.url() }
    }
    case 'screenshot': {
      const buffer = await pageForAction.screenshot({ type: 'png', timeout: 10000 })
      return { pngBase64: buffer.toString('base64'), url: pageForAction.url() }
    }
    case 'setPaused':
      paused = command.paused
      status(paused ? 'paused' : 'ready')
      return { paused }
    case 'shutdown':
      await context?.close().catch(() => undefined)
      context = null
      page = null
      status('stopped')
      return { stopped: true }
    default:
      throw new Error('Unsupported browser command.')
  }
}

type ParsedCommand = ReturnType<typeof parseCommand>

function parseCommand(data: unknown) {
  return BrowserCommandSchema.parse(data)
}

/** Attribute-only check; no page JavaScript is ever supplied by the model. */
async function isSensitiveField(locator: ReturnType<Page['locator']>): Promise<boolean> {
  const type = (await locator.getAttribute('type')) ?? ''
  const autocomplete = (await locator.getAttribute('autocomplete')) ?? ''
  const name = (await locator.getAttribute('name')) ?? ''
  const id = (await locator.getAttribute('id')) ?? ''
  const ariaLabel = (await locator.getAttribute('aria-label')) ?? ''
  const placeholder = (await locator.getAttribute('placeholder')) ?? ''
  const combined = `${type} ${autocomplete} ${name} ${id} ${ariaLabel} ${placeholder}`.toLowerCase()
  if (type === 'password' || type === 'hidden') return true
  if (/(current-password|new-password|cc-|credit-card|cvv|one-time-code|otp)/.test(combined)) {
    return true
  }
  return /(password|passphrase|secret|token|api[-_ ]?key|cvv|card.?number|pin\b|otp\b)/.test(combined)
}

process.parentPort.on('message', async (message) => {
  const start = BrowserStartSchema.safeParse(message.data)
  if (start.success) {
    try {
      status('starting')
      allowedHosts = start.data.allowedHosts
      testMode = start.data.testMode
      context = await chromium.launchPersistentContext(start.data.userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 }
      })
      page = context.pages()[0] ?? (await context.newPage())
      status('ready', { url: page.url() })
    } catch (error) {
      status('error', { message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  const parsed = BrowserCommandSchema.safeParse(message.data)
  if (!parsed.success) {
    send({
      type: 'result',
      requestId: 'unknown',
      ok: false,
      error: 'Invalid browser command message.'
    })
    return
  }

  const command: ParsedCommand = parsed.data
  if (paused && command.type !== 'setPaused' && command.type !== 'shutdown') {
    send({
      type: 'result',
      requestId: command.requestId,
      ok: false,
      error: 'The managed browser is paused for human takeover.'
    })
    return
  }

  try {
    const data = await handleCommand(command)
    send({ type: 'result', requestId: command.requestId, ok: true, data })
  } catch (error) {
    send({
      type: 'result',
      requestId: command.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
