# Handoff 01 — Foundation and secure shell

Owner: Session 1 · Prepared: 2026-11-25 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

You are Session 2 (Builder) on **WiskBot**, a free, open-source, Windows-first desktop personal AI assistant. Session 1 (Research & Architect) maintains `docs/`; you own all source code and configuration. Read these files first — they are the shared source of truth:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/TECH-STACK.md`
- `docs/TOOL-CATALOG.md`
- `docs/DECISIONS.md`
- `docs/ROADMAP.md`

Do not modify anything inside `docs/`. Do not start any phase other than Phase 1. If you find an architectural problem, report it instead of silently improvising.

Environment observed by Session 1: Windows, Node **v24.13.0**, npm **11.8.0**, project folder currently empty apart from `docs/`.

## Your task: implement Phase 1 only

### 1. Project scaffold

- Scaffold an Electron + electron-vite project with the **React + TypeScript** template (`npm create @quick-start/electron@latest . -- --template react-ts`, adapting for a non-empty folder — do not delete `docs/`).
- Use `"type": "module"` in `package.json` (the AI SDK is ESM-only).
- Strict TypeScript. Keep the `main` / `preload` / `renderer` sections in `electron.vite.config.ts`.
- Add scripts: `dev`, `build`, `preview`, `typecheck`, `test`, and an explicit `rebuild` script that runs `@electron/rebuild`.
- Add `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`, `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@electron/rebuild`, `tailwindcss`, `lucide-react`, `vitest`. Install current versions and record resolved versions in `package.json`. Both AI SDK adapter packages are required: `@ai-sdk/openai-compatible` is for LM Studio/custom endpoints and Muse Chat Completions; `@ai-sdk/openai` is for Muse's Responses API.
- Configure Tailwind + shadcn/ui primitives (button, input, card, dialog, tabs) in the renderer. Keep styling clean and simple; no need for a finished visual design.
- Add `README.md` and `.gitignore`.

### 1b. Open-source repository files (licence is APPROVED — create these now)

The user approved **Apache-2.0** on 2026-11-25 (ADRs 014, 023–033). Create the following files. **Do not publish any personal legal name or personal email address** — use the wording given here exactly.

1. **`LICENSE`** — copy the complete Apache License 2.0 text verbatim from `https://www.apache.org/licenses/LICENSE-2.0.txt`. Prepend this line:
   `Copyright 2026 WiskBot contributors`
   Do not add per-file licence headers to source files.
2. **`NOTICE`** — create with this content:
   ```text
   WiskBot
   Copyright 2026 WiskBot contributors

   This product includes software developed by the WiskBot contributors.
   Third-party components are distributed under their own licences;
   see THIRD-PARTY-NOTICES.md and the LICENSE files of those components.
   ```
   (`THIRD-PARTY-NOTICES.md` is a later Phase 7 task; do not invent its contents now.)
3. **`package.json`** — set `"license": "Apache-2.0"`.
4. **`CONTRIBUTING.md`** — cover: Node/install/rebuild/test/build commands; **DCO 1.1 sign-off required** via `git commit -s` (no CLA); one concern per PR; tests for changed behaviour; update `docs/` when architecture changes; no API keys, tokens, real user data, or `%APPDATA%` files in commits/fixtures; security bugs go to `SECURITY.md`, never public issues; link to `CODE_OF_CONDUCT.md`. Use a welcoming tone.
5. **`CODE_OF_CONDUCT.md`** — Contributor Covenant **v2.1** verbatim from `https://www.contributor-covenant.org/version/2/1/code_of_conduct/`. Replace `[INSERT CONTACT METHOD]` with exactly `[CODE_OF_CONDUCT_CONTACT — TO BE SUPPLIED]`. Do not substitute a personal email.
6. **`SECURITY.md`** — state: latest release only is supported; report via GitHub **private vulnerability reporting** (no public issues); include summary, affected version, PoC, impact; if a key may have leaked, rotate it at the provider immediately; WiskBot has no server. Response times must be explicitly labelled **targets, not guarantees**: acknowledge within **7 days**, target fix within **30 days** for a confirmed high-severity issue.
7. **`TRADEMARKS.md`** — short policy: Apache-2.0 grants no rights to the WiskBot name or logo; forks must not imply endorsement; contact the maintainers for permission requests (use the same placeholder, not a personal email).
8. **`.github/` files** — `dependabot.yml` (npm + github-actions, weekly); `ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`; `pull_request_template.md`; `CODEOWNERS` assigning the repository owner for `*` and `/docs/`; `VULNERABILITY_REPORT.yml` with summary, proof of concept (min length 100), and impact.

Do not enable GitHub repository settings from code; those are manual steps for the user (secret scanning, push protection, Dependabot, CodeQL, private vulnerability reporting). Branch protection is deliberately deferred until after the first release.

### 2. Secure window setup (non-negotiable)

Follow the Electron security checklist in `docs/ARCHITECTURE.md`:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity` untouched.
- Restrictive CSP via meta tag or `webRequest.onHeadersReceived` (no `unsafe-inline` for scripts).
- Serve app assets through a custom protocol or electron-vite's dev protocol — not `file://` in production.
- `will-navigate` and `setWindowOpenHandler` restrict navigation; `shell.openExternal` only for a strict HTTPS allowlist.
- Validate `event.senderFrame` in every `ipcMain.handle`.
- Preload exposes a narrow `window.wiskbot` object only. **Never** expose raw `ipcRenderer.on`, `ipcRenderer.send`, or any Node/Electron API to the renderer.

### 3. Typed IPC bridge

- Define Zod schemas for all Phase 1 IPC payloads in a shared `src/shared/` folder usable by main and preload.
- Implement these channels (stubs are acceptable where the feature is later, but the schema and handler skeleton must exist):
  `settings.get`, `settings.update`, `providers.list`, `providers.upsert`, `providers.remove`, `providers.test`, `conversations.list`, `conversations.create`, `conversations.delete`, `chat.send`, `chat.cancel`, `chat.respondApproval`, `tools.list`, `permissions.get`, `audit.list`.
- Renderer subscribes through a typed `onEvent` helper; define the event union (`chat.event`, `task.event`, `permission.changed`, `provider.event`, `app.error`) but no need to emit all yet.

### 4. Persistence and secrets

- Create the Drizzle schema from `docs/ARCHITECTURE.md` (all tables, even if unused now). Add Drizzle Kit config and generate an initial migration.
- Open SQLite at `%APPDATA%\WiskBot\wiskbot.db` with WAL mode; apply migrations at startup. Run `npm run rebuild` before dev/build if the native module fails to load.
- Implement `SecureStore` using the **async** Electron API: `safeStorage.isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()`. Store encrypted blobs in `%APPDATA%\WiskBot\keys.enc`. If encryption is unavailable, refuse to save keys and show a clear error — do not fall back to plaintext.
- Provider registry supports: OpenAI, Anthropic, Google, Groq, OpenRouter, **Meta Model API (Muse)**, Ollama (local, no key), and an OpenAI-compatible custom endpoint. For Muse use base URL `https://api.meta.ai/v1` and key `MODEL_API_KEY`; the default model id should be `muse-spark-1.3` (do not hard-code a claim that it is available in every country — show an availability note). Store only `{ id, kind, displayName, baseUrl, modelId, enabled, capabilities }` plus an encrypted key blob.
- For Muse, prefer the Responses API adapter (`@ai-sdk/openai` + `meta.responses(modelId)`) with reasoning continuity options; Chat Completions via `@ai-sdk/openai-compatible` is a fallback. Details in `docs/RESEARCH.md`.
- `providers.test` calls `generateText` with a tiny token cap and a short timeout, using the key resolved in main. It must never return or log the key, and must redact it from error messages.

### 5. UI shell (static is fine)

- Sidebar: New chat, conversation list, Settings, Audit (placeholder), Tasks (placeholder), Skills (placeholder).
- Main area: chat layout with message list, composer, streaming indicator placeholder. No agent loop yet.
- Settings page: provider list with add/edit/delete, model id, base URL for custom endpoints, "Test connection" button, permission defaults, language selector (English / Français / العربية), and a "Delete all local data" action with confirmation.
- Show only `hasKey` / masked hint for stored keys. Never render the key.

### 6. i18n

- Key-based JSON catalogs for `en`, `fr`, `ar` in the renderer; use CSS logical properties so Arabic RTL works. Wire the language selector to persisted settings.

### 7. Tests

Vitest unit tests for:

- Zod validation of `settings.update` and `providers.upsert` payloads.
- Key redaction in provider errors and logs.
- Permission decision helpers (even if the engine is only a stub with `read/write/external/destructive` risk levels).
- Path allowlist canonicalisation helper (reject `..`, absolute escapes, and look-alike domains).

Run `npm test`, `npm run typecheck`, and `npm run build`. All must pass.

## Explicitly do NOT do in this phase

- No agent loop, no `ToolLoopAgent`, no tool execution.
- No browser automation, no Playwright browser launch.
- No filesystem read/write tools.
- No local HTTP server, no `useChat`.
- No shell/PowerShell execution, no registry access.
- No telemetry, analytics, crash upload, or network calls except the explicit provider test.
- No modification of `docs/`.

## Definition of done

1. `npm run dev` opens the app on Windows with no Electron security warnings in the console.
2. A provider can be added with a key, the key is stored encrypted, and "Test connection" succeeds or fails with a legible redacted message.
3. `wiskbot.db` is created with all migrations applied.
4. Language switching works, including Arabic RTL layout.
5. `npm test`, `npm run typecheck`, `npm run build` all pass.
6. You report back using the format below.

## Report format (send back to Session 1)

```
## Phase 1 report
- Resolved versions: electron=…, ai=…, electron-vite=…, better-sqlite3=…, drizzle-orm=…, zod=…
- Files created / changed (grouped by area)
- Deviations from docs/ARCHITECTURE.md or docs/TECH-STACK.md, with reason
- Verification: npm test / typecheck / build results
- Screenshots or console excerpts (if useful)
- Bugs or fragile areas found
- Questions for Session 1
- Suggested next phase
```

Do not mark work complete without evidence from the commands above.
