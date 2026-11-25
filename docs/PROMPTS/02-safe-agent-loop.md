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

## Your task

### 1. Agent loop in the main process

- Use AI SDK `ToolLoopAgent` with the model resolved from the selected provider (reuse `src/main/providers/registry.ts`).
- Stream every step to the renderer through the existing `chat.event` IPC channel — **no local HTTP server**, no `useChat`.
- Events to emit (extend the shared event union in `src/shared/ipc.ts` with Zod schemas):
  `text-delta`, `tool-call`, `tool-result`, `tool-error`, `approval-request`, `approval-response`, `usage`, `done`, `error`.
- Persist user messages, assistant text, tool calls, tool results and approval decisions into SQLite (`messages`, `tool_calls`, `approvals`).
- Renderer renders these event parts in the chat view, including a visible "waiting for approval" state.

### 2. Approval flow (the critical part)

Per AI SDK docs, manual approval is a **two-call flow**:

1. Configure `toolApproval` in one place (e.g. `{ readFile: 'user-approval' }` or a policy function).
2. The first `agent.stream()` call ends with `tool-approval-request` parts. Do **not** execute the tool in that call.
3. Renderer shows a dialog: tool name, target, and a preview/diff.
4. User chooses **Allow once**, **Allow for this session**, or **Deny**. `allow-always` only for low-risk tools inside an allowlisted scope.
5. Main adds a `tool-approval-response` to the message list and calls the model again. Only then does `execute` run.
6. On denial, return a clear denial result and include a system instruction telling the model **not to retry the denied call**.

Every decision is written to `audit_events` with redacted arguments. `PermissionEngine` re-checks the *resolved* target inside `execute` (absolute path, final URL), not just the raw model input.

### 3. Tools allowed in Phase 2 (no others)

- `wiskbot.time.now.v1` — read, no approval.
- `wiskbot.fs.list.v1` — read, only inside allowlisted roots; size/entry caps.
- `wiskbot.fs.read.v1` — read, ask on first path; size cap; binary detection; redact detected secrets.

Fully qualified names. Zod `inputSchema`. `execute` only in main. No write tools, no browser, no desktop, no shell, no payments.

### 4. Loop control and context

- `stopWhen: isStepCount(12)` plus a configurable token/cost budget; stop cleanly when exceeded.
- `activeTools` filtered by the conversation's granted scopes.
- `prepareStep` + `pruneMessages` for compaction when token estimates cross a threshold.
- One `AbortController` per run; `chat.cancel` aborts the model call and all tool calls.
- `toolCallConcurrency: 1` for deterministic tool ordering.

### 5. Fix the two accepted follow-ups

- **Provider metadata drift:** expose provider definitions from main through IPC (new `providers.definitions` channel or extend `providers.list`) and make the renderer consume them. Remove the duplicated static list in `SettingsView.tsx`.
- **`keys.enc` recovery:** add a "Reset encrypted key store" action in Settings with explicit confirmation. It must not silently overwrite the file; on failure show a clear error and leave the file untouched.

### 6. Testing (must be deterministic)

- Add a **fake provider** (in-process, deterministic scripted responses) so no real API key or network is needed.
- Tests must cover: approval request → approve → tool executes; approval request → deny → no retry; cancellation; step budget; path allowlist canonicalisation (`..`, absolute escape, look-alike domains); redaction; audit records.
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
