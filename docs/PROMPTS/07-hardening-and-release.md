# Handoff 07 — Hardening, packaging and release readiness

Owner: Session 1 · Prepared: 2026-11-28 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 6 is **complete and accepted** (commits `4239ed1`, `ca91046`). All product features are implemented. Phase 7 is the **final** phase: hardening, documentation and distribution preparation. **No new features.** Do not modify `docs/`. Do not publish a release without user approval.

## Your task

### 1. Dependency and licence hygiene

- Run `npm audit --omit=dev` and `npm audit`; report findings. Fix only what can be fixed without breaking behaviour; document the rest.
- Generate or update `THIRD_PARTY_NOTICES.md` from installed dependencies and their licences. Keep the Apache-2.0 `NOTICE` accurate.
- Confirm no secret, token or personal identifier appears in tracked files or git history (use a regex scan; report only counts and file names, never secret values).
- Do not add new runtime dependencies in this phase.

### 2. Electron hardening

- Review `@electron/fuses` and document/apply safe fuses (e.g. disable `runAsNode` and `nodeCliInspect` if they don't break dev workflows).
- Confirm in a built app: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP, sender validation, custom protocol, preload CJS.
- Confirm no telemetry or analytics calls are compiled in.

### 3. Packaging

- Produce two artifacts with the existing `electron-builder` scripts:
  - **Portable ZIP** (recommended first release)
  - **NSIS installer** (`build:win`)
- Verify both launch on a clean Windows profile with no developer tools installed.
- Document the Playwright Chromium install step for developers; packaged builds must not download browsers at runtime.
- Signing: **do not attempt code signing yet**. Document the plan in `README.md`: SignPath Foundation free OSS signing first, EV/cloud certificate only if needed; unsigned builds will show a SmartScreen warning.

### 4. Documentation inside the repo (not `docs/`)

- `README.md`: final quick start, BYOK/local-model setup, permissions/approvals, tasks, MCP trust warning, Windows signing note, "no telemetry".
- `SECURITY.md`: add an explicit warning that a user-supplied local MCP stdio command runs with the app's privileges, is disabled by default, and is not sandboxed; repeat the 7-day / 30-day **targets**, not guarantees.
- `CHANGELOG.md` or release notes from v0.1.0 features; `CONTRIBUTING.md` already exists.
- Privacy statement: local-first, keys stay on device, no WiskBot server.

### 5. Update strategy and final verification

- Document the update decision: **manual download for now**, no auto-updater. Explain why (signing not yet available).
- Final smoke: fresh install from the ZIP, add a key or local model, chat, approve a safe tool, check audit, create a task, and verify no secrets in logs.
- Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

### 6. What to hand back

Do not push. Report:

```
## Phase 7 report
- npm audit findings and fixes/deferrals
- Licence/NOTICE/THIRD_PARTY_NOTICES status
- Secret-scan result (counts only)
- Fuses applied and security checklist evidence
- Artifacts produced + clean-Windows launch evidence
- Documentation files changed
- Update strategy decision
- Final test / typecheck / build results
- Remaining risks and release blockers
```
