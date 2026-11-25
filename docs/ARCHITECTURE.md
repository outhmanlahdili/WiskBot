# Application architecture

Owner: Session 1 · Status: proposed for implementation · Last updated: 2026-11-25

## Process model

```
┌──────────────────────────────────────────────────────────────────┐
│ Renderer (React, sandboxed, contextIsolation ON, nodeIntegration OFF) │
│  Chat · Approvals · Settings · Skills · Tasks · Memory · Audit UI │
└───────────────▲──────────────────────────────────────────────────┘
                │ typed IPC via narrow contextBridge (no raw ipcRenderer)
┌───────────────┴──────────────────────────────────────────────────┐
│ Preload                                                          │
│  window.wiskbot = { send(intent), onEvent(handler), ... }        │
└───────────────▲──────────────────────────────────────────────────┘
                │ ipcMain.handle / webContents.send (sender validated)
┌───────────────┴──────────────────────────────────────────────────┐
│ Main process — the only privileged process                       │
│  AppBootstrap · ProviderRegistry · AgentRunner · ToolRegistry     │
│  PermissionEngine · SkillLoader · MemoryService · TaskScheduler  │
│  SecureStore (safeStorage) · Database (Drizzle) · AuditLog       │
└───────┬───────────────────────────────────┬──────────────────────┘
        │ IPC to utility process            │ IPC to utility process
┌───────▼────────────────────┐   ┌──────────▼──────────────────────┐
│ BrowserWorker (Playwright) │   │ DesktopWorker (Windows UIA)     │
│ profile, contexts, pages   │   │ element tree, input, screenshots│
│ domain allowlist          │   │ window allowlist, highlighting  │
└────────────────────────────┘   └─────────────────────────────────┘
```

**Invariant:** no API key, tool implementation, filesystem write, or network action lives in the renderer. The renderer can only request an action and display results.

## Main-process modules

| Module | Responsibility |
| --- | --- |
| `AppBootstrap` | Single instance lock, window creation, secure webPreferences, CSP, fuses, lifecycle, migrations |
| `ProviderRegistry` | Provider definitions, model catalog, capability flags, key resolution, connection test |
| `AgentRunner` | Builds `ToolLoopAgent`, owns the multi-step loop, streams events, applies `prepareStep` compaction and budgets |
| `ToolRegistry` | Tool definitions with Zod schemas, risk metadata, and `execute` functions; fully qualified names to prevent typosquatting |
| `PermissionEngine` | Policy check before every tool execution; returns allow / deny / ask-user / allow-once / allow-session |
| `SecureStore` | Async `safeStorage` encryption/decryption of keys into a local file; never returns keys to renderer |
| `Database` | Drizzle schema + migrations + repositories; WAL mode; one connection in main |
| `MemoryService` | Explicit fact/preference storage, retrieval, summarisation, and user editing |
| `SkillLoader` | Loads local skills from `%APPDATA%/WiskBot/skills`, validates manifests, declares required permissions |
| `TaskScheduler` | Background and scheduled tasks, queue, cancellation, timeout and budget enforcement |
| `AuditLog` | Append-only records of tool calls, arguments (redacted), decisions, results, and errors |

## Message / tool flow

1. Renderer sends `chat.send { conversationId, text }` over IPC.
2. Main creates a user message in SQLite, builds the system instructions from user preferences + approved memory + enabled skills.
3. `AgentRunner.stream()` starts with `activeTools` filtered by the current conversation's granted scopes.
4. Each step emits an event to the renderer: `text-delta`, `tool-call`, `approval-request`, `tool-result`, `error`, `usage`.
5. Before a tool with `execute` runs, `PermissionEngine` checks risk, scope, budget, and allowlists. Tools needing approval use AI SDK `toolApproval: 'user-approval'`; the generation returns a `tool-approval-request`, the renderer shows a diff/preview, and main resumes with a `tool-approval-response`.
6. Tool result goes back into the loop; `stopWhen` (default max ~20 steps) and cost/token budgets bound execution.
7. Final assistant message and all tool events are persisted; audit log is append-only.

**Important SDK detail:** manual approval is a two-call flow. The first generation ends with a `tool-approval-request`; after the user answers, main adds a `tool-approval-response` to the message list and calls the model again. Do not expect the first call to block.

## IPC contract (initial shape)

All channels are namespaced, typed with Zod, and validated for `event.senderFrame` in main. The preload exposes only these methods; it never exposes `ipcRenderer.on` directly.

- `settings.get` / `settings.update`
- `providers.list` / `providers.upsert` / `providers.remove` / `providers.test`
- `conversations.list` / `conversations.create` / `conversations.delete`
- `chat.send` / `chat.cancel`
- `chat.respondApproval { approvalId, approved, reason? }`
- `tools.list` / `permissions.get` / `permissions.update`
- `memory.list` / `memory.upsert` / `memory.delete`
- `skills.list` / `skills.enable` / `skills.import`
- `tasks.list` / `tasks.create` / `tasks.cancel`
- `audit.list`
- `app.deleteLocalData` — added during Phase 1 implementation (approved 2026-11-25) to back the required "Delete all local data" settings action; must close the DB, remove database/keys/settings/skills/logs, and be confirmed in the UI before calling

Events (main → renderer): `chat.event`, `task.event`, `permission.changed`, `provider.event`, `app.error`.

## Local storage layout (Windows)

```
%APPDATA%\WiskBot\
├── wiskbot.db          # SQLite (WAL)
├── settings.json       # non-secret settings, Zod-validated
├── keys.enc            # safeStorage-encrypted credential blobs
├── skills\             # local skills (manifest + instructions)
├── logs\               # rotating structured logs, redacted
└── browser-profile\    # Playwright persistent profile (Phase 3)
```

Secrets are stored only in `keys.enc` as encrypted blobs keyed by provider id. The renderer receives at most `providerId`, `modelId`, `hasKey: boolean`, and a masked hint — never the key.

## Draft database schema

- `conversations(id, title, createdAt, updatedAt, settingsJson)`
- `messages(id, conversationId, role, partsJson, createdAt, usageJson)`
- `tool_calls(id, messageId, toolName, inputJson, risk, status, startedAt, finishedAt)`
- `approvals(id, toolCallId, requestedAt, resolvedAt, approved, reason)`
- `providers(id, kind, displayName, baseUrl, modelId, enabled, capabilitiesJson)`
- `memories(id, kind, content, source, confidence, createdAt, updatedAt, enabled)`
- `skills(id, name, version, path, manifestJson, enabled, requiredScopesJson)`
- `tasks(id, kind, scheduleJson, prompt, enabled, lastRunAt, nextRunAt)`
- `task_runs(id, taskId, startedAt, finishedAt, status, summary, error)`
- `audit_events(id, ts, actor, action, target, decision, detailJson)`
- `settings(key, valueJson)`

Migration strategy: Drizzle Kit migrations, applied at startup before any window content needs data. Never log raw message or tool payloads at info level.

## Permission model

- **Risk levels:** `read` (low), `write` (medium), `external` (medium/high), `destructive` (high), `privileged` (blocked in MVP).
- **Modes:** `deny` · `ask` (default for write/external/destructive) · `allow-once` · `allow-session` · `allow-always` (only for low risk within allowlisted scope).
- **Scopes:** filesystem roots, browser domains, window/process allowlists, network egress hosts, max items per run, cost/token budget, step count.
- Enforcement happens in `PermissionEngine` in the main process; tool `execute` functions re-check the concrete arguments (e.g. resolved absolute path) before acting. This is a policy enforcement point per OWASP ASI02.
- Every decision is written to `audit_events`. Denied calls must not be retried automatically; include a system instruction telling the model not to retry denied tools.

## Context management

- Keep the last N turns verbatim; summarise older turns into a rolling summary stored in SQLite.
- Use AI SDK `prepareStep` with `pruneMessages` when token estimates cross a configurable threshold.
- Inject only memory entries the user has explicitly enabled; show which memories were included in the UI ("context shown to model").

## Error and cancellation model

- Each run has an `AbortController`; `chat.cancel` aborts the model call and all tool calls.
- Tool errors become `tool-error` parts and are shown in the UI; the loop may continue once, then stops on repeated failure to avoid doom loops.
- Provider failures surface as user-readable errors with a link to provider status; never expose raw key material in errors.

## Testing strategy

- Unit tests (Vitest) for permission decisions, config validation, redaction, path/domain allowlist checks, and message compaction.
- Integration tests with a fake provider and temporary SQLite database.
- Manual smoke checklist per phase; Playwright tests only for the browser worker itself.
- Never run destructive tools against the developer's real profile; use dedicated test folders and browser contexts.
