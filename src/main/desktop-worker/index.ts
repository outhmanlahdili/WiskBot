import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  DesktopCommandSchema,
  DesktopStartSchema,
  DESKTOP_TREE_MAX_DEPTH,
  DESKTOP_TREE_MAX_NODES,
  type DesktopWorkerMessage
} from '../../shared/desktop'

let scriptPath = ''
let allowedTitles: string[] = []
let paused = false
let adapter: ChildProcessWithoutNullStreams | null = null
let buffer = ''
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

function send(message: DesktopWorkerMessage): void {
  process.parentPort.postMessage(message)
}

function status(
  value: 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped',
  extra: { title?: string; message?: string } = {}
): void {
  send({ type: 'status', status: value, ...extra })
}

function stopAdapter(): void {
  if (adapter && !adapter.killed) adapter.kill()
  adapter = null
}

function startAdapter(): void {
  if (adapter) return
  // Fixed arguments only. Model input is passed as JSON on stdin, never as an argument.
  adapter = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  adapter.stdout.setEncoding('utf8')
  adapter.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const parsed = JSON.parse(line) as { requestId?: string; ok?: boolean; data?: unknown; error?: string }
          const entry = parsed.requestId ? pending.get(parsed.requestId) : undefined
          if (entry) {
            pending.delete(parsed.requestId!)
            clearTimeout(entry.timer)
            if (parsed.ok) entry.resolve(parsed.data)
            else entry.reject(new Error(parsed.error ?? 'UIA adapter command failed.'))
          }
        } catch {
          // Ignore non-JSON lines from the adapter.
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  adapter.stderr.setEncoding('utf8')
  adapter.stderr.on('data', () => undefined)
  adapter.on('exit', (code) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`UIA adapter exited (code ${code}).`))
    }
    pending.clear()
    adapter = null
  })
}

function callAdapter(payload: Record<string, unknown>, requestId: string): Promise<unknown> {
  if (!adapter) throw new Error('The UIA adapter is not running.')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('The UIA adapter did not respond in time.'))
    }, 30000)
    pending.set(requestId, { resolve, reject, timer })
    adapter!.stdin.write(JSON.stringify({ ...payload, requestId, maxDepth: DESKTOP_TREE_MAX_DEPTH, maxNodes: DESKTOP_TREE_MAX_NODES }) + '\n')
  })
}

function checkTitle(title: string): string {
  if (!allowedTitles.some((entry) => entry === title)) {
    throw new Error(`Window "${title}" is not in the desktop window allowlist.`)
  }
  return title
}

async function handleCommand(command: ReturnType<typeof parseCommand>): Promise<unknown> {
  if (command.type === 'setPaused') {
    paused = command.paused
    status(paused ? 'paused' : 'ready')
    return { paused }
  }
  if (command.type === 'shutdown') {
    stopAdapter()
    status('stopped')
    return { stopped: true }
  }
  if (paused) throw new Error('The desktop worker is paused for human takeover.')

  switch (command.type) {
    case 'listWindows':
      return callAdapter({ type: 'listWindows' }, command.requestId)
    case 'tree':
      return callAdapter({ type: 'tree', title: checkTitle(command.title) }, command.requestId)
    case 'activate':
      status('busy', { title: command.title })
      try {
        return await callAdapter({ type: 'activate', title: checkTitle(command.title) }, command.requestId)
      } finally {
        status(paused ? 'paused' : 'ready', { title: command.title })
      }
    case 'invoke':
      status('busy', { title: command.title })
      try {
        return await callAdapter(
          { type: 'invoke', title: checkTitle(command.title), selector: command.selector },
          command.requestId
        )
      } finally {
        status(paused ? 'paused' : 'ready', { title: command.title })
      }
    case 'clickPoint':
      status('busy', { title: command.title })
      try {
        return await callAdapter(
          { type: 'clickPoint', title: checkTitle(command.title), x: command.x, y: command.y },
          command.requestId
        )
      } finally {
        status(paused ? 'paused' : 'ready', { title: command.title })
      }
    case 'type':
      status('busy', { title: command.title })
      try {
        return await callAdapter(
          {
            type: 'type',
            title: checkTitle(command.title),
            selector: command.selector,
            value: command.value
          },
          command.requestId
        )
      } finally {
        status(paused ? 'paused' : 'ready', { title: command.title })
      }
    case 'readText':
      return callAdapter(
        { type: 'readText', title: checkTitle(command.title), selector: command.selector },
        command.requestId
      )
    case 'screenshot':
      return callAdapter(
        { type: 'screenshot', title: checkTitle(command.title), path: command.path },
        command.requestId
      )
    default:
      throw new Error('Unsupported desktop command.')
  }
}

function parseCommand(data: unknown) {
  return DesktopCommandSchema.parse(data)
}

process.parentPort.on('message', async (message) => {
  const start = DesktopStartSchema.safeParse(message.data)
  if (start.success) {
    try {
      status('starting')
      scriptPath = start.data.scriptPath
      allowedTitles = start.data.allowedTitles
      startAdapter()
      status('ready')
    } catch (error) {
      status('error', { message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  const parsed = DesktopCommandSchema.safeParse(message.data)
  if (!parsed.success) {
    send({ type: 'result', requestId: 'unknown', ok: false, error: 'Invalid desktop command message.' })
    return
  }
  const command = parsed.data
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
