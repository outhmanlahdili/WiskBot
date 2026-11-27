import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { customProvider, type LanguageModel } from 'ai'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider'

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 }
}

function lastUserText(options: LanguageModelV4CallOptions): string {
  for (let index = options.prompt.length - 1; index >= 0; index--) {
    const message = options.prompt[index]
    if (message.role !== 'user') continue
    return message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
  }
  return ''
}

export interface FakeModelOptions {
  /** Called at request time so the smoke test can use the configured folder. */
  getRoot: () => string | undefined
  /** URL used by browser-tool scripts (fixture in tests/smoke). */
  getBrowserUrl?: () => string | undefined
  /** Allowlisted window title used by desktop-tool scripts. */
  getDesktopTitle?: () => string | undefined
  /** Fully qualified MCP tool name used by mcp scripts. */
  getMcpTool?: () => string | undefined
  /** Optional delay used by cancellation tests and smoke checks. */
  delayMs?: number
  /** Deterministic script override for unit tests. */
  script?: (callNumber: number, text: string, root: string | undefined) => LanguageModelV4StreamPart[]
}

export function createFakeModel(options: FakeModelOptions): LanguageModel {
  let callNumber = 0
  const suffix = randomUUID().slice(0, 8)

  const defaultScript = (call: number, text: string, root: string | undefined): LanguageModelV4StreamPart[] => {
    const lower = text.toLowerCase()
    const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }]

    if (lower.includes('slow task')) {
      parts.push({ type: 'text-start', id: 'txt_slow' })
      for (let index = 0; index < 30; index++) {
        parts.push({
          type: 'text-delta',
          id: 'txt_slow',
          delta: `Step ${index} of a slow task. `
        })
      }
      parts.push({ type: 'text-end', id: 'txt_slow' })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
      return parts
    }

    if (lower.includes('offline')) {
      parts.push({
        type: 'error',
        error: new Error('Provider unreachable: offline')
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'error', raw: 'error' } })
      return parts
    }

    if (lower.includes('mcp call')) {
      if (call > 1) {
        parts.push({ type: 'text-start', id: 'txt_mcp_2' })
        parts.push({ type: 'text-delta', id: 'txt_mcp_2', delta: 'MCP task completed.' })
        parts.push({ type: 'text-end', id: 'txt_mcp_2' })
        parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
        return parts
      }
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_mcp_${suffix}_${call}`,
        toolName: options.getMcpTool?.() ?? 'mcp.test.read_note',
        input: JSON.stringify({ query: 'hello' })
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    if (
      lower.includes('desktop tree') ||
      lower.includes('desktop click') ||
      lower.includes('desktop type') ||
      lower.includes('desktop screenshot')
    ) {
      const title = options.getDesktopTitle?.() ?? 'Untitled - Notepad'
      if (call > 1) {
        parts.push({ type: 'text-start', id: 'txt_desktop_2' })
        parts.push({ type: 'text-delta', id: 'txt_desktop_2', delta: 'Desktop task completed.' })
        parts.push({ type: 'text-end', id: 'txt_desktop_2' })
        parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
        return parts
      }
      let toolName = 'wiskbot.desktop.tree.v1'
      let input: Record<string, unknown> = { title }
      if (lower.includes('desktop click')) {
        toolName = 'wiskbot.desktop.click.v1'
        input = { title, selector: 'name=OK', point: null }
      } else if (lower.includes('desktop type')) {
        toolName = 'wiskbot.desktop.type.v1'
        input = { title, selector: 'name=Text editor', value: 'hello from wiskbot' }
      } else if (lower.includes('desktop screenshot')) {
        toolName = 'wiskbot.desktop.screenshot.v1'
      }
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_desktop_${suffix}_${call}`,
        toolName,
        input: JSON.stringify(input)
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    if (
      lower.includes('memory save') ||
      lower.includes('memory recall') ||
      lower.includes('skill invoke')
    ) {
      if (call > 1) {
        parts.push({ type: 'text-start', id: 'txt_memory_2' })
        parts.push({
          type: 'text-delta',
          id: 'txt_memory_2',
          delta: 'Done with that local task.'
        })
        parts.push({ type: 'text-end', id: 'txt_memory_2' })
        parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
        return parts
      }
      let toolName = 'wiskbot.memory.save.v1'
      let input: Record<string, unknown> = {
        kind: 'preference',
        content: 'The user prefers Morocco as their home region.'
      }
      if (lower.includes('memory recall')) {
        toolName = 'wiskbot.memory.recall.v1'
        input = { query: 'Morocco' }
      } else if (lower.includes('skill invoke')) {
        toolName = 'wiskbot.skill.invoke.v1'
        input = { skillId: 'folder-summary' }
      }
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_memory_${suffix}_${call}`,
        toolName,
        input: JSON.stringify(input)
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    if (
      lower.includes('browser open') ||
      lower.includes('browser snapshot') ||
      lower.includes('browser click') ||
      lower.includes('browser fill') ||
      lower.includes('browser secret') ||
      lower.includes('browser deny') ||
      lower.includes('browser screenshot')
    ) {
      if (call > 1) {
        parts.push({ type: 'text-start', id: 'txt_browser_2' })
        parts.push({
          type: 'text-delta',
          id: 'txt_browser_2',
          delta: 'The managed browser task completed.'
        })
        parts.push({ type: 'text-end', id: 'txt_browser_2' })
        parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
        return parts
      }
      const browserUrl = options.getBrowserUrl?.() ?? 'https://example.com'
      let toolName = 'wiskbot.browser.open.v1'
      let input: Record<string, unknown> = { url: browserUrl }
      if (lower.includes('browser snapshot')) {
        toolName = 'wiskbot.browser.snapshot.v1'
        input = {}
      } else if (lower.includes('browser click') || lower.includes('browser deny')) {
        toolName = 'wiskbot.browser.click.v1'
        input = { selector: '#action' }
      } else if (lower.includes('browser secret')) {
        toolName = 'wiskbot.browser.type.v1'
        input = { selector: '#secret', value: 'hunter2' }
      } else if (lower.includes('browser fill')) {
        toolName = 'wiskbot.browser.type.v1'
        input = { selector: '#name', value: 'Ada' }
      } else if (lower.includes('browser screenshot')) {
        toolName = 'wiskbot.browser.screenshot.v1'
        input = {}
      }
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_browser_${suffix}_${call}`,
        toolName,
        input: JSON.stringify(input)
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    if (lower.includes('steps')) {
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_step_${suffix}_${call}`,
        toolName: 'wiskbot.time.now.v1',
        input: '{}'
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    if (lower.includes('list') || lower.includes('read') || lower.includes('deny')) {
      if (call > 1) {
        const textValue = lower.includes('deny')
          ? 'Understood. I will not retry the denied call.'
          : 'The requested read-only operation completed.'
        parts.push({ type: 'text-start', id: 'txt_2' })
        parts.push({ type: 'text-delta', id: 'txt_2', delta: textValue })
        parts.push({ type: 'text-end', id: 'txt_2' })
        parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
        return parts
      }
      const folder = root ?? ''
      const needsRead = lower.includes('read') || lower.includes('deny')
      parts.push({
        type: 'tool-call',
        toolCallId: `fake_call_${suffix}_${call}`,
        toolName: needsRead ? 'wiskbot.fs.read.v1' : 'wiskbot.fs.list.v1',
        input: JSON.stringify({ path: needsRead ? join(folder, 'fake-note.txt') : folder })
      })
      parts.push({ type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } })
      return parts
    }

    const textValue = lower.includes('cancel')
      ? 'This is a long streamed reply used to test cancellation. '
      : 'Hello from the deterministic fake provider.'
    parts.push({ type: 'text-start', id: 'txt_1' })
    parts.push({ type: 'text-delta', id: 'txt_1', delta: textValue })
    parts.push({ type: 'text-end', id: 'txt_1' })
    parts.push({ type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } })
    return parts
  }

  const model = {
    specificationVersion: 'v4' as const,
    provider: 'fake',
    modelId: 'fake-scripted',
    supportedUrls: {},
    async doGenerate() {
      throw new Error('The fake provider only implements streaming.')
    },
    async doStream(callOptions: LanguageModelV4CallOptions) {
      callNumber += 1
      const text = lastUserText(callOptions)
      const script = options.script ?? defaultScript
      const parts = script(callNumber, text, options.getRoot())

      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          for (const part of parts) {
            if (options.delayMs) {
              await new Promise((resolve) => setTimeout(resolve, options.delayMs))
            }
            if (callOptions.abortSignal?.aborted) break
            controller.enqueue(part)
          }
          controller.close()
        }
      })
      return { stream }
    }
  }

  return model as unknown as LanguageModel
}

/** Provider used by the app when the user selects the clearly-labelled fake kind. */
export function createFakeProvider(
  getRoot: () => string | undefined,
  getBrowserUrl?: () => string | undefined,
  getDesktopTitle?: () => string | undefined,
  getMcpTool?: () => string | undefined
) {
  return customProvider({
    languageModels: {
      'fake-scripted': createFakeModel({
        getRoot,
        getBrowserUrl,
        getDesktopTitle,
        getMcpTool,
        delayMs: 80
      })
    }
  })
}
