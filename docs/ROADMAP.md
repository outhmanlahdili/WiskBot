# Development roadmap

Owner: Session 1 · Status: active · Last updated: 2026-11-26

**One phase at a time.** Session 2 receives exactly one prompt, implements only that phase, and reports back. No skipping ahead, no "while I'm here" extras. Each phase ends with a report from Session 2 to Session 1; the next phase prompt is written only after review. This keeps a solo developer's project practical and beginner-friendly.

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

## Phase 2 — Safe agent loop (COMPLETE 2026-11-26)

- [x] `ToolLoopAgent` with streaming events over IPC
- [ ] Conversation persistence and message rendering with tool events
- [ ] `PermissionEngine` + approval UI using the AI SDK two-call approval flow
- [x] Approval card shows tool name, resolved target, scope and concrete values; chat-initiated cards wait indefinitely
- [x] Time tool and low-risk filesystem read/list tools with allowlisted roots; reading WiskBot's own memory/skill folders never prompts
- [x] Signed approval secret (`experimental_toolApprovalSecret`) so forged IPC approvals are rejected
- [x] Fix provider metadata duplication and add `keys.enc` reset recovery
- [x] Audit log viewer; cancellation; budgets and step limits
- [x] Context compaction via `prepareStep` / `pruneMessages`

**Exit criteria met (2026-11-26):** GUI smoke covered approval → result → done, deny → no retry → audit entry, and cancel with no assistant text. 35 tests pass; typecheck and build pass; no secrets in logs. Evidence: Phase 2 report, screenshot and smoke log. Handoff was `docs/PROMPTS/02-safe-agent-loop.md`.

**Accepted follow-ups:** pending approvals and session grants are in-memory (lost on restart); denied calls are stored as tool results with an explicit denial reason so replayed history stays valid — **accepted**; real BYOK providers still not live-tested. `fs.list` asks on first resolved target — **accepted** and `TOOL-CATALOG.md` corrected.

## Phase 3 — Browser automation (COMPLETE 2026-11-26)

- [x] Utility-process BrowserWorker with Playwright and a dedicated persistent profile
- [x] Exact-host domain allowlist, HTTPS-only, test-mode fixtures only under `WISKBOT_TEST_MODE=1`
- [x] Five browser tools with approvals, size caps, secret-field refusal and audited decisions
- [x] Managed-browser indicator, step events, take over / resume / stop, crash recovery
- [x] Phase 3b: screenshot returned a local path only; no image bytes in model context; fill reached `done` cleanly

**Exit criteria met:** GUI smoke covered open → snapshot → click → fill → screenshot → deny → takeover → stop. 42 tests, typecheck and build pass. No secrets in files or history. Evidence: Phase 3/3b reports, screenshots and logs.

## Phase 4 — Memory, preferences, skills

- [ ] Explicit memory save/recall with user-visible context injection
- [ ] Memory stored as an index plus topic files; index injected, entries read on demand
- [ ] Imported/project memory treated as untrusted prompt input and labelled in the UI
- [ ] Preference settings (language, tone, autonomy level)
- [ ] Local skill manifest format, validation, enable/disable, and one built-in example skill
- [ ] Skills may be taught by demonstration later; in Phase 4 they are Markdown + manifest only
- [ ] Skill permission declarations and first-use approval

**Status: verification follow-up required (2026-11-26).** Implementation and tests are strong, but two behaviour details need correction before acceptance: (1) "Allow once" on a skill currently creates a session grant, which contradicts its meaning; (2) user-created memories from Settings are labelled untrusted because only `chat` is trusted. Phase 4b (`docs/PROMPTS/04b-approval-and-trust-fixes.md`) must fix both.

**Expected exit:** memories and skills survive restart; user can inspect, edit, and delete them; injected context is visible; only imported/project memory is marked untrusted; "Allow once" grants exactly one call.

## Phase 5 — Windows computer use

- [ ] DesktopWorker utility process with a UI Automation adapter
- [ ] Window allowlist, element-tree reading, invoke/click/type with highlight
- [ ] Screenshot capture with visible indicator, element highlight before click, and human takeover for sign-in/CAPTCHA
- [ ] Immediate hard-stop control; explicit approval for every action; no shell fallback
- [ ] Read accessibility tree before clicking pixels; never place a secret into typed text
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
- [ ] Routine safety: test runs that send/buy nothing; explicit no-data and stale-data policy; catch-up window; rate limits; run history with success/failure reasons
- [ ] Plain-code checks run before any AI turn so quiet ticks cost nothing (pattern from DuskBot)
- [ ] Document the hard limit: **a fully sleeping PC cannot run anything.** Waking it requires Windows OS configuration (wake timers via `powercfg /waketimers`, device wake via `powercfg /deviceenableawake`, or Wake-on-LAN), not an AI model feature. Source: <https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options>. Muse/Grok/GPT decide actions; the app and OS control execution and power state.

**Exit:** a scheduled task runs and can be cancelled; an MCP server can be added and its tools are gated by permissions; keep-awake is opt-in with a visible indicator and stops when the task ends.

## Phase 7 — Hardening and distribution

- [ ] Dependency audit (npm audit), Electron fuses, code-signing path, NSIS installer
- [ ] Onboarding in 3–4 steps (install → add key/local model → first task → first skill/routine), matching the simple onboarding of AppuBot/DuskBot/Grok Bot
- [ ] Onboarding and security documentation; privacy policy text; telemetry: none by default
- [ ] SBOM and third-party notices (Apache-2.0 obligation); check the 10 moderate npm audit findings
- [ ] Windows smoke tests on a clean VM; update strategy decision
- [ ] Public release checklist and CONTRIBUTING guide

**Exit:** a clean Windows machine can install, configure, and use WiskBot without developer tooling.

## Ordering rationale

Browser before desktop because Playwright is deterministic and isolated, while computer use is probabilistic and can act on the user's real desktop. Memory and skills come before unattended tasks because permissions need a stable source of truth. Hardening is last but security rules apply from Phase 1.
