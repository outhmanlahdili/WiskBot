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
export function createFakeProvider(getRoot: () => string | undefined) {
  return customProvider({
    languageModels: { 'fake-scripted': createFakeModel({ getRoot, delayMs: 80 }) }
  })
}
