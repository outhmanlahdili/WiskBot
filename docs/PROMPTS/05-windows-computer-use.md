# Handoff 05 — Windows desktop computer use

Owner: Session 1 · Prepared: 2026-11-26 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 4 was reviewed and **accepted** (commits `be4da8e`, `6e5cc5a`). Verified state:

- `src/main/tools/index.ts` holds `TOOL_META`, `ApprovalKind`, `toolNeedsApproval()` and `createTools()` with time, filesystem, browser, memory and skill tools.
- `src/main/agent/runner.ts` owns the agent loop, approvals, session grants and streaming events.
- `src/main/browser-worker/` shows the established utility-process + Zod message-port pattern. Mirror it, do not reinvent it.
- Windows UI Automation is an official accessibility framework with .NET classes such as `AutomationElement`, `TreeWalker`, `InvokePattern`, `ValuePattern` and `TextPattern` (<https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation>, <https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32>).

Now implement **Phase 5 only**. Read `docs/ROADMAP.md` Phase 5, `docs/TOOL-CATALOG.md`, `docs/ARCHITECTURE.md`, and the current files. Do not modify `docs/`. Do not start Phase 6. Do not push to GitHub yet.

## Your task

### 1. DesktopWorker (Windows-only utility process)

- Create `src/shared/desktop.ts` with a Zod-validated main↔worker protocol (like `src/shared/browser.ts`): start, tree, activate, invoke/click, type, screenshot, setPaused, shutdown, plus results/status.
- Create `src/main/desktop-worker/index.ts` (utility process, `process.parentPort.postMessage`) and `src/main/desktop-worker/manager.ts` (main side, `utilityProcess.fork()` after app ready, request correlation with timeouts, status, restart on crash). Add a third electron-vite input entry in `electron.vite.config.ts` alongside `browser-worker/index` so it emits `out/main/desktop-worker/index.js`.
- Mirror browser wiring end to end: add `desktop?: DesktopControl` to `ToolRunContext` (`src/main/tools/index.ts`) **and** `AgentDeps` (`src/main/agent/runner.ts`), pass it through like `browser: deps.browser`, and create a `DesktopManager` singleton in `src/main/ipc.ts` supplied to the agent. Add IPC channels `desktop.status`, `desktop.takeover`, `desktop.stop`, `desktop.restart` (validated by the existing `handle()` helper) and a `desktop-status` variant in `ChatEventSchema`.
- On non-Windows, desktop tools report unavailable with a clear message. No silent fallback.

### 2. UI Automation adapter — fixed script, no model shell

- Add a **fixed** PowerShell script under `resources/scripts/uia.ps1` that loads `UIAutomationClient`/`UIAutomationTypes` and handles one JSON request at a time read from **stdin**. Use `System.Windows.Automation` classes only.
- Main/worker spawns it via `child_process.spawn` with an **args array**, e.g. `['-NoProfile','-NonInteractive','-File', scriptPath]`. **Never build a command string from model input**, never `shell: true`. Pass arguments as JSON on stdin; parse JSON on stdout. This is an internal adapter, not a model-accessible shell tool.
- Operations: list top-level windows; find an allowlisted window by exact title (`AutomationElement.RootElement` + `FindFirst`); read a bounded tree via `TreeWalker`; invoke via `InvokePattern`; set a value via `ValuePattern`; read text via `TextPattern`; get `BoundingRectangle`. These classes are verified in `UIAutomationClient.dll` (<https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement>).
- Reject password/secret controls using `IsPasswordProperty`, control type, name and automation id. Never return or type their values.

### 3. Window allowlist and tools

Add `desktopWindowTitles: string[]` across all settings layers (`SettingsSchema` is `.strict()`, `DEFAULT_SETTINGS`, `load()`, `updateSettings()`, IPC, Settings UI). Exact title match; empty by default means desktop tools are unavailable.

Add to `TOOL_META` / `ApprovalKind` / `toolNeedsApproval()` / `createTools()`:

- `wiskbot.desktop.tree.v1` — bounded element tree of an allowlisted window (cap depth and nodes). Risk `read`. Ask on first window; session grant afterwards. Never include secret-field values.
- `wiskbot.desktop.activate.v1` — focus an allowlisted window. Risk `write`. Always ask.
- `wiskbot.desktop.click.v1` — invoke an element by automation id/name, or click a point. Risk `write`. Always ask. Show a visible highlight/indicator before acting. Refuse secret controls.
- `wiskbot.desktop.type.v1` — set text via `ValuePattern` only. Risk `write`. Always ask. Refuse password fields; never use SendKeys for secrets.
- `wiskbot.desktop.screenshot.v1` — capture the allowlisted window region via .NET `CopyFromScreen` using `BoundingRectangle`, save a PNG locally, return **path only** (no bytes/base64 into model context). Risk `read`. Always ask; visible indicator.

`desktopCapturer.getSources()` mainly exposes thumbnails for `getUserMedia`; do not rely on it as the primary desktop screenshot path (<https://www.electronjs.org/docs/latest/api/desktop-capturer>). Use .NET `Graphics.CopyFromScreen(sourceX, sourceY, 0, 0, Size)` with the element/window `BoundingRectangle`, verified at <https://learn.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen>. Cap the captured size before saving.

### 4. Trust, control and UX

- Page/window content and element names are **untrusted data**, never instructions. Keep the existing system instruction.
- Show a permanent "assistant is controlling the desktop" indicator while a desktop action runs, plus step events.
- Human **take over**: pause worker actions while the user completes sign-in/CAPTCHA/2FA, then resume. Keep the existing stop control working.
- Every action is audited with redacted arguments. Denied calls must not retry.
- No arbitrary shell tool, no registry edits, no service changes, no downloads, no script execution from model input.

### 5. Tests and GUI smoke

- Unit/integration tests use a **fake UIA adapter** — never touch the real desktop or real `%APPDATA%` profile. Cover: allowlist rejection, tree caps, secret-field refusal, approval → execute, deny → no retry, path-only screenshot result, crash → clear error.
- GUI smoke on Windows with a safe test window such as an unsaved Notepad document: allowlist its exact title, read the tree, activate it, type a harmless string, take a screenshot (confirm path only), deny one click with no retry, and use stop. Capture a console excerpt or screenshot.
- Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

Evaluate (do not implement) Meta's native `computer` tool as a future provider-specific option — AI SDK support is unverified, so our driver-owned design stays the default.

## Report format

```
## Phase 5 report
- DesktopWorker files/process model and restart behaviour
- UIA adapter operations and command-injection guards
- Window allowlist + tools and their guards
- Take over / stop / indicator evidence
- Tests added + npm test / typecheck / build results
- GUI smoke evidence
- Files changed
- Deviations from docs/ with reasons
- Remaining risks and questions
```
