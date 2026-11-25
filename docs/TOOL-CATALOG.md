# Tool catalog

Owner: Session 1 · Status: proposed · Last updated: 2026-11-25

All tools are defined in the main process with Zod `inputSchema`, a stable fully qualified name (e.g. `wiskbot.fs.readFile.v1`), risk metadata, and an approval policy. Tool descriptions are untrusted-adjacent: they must not be loaded from MCP or skill files without validation (OWASP ASI02 tool poisoning).

Risk levels: `read` < `write` < `external` < `destructive`. `privileged` tools are out of scope for the MVP.

| Tool | Phase | Capability | Risk | Default approval | Scope / guard |
| --- | --- | --- | --- | --- | --- |
| `wiskbot.time.now.v1` | 1 | Current local time and timezone | read | none | — |
| `wiskbot.providers.test.v1` | 1 | Generate a short response with the selected provider | external | ask on first use per provider | Never logs key; short timeout and token cap |
| `wiskbot.fs.list.v1` | 2 | List entries in an allowlisted directory | read | none per granted scope | Resolve real path; deny symlink escape; max entries |
| `wiskbot.fs.read.v1` | 2 | Read a text file in an allowlisted directory | read | ask on first path | Size cap, binary detection, redaction of detected secrets |
| `wiskbot.fs.write.v1` | 2 | Write a text file in an allowlisted directory | write | always ask (allow-once/session available) | Show diff preview; no overwrite outside workspace root |
| `wiskbot.web.fetch.v1` | 2 | Fetch an HTTPS URL and extract readable text | external | ask for new domain | HTTPS only, domain allowlist, size cap, redirect validation, SSRF protection |
| `wiskbot.browser.open.v1` | 3 | Open a URL in the managed browser context | external | ask for new domain | Domain allowlist; dedicated profile; no user's logged-in sessions |
| `wiskbot.browser.snapshot.v1` | 3 | Accessibility snapshot / DOM text of active tab | read | none for allowlisted domain | Content labelled untrusted; strip scripts |
| `wiskbot.browser.click.v1` | 3 | Click a locator in the active tab | write | ask unless allowlisted action | Locator must resolve to exactly one element |
| `wiskbot.browser.type.v1` | 3 | Fill a form field | write | ask for sensitive fields | Never type into password/payment fields without explicit user confirmation |
| `wiskbot.browser.screenshot.v1` | 3 | Screenshot of managed tab | read | none for allowlisted domain | Stored locally, user-visible indicator |
| `wiskbot.memory.save.v1` | 4 | Store a preference or fact | write | ask | User can view/edit/delete; source recorded |
| `wiskbot.memory.recall.v1` | 4 | Search user memories | read | none for enabled entries | Show injected memories in UI |
| `wiskbot.skill.invoke.v1` | 4 | Run a local skill's instructions as a sub-agent | external | ask on first invocation per skill | Manifest must declare required scopes; pinned version; no arbitrary scripts in MVP |
| `wiskbot.desktop.tree.v1` | 5 | Read UI Automation element tree of an allowlisted window | read | ask on first window | No credentials in returned text; depth cap |
| `wiskbot.desktop.activate.v1` | 5 | Focus an allowlisted window | write | ask | Window title/process allowlist |
| `wiskbot.desktop.click.v1` | 5 | Invoke a UI Automation element or click coordinates | write | always ask | Visual highlight before execution; no coordinates on password fields |
| `wiskbot.desktop.type.v1` | 5 | Type text into the focused element | write | always ask | Clipboard-safe; refuse secrets fields |
| `wiskbot.desktop.screenshot.v1` | 5 | Capture a window or region | read | always ask | Visible indicator; output stored locally |
| `wiskbot.task.schedule.v1` | 6 | Create a scheduled/background task | write | always ask | Budget cap; visible run history; cancel support |
| `wiskbot.mcp.call.v1` | 6 | Call a tool from a user-installed MCP server | external | ask per server + per destructive call | Pin server id/version; validate tool names; egress allowlist |

## Explicitly excluded from the MVP

- Arbitrary shell / PowerShell / `cmd` execution.
- Registry edits, driver installs, service changes, OS settings changes.
- Sending email, posting to social accounts, payments, or purchases without a dedicated explicit-approval flow (not planned before Phase 6).
- Reading browser cookies/passwords or protected storage.
- Disabling antivirus, security software, or Electron security features at runtime.
- Autonomous downloading and executing files.

## Tool definition rules for Session 2

1. Use `tool({ description, inputSchema: z.object({...}), execute })` from the AI SDK; prefer `strict: true` where the provider supports it.
2. Define tools in a single registry map so `activeTools` can filter them per conversation.
3. `execute` runs only in main or in the owning utility process. Never in the renderer.
4. Check the *resolved* target (absolute path, final URL after redirects, window identity) inside `execute`, not just the raw model input.
5. Add `toolApproval` policy in one place; do not scatter `needsApproval` across tools.
6. Return small, structured results. Large output must be summarised before entering the model context.
7. Every call writes an audit event with redacted arguments and the approval decision.
8. On denial, return a clear denial result and instruct the model not to retry the same call.
9. Validate inputs against path/domain allowlists with canonicalisation to prevent traversal and look-alike domains (`example.com.attacker.com`).

## Approval UX requirements

- Show tool name, human-readable intent, target, and a diff or preview before approval.
- Provide `Allow once`, `Allow for this session`, and `Deny`. `Allow always` only for low-risk tools with a scope.
- Show a clear "assistant is waiting for your approval" state; the model call is paused at the loop level, not the UI level.
- Log every decision with timestamp and reason.
