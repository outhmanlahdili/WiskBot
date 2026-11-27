# Handoff 06b — Optional MCP integrations and local model profiles

Owner: Session 1 · Prepared: 2026-11-27 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 6 part A (background tasks) must be complete and reported before starting this. Verified facts:

- `@modelcontextprotocol/sdk@1.32.2` is MIT-licensed and is the official TypeScript MCP implementation (<https://registry.npmjs.org/@modelcontextprotocol/sdk/latest>).
- MCP is an open standard for connecting AI apps to external tools/data (<https://modelcontextprotocol.io/docs/getting-started/intro>).
- Ollama exposes a local API at `http://localhost:11434/api` and OpenAI-compatible `http://localhost:11434/v1`; local requests need no key (<https://docs.ollama.com/api>). LM Studio is documented by the AI SDK as an OpenAI-compatible provider.

This handoff is **Phase 6 part B**. Implement only MCP client support and local-model profiles. Do not modify `docs/`. Do not push to GitHub yet.

## Your task

### 1. Local model profiles

- Extend the provider registry with two built-in profiles: **Ollama** (`http://localhost:11434/v1`, no key) and **LM Studio** (`http://localhost:11433/v1`, no key). Make them discoverable in Settings.
- Add a "Refresh models" action that fetches the model list from the local endpoint (`GET /v1/models`) and stores IDs. Handle connection failure with a clear message; never block the UI.
- No hard-coded "best" model — follow ADR-011. Default model ID stays empty until the user picks one.
- Keep keys optional and masked; local profiles never require a key.

### 2. MCP client (read-only first)

- Add `@modelcontextprotocol/sdk`. Implement a client that connects to a user-supplied server (remote HTTPS or local command) and lists its tools.
- Store MCP servers in settings with: id, name, transport, target, enabled, and a pinned version/config hash. Changes to the target or config invalidate any saved approval.
- **Read-only first:** only tools that the server marks `readOnlyHint` (and whose names do not indicate writes) are eligible. Any write/send/delete tool is refused in this phase even if the server offers it.
- MCP tool schemas are untrusted: flatten/validate them with Zod before exposing to the model; reject `oneOf`/`anyOf`/`allOf`/`const`/`format` composition and require a plain object schema with string enums allowed. Coerce obvious stringified values; refusal errors must include a literal example.
- All MCP tool calls require the same approval card as built-in tools, use fully qualified names (e.g. `mcp.<serverId>.<toolName>`), and are audited with redacted arguments.
- A server that fails to connect is marked unavailable; never crash the app.

### 3. UX and safety

- Settings UI: add/list/remove MCP servers, enable/disable, refresh tools, and show which tools are read-only.
- Never download or run arbitrary server code automatically — the user supplies the command/target explicitly and approves it.
- No filesystem writes from MCP tools in this phase, no egress allowlist bypass, no secrets in tool args or logs.

### 4. Tests and GUI smoke

- Tests use a **fake MCP server** in-process: tool list with composition schemas rejected, read-only filtering, approval → execute, deny → no retry, target-change invalidates grant, connection failure → unavailable.
- GUI smoke: add a fake local MCP server, list its tools, call one read-only tool with approval, deny a second, confirm audit entries and no secrets in logs.
- Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

## Report format

```
## Phase 6b report
- Local model profiles and refresh behaviour
- MCP client files/transport and version pinning
- Read-only filtering + schema validation evidence
- Approval / deny / audit evidence
- IPC channels and Settings UI
- Tests + npm test / typecheck / build results
- GUI smoke evidence
- Files changed / deviations / risks
```
