# Handoff 02 — Safe agent loop

Owner: Session 1 · Prepared: 2026-11-25 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 1 is **complete and accepted** (commit `9adc183`, plus Phase 1b fixes). The app launches cleanly on Windows, the preload is CJS/self-contained under `sandbox: true`, keys are encrypted, migrations apply, and tests/build pass.

Now implement **Phase 2 only**. Read first:

- `docs/ARCHITECTURE.md` (process model, IPC contract, permission model, context management)
- `docs/TOOL-CATALOG.md` (tools, risk levels, approval rules)
- `docs/DECISIONS.md` (ADRs 009, 034–039)
- `docs/ROADMAP.md` Phase 2
- Current `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`

Do not modify `docs/`. Do not start Phase 3. Do not push to GitHub yet.

Also clean up the two leftover smoke-harness artifacts from Phase 1b (`preview/`, `vite.preview.config.ts`) — delete them or add them to `.gitignore`. No secrets were found in them.

## Your task

### 1. Agent loop in the main process

- Use AI SDK `ToolLoopAgent` with the model resolved from the selected provider (reuse `src/main/providers/registry.ts`).
- Consume the agent's stream parts directly and map each part to an IPC event. Do **not** use `useChat`, `createAgentUIStreamResponse`, or any local HTTP server — the renderer has no HTTP surface.
- Stream every step to the renderer through the existing `chat.event` IPC channel.
- Events to emit (extend the shared event union in `src/shared/ipc.ts` with Zod schemas):
  `text-delta`, `tool-call`, `tool-result`, `tool-error`, `approval-request`, `approval-response`, `usage`, `done`, `error`.
- Persist user messages, assistant text, tool calls, tool results and approval decisions into SQLite (`messages`, `tool_calls`, `approvals`).
- Renderer renders these event parts in the chat view, including a visible "waiting for approval" state.

### 2. Approval flow (the critical part)

Verified from <https://ai-sdk.dev/docs/agents/tool-approvals>. Manual approval is a **two-call flow**:

1. Configure `toolApproval` in one place — a per-tool map or a generic policy function that calls `PermissionEngine` and can return `'user-approval'`, `'denied'` (with reason), `'approved'`, or `undefined` (= `'not-applicable'`). Use the deprecated `needsApproval` property nowhere.
2. The first `agent.stream()` call ends with `tool-approval-request` parts. Do **not** execute the tool in that call. Only respond to parts where `isAutomatic` is false.
3. Renderer shows an approval **card** with tool name, resolved target, scope and concrete values (not just a description), plus a preview/diff. Cards raised by a chat message wait indefinitely; cards raised by background work may expire — show the expiry in the UI.
4. User chooses **Allow once**, **Allow for this session**, or **Deny**. `allow-always` only for low-risk tools inside an allowlisted scope. Session grants live in a per-conversation in-memory map in main with a clear expiry. Deny must not retry until the user sends a new message.
5. Keep conversation state as `ModelMessage[]` in main. After the first call, append `result.responseMessages`, then push a `{ role: 'tool', content: [ToolApprovalResponse] }` message with the matching `approvalId`, then call the agent again. Only then does `execute` run.
6. **Preserve `inputSchemaInput`** on approval requests when persisting messages — the SDK uses it to revalidate that the approved input was not changed.
7. Generate a random secret at startup (at least 32 bytes, in memory only, never persisted or sent to the renderer) and pass it as `experimental_toolApprovalSecret` so approvals are HMAC-signed and cannot be forged by a crafted IPC message.
8. On denial, return a clear denial result and include a system instruction telling the model **not to retry the denied call**.

Every decision is written to `audit_events` with redacted arguments. `PermissionEngine` re-checks the *resolved* target inside `execute` (absolute path, final URL), not just the raw model input. Automatic approvals/denials are recorded but must not appear as manual dialogs.

### 3. Tools allowed in Phase 2 (no others)

- `wiskbot.time.now.v1` — read, no approval.
- `wiskbot.fs.list.v1` — read, only inside allowlisted roots; size/entry caps.
- `wiskbot.fs.read.v1` — ask on first path outside WiskBot's own memory/skill folders; reads inside those own folders never prompt (plain read operations only — any pipe, redirect, second command or path outside still asks); size cap; binary detection; redact detected secrets.

Fully qualified names. Zod `inputSchema`. `execute` only in main. No write tools, no browser, no desktop, no shell, no payments. Secrets are never placed in tool input, model context, chat, audit details or logs — the app injects them around the model.

### 4. Loop control and context

- `stopWhen: isStepCount(12)` plus a configurable token/cost budget; enforce the budget by watching `usage` events and aborting the run when exceeded.
- `activeTools` filtered by the conversation's granted scopes.
- `prepareStep` + `pruneMessages` for compaction when token estimates cross a threshold.
- One `AbortController` per run; **replace the current `chat.cancel` and `chat.respondApproval` stubs** with real handlers. The signal must reach the model call and every tool `execute`.
- `toolCallConcurrency: 1` for deterministic tool ordering.
- On a fresh install where the Electron binary is missing, document/run `node node_modules/electron/install.js` before the smoke test.

### 5. Fix the two accepted follow-ups

- **Provider metadata drift:** expose provider definitions from main through IPC (new `providers.definitions` channel or extend `providers.list`) and make the renderer consume them. Remove the duplicated static list in `SettingsView.tsx`.
- **`keys.enc` recovery:** add a "Reset encrypted key store" action in Settings with explicit confirmation. It must not silently overwrite the file; on failure show a clear error and leave the file untouched.

### 6. Testing (must be deterministic)

- Add a **fake provider** (in-process, deterministic scripted responses) so no real API key or network is needed.
- Tests must cover: approval request → approve → tool executes; approval request → deny → no retry; **forged/tampered approval response is rejected**; `inputSchemaInput` survives persistence; cancellation; step budget; path allowlist canonicalisation (`..`, absolute escape, look-alike domains); redaction; audit records.
- Integration test with a temporary SQLite database — never the real `%APPDATA%\WiskBot` profile.
- Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

### 7. GUI smoke test

Run the built app on Windows and capture evidence:

- Send a chat message with the fake provider.
- Approve a safe `fs.list` tool inside an allowlisted test folder; see the result in chat.
- Deny a second tool; confirm no retry and an audit entry.
- Cancel a running stream.
- Open the Audit view and see the decisions.
- Confirm no API key or full tool output appears in console/logs.

Capture a short console excerpt or screenshot. If a check cannot be completed, say so explicitly.

## Security rules (non-negotiable)

- Keys stay in main; renderer sees only `hasKey` / masked hints.
- No raw `ipcRenderer` or Node API through `contextBridge`.
- Validate `event.senderFrame` on every IPC handler.
- Tool `execute` re-validates resolved targets; all decisions audited.
- No arbitrary shell, browser, desktop control, or network fetch tools in this phase.
- Do not push to GitHub yet — report first.

## Report format

```
## Phase 2 report
- New IPC channels/events added
- Agent loop configuration (model, stopWhen, activeTools, compaction)
- Approval flow evidence (approve / deny / no retry)
- Tools implemented and their guards
- Tests added + npm test / typecheck / build results
- GUI smoke test evidence
- Files changed
- Deviations from docs/ with reasons
- Remaining risks and questions
```
