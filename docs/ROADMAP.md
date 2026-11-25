# Development roadmap

Owner: Session 1 · Status: proposed · Last updated: 2026-11-25

Each phase ends with a report from Session 2 to Session 1. Do not start the next phase until the previous one is reviewed.

## Phase 0 — Research and architecture (Session 1, complete)

- [x] Research prior art and verify the stack
- [x] Document product, architecture, tools, security, and decisions
- [x] Produce the first implementation prompt for Session 2

**Exit:** this documentation set exists and the handoff prompt is in `docs/PROMPTS/`.

## Phase 1 — Foundation and secure shell (COMPLETE 2026-11-25)

- [x] Scaffold electron-vite `react-ts` project with strict TypeScript
- [x] Tailwind + shadcn/ui base layout: chat shell, settings, sidebar
- [x] Secure window setup: `contextIsolation`, sandbox, no `nodeIntegration`, CSP, navigation/window restrictions, custom protocol, IPC sender validation
- [x] Typed IPC bridge via `contextBridge` with Zod-validated payloads
- [x] SQLite + Drizzle schema and migrations with `@electron/rebuild`
- [x] `safeStorage` async secure key store; settings and provider registry; one provider connection test
- [x] i18n scaffolding with en/fr/ar catalogs and RTL support
- [x] Vitest unit tests for config validation, redaction, IPC schema; README + **Apache-2.0** `LICENSE` + `NOTICE` + community files + `.gitignore`
- [x] **Phase 1b:** preload emitted as CJS with bundled deps under `sandbox: true`; GUI smoke test passed with console/screenshot evidence

**Exit criteria met:** app launched on Windows with no security warnings; provider key saved/redacted and connection test returned a legible error; database and keys file created; en/fr/ar + RTL verified; `npm test` / `typecheck` / `build` all pass. Evidence: Phase 1b report plus screenshots in the temp folder.

**Accepted follow-ups (not Phase 1 blockers):** Electron binary may need `node node_modules/electron/install.js` on fresh installs; only one provider was live-tested; `keys.enc` decryption failure has no in-app recovery yet; provider metadata is duplicated between main and renderer; renderer bundle ~843 kB and 10 moderate npm audit findings are Phase 7 items.

## Phase 2 — Safe agent loop

- [ ] `ToolLoopAgent` with streaming events over IPC
- [ ] Conversation persistence and message rendering with tool events
- [ ] `PermissionEngine` + approval UI using the AI SDK two-call approval flow
- [ ] Time tool and low-risk filesystem read/list tools with allowlisted roots
- [ ] Audit log viewer; cancellation; budgets and step limits
- [ ] Context compaction via `prepareStep` / `pruneMessages`

**Exit:** a user can chat, approve a read-only tool, see the tool result, deny a tool without retry, cancel a run, and inspect the audit log. Tests cover permission decisions and denial handling.

## Phase 3 — Browser automation

- [ ] BrowserWorker utility process with Playwright and a dedicated persistent profile
- [ ] Domain allowlist and per-domain approval
- [ ] `open`, `snapshot`, `click`, `type`, `screenshot` tools
- [ ] Treat all page content as untrusted; never execute page JavaScript as trusted input
- [ ] Visible "managed browser" indicator and activity log

**Exit:** a user can ask the assistant to perform a multi-step task on an allowlisted site, with approvals, and inspect what happened. No use of the user's real logged-in browser profile.

## Phase 4 — Memory, preferences, skills

- [ ] Explicit memory save/recall with user-visible context injection
- [ ] Preference settings (language, tone, autonomy level)
- [ ] Local skill manifest format, validation, enable/disable, and one built-in example skill
- [ ] Skill permission declarations and first-use approval

**Exit:** memories and skills survive restart; user can inspect, edit, and delete them; injected context is visible in the UI.

## Phase 5 — Windows computer use

- [ ] DesktopWorker utility process with a UI Automation adapter
- [ ] Window allowlist, element-tree reading, invoke/click/type with highlight
- [ ] Screenshot capture with visible indicator
- [ ] Explicit approval for every action; no shell fallback
- [ ] Evaluate (do not assume) Meta's native `computer` tool on the Responses API as an optional provider-specific path; AI SDK support is unverified, so the driver-owned design remains the default

**Exit:** a repeatable, low-risk desktop task (e.g. reading a window's text and clicking a known button in an allowlisted app) succeeds with approval and produces a full audit trail. Reliability limitations are documented in-product.

## Phase 6 — Background tasks and integrations

- [ ] Task scheduler with cron/interval/one-shot, cancellation, budgets, run history
- [ ] Optional MCP client with server installation UI, pinned versions, and egress controls
- [ ] Local model profiles (Ollama / LM Studio) with model catalog refresh
- [ ] **Keep-awake support** (user-approved 2026-11-25): use Electron `powerSaveBlocker.start('prevent-app-suspension')` while a task runs, and `stop(id)` when it finishes — PC stays active, screen may sleep. Source: <https://www.electronjs.org/docs/latest/api/power-save-blocker>.
- [ ] Visible "WiskBot is keeping this PC awake" indicator; setting to disable it; battery-friendly by default (never hold the blocker indefinitely)
- [ ] Queue tasks while offline and resume when online; prefer local models (Ollama) for offline runs
- [ ] Optional "start WiskBot at login" setting
- [ ] Document the hard limit: **a fully sleeping PC cannot run anything.** Waking it requires Windows OS configuration (wake timers via `powercfg /waketimers`, device wake via `powercfg /deviceenableawake`, or Wake-on-LAN), not an AI model feature. Source: <https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options>. Muse/Grok/GPT decide actions; the app and OS control execution and power state.

**Exit:** a scheduled task runs and can be cancelled; an MCP server can be added and its tools are gated by permissions; keep-awake is opt-in with a visible indicator and stops when the task ends.

## Phase 7 — Hardening and distribution

- [ ] Dependency audit (npm audit), Electron fuses, code-signing path, NSIS installer
- [ ] Onboarding and security documentation; privacy policy text; telemetry: none by default
- [ ] Windows smoke tests on a clean VM; update strategy decision
- [ ] Public release checklist and CONTRIBUTING guide

**Exit:** a clean Windows machine can install, configure, and use WiskBot without developer tooling.

## Ordering rationale

Browser before desktop because Playwright is deterministic and isolated, while computer use is probabilistic and can act on the user's real desktop. Memory and skills come before unattended tasks because permissions need a stable source of truth. Hardening is last but security rules apply from Phase 1.
