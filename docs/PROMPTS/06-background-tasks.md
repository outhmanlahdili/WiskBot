# Handoff 06 — Background tasks and keep-awake

Owner: Session 1 · Prepared: 2026-11-27 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 5 was reviewed and **accepted** (commit `fd556a1`). Verified state:

- `src/main/database/schema.ts` already has `tasks` and `task_runs` tables — reuse them, do not create new tables.
- `src/main/agent/runner.ts` runs the agent loop and can be invoked from main without renderer involvement.
- Existing permission/approval, audit and event patterns are in `src/shared/ipc.ts` and `src/main/ipc.ts`.
- `croner@11` is MIT-licensed with no runtime dependencies (<https://registry.npmjs.org/croner/latest>), suitable for cron schedules.

This handoff is **Phase 6 part A**. Implement only background tasks, keep-awake and offline queue. MCP and local-model profiles come in `06b`. Do not modify `docs/`. Do not push to GitHub yet.

## Your task

### 1. Task service and scheduler

Create `src/main/tasks/` with `service.ts` and `scheduler.ts`:

- CRUD on the existing `tasks` table (`id`, `kind`, `scheduleJson`, `prompt`, `enabled`, `lastRunAt`, `nextRunAt`).
- Schedule kinds: `once` (epoch ms), `interval` (minutes), `cron` (use `croner` with an explicit IANA timezone). Validate all inputs with Zod.
- `taskRuns` rows are created on start and updated on finish with `status`, `summary` and `error`.
- One run at a time per task; no overlapping copies. A missed run may be dispatched at most **12 hours late**, then marked `missed`.
- Rate limits: max 3 concurrent runs overall, max 20 runs/hour per task. Reject or defer beyond that.

### 2. Run a task safely

A task run calls the same agent loop with its saved prompt and a bounded tool set.

- **Test run** (`tasks.test` channel): perform no `write` or `external` actions — only read/analysis tools. No sends, no purchases, no filesystem writes. The run report states what it *would* have done.
- Normal run: use the same approval policy as chat. If an approval is needed during unattended work, wait up to 30 minutes, then fail the run with "nobody answered the approval" — do not silently approve.
- Prompt must include a **no-data / stale-data policy**: if the source is unavailable, report failure instead of reusing old data.
- Each run writes audit events with the task id.

### 3. Keep-awake and offline handling

- While a task is running, call `powerSaveBlocker.start('prevent-app-suspension')`; stop it when the run finishes or is cancelled. Never hold it indefinitely.
- Add a setting `keepAwakeForTasks: boolean` (default `true`) across all layers and a visible "WiskBot is keeping this PC awake" indicator event.
- If a run fails because the provider is unreachable/offline, leave the task enabled and retry with backoff; do not mark it permanently failed.
- Document in `README.md` that a fully sleeping PC runs nothing; waking it needs Windows OS settings, not an AI feature.

### 4. IPC and UI

- Add channels `tasks.list`, `tasks.create`, `tasks.update`, `tasks.delete`, `tasks.setEnabled`, `tasks.test`, `tasks.runs`, `tasks.cancel` (Zod-validated, sender-checked via `handle()`).
- Renderer: a Tasks view listing tasks, next run, enable/pause, run history with status/reason, Test and Cancel buttons.

### 5. Tests and GUI smoke

- Tests use the fake provider, a temporary DB and a fake clock — no sleeps. Cover: cron parse with timezone, one-shot, interval, overlap prevention, 12-hour catch-up, rate limits, test-run tool restriction, approval timeout, keep-awake start/stop pairing, offline retry.
- GUI smoke: create one one-shot task a minute out (or use Test), confirm run history, cancel a run, confirm keep-awake indicator appears and disappears.
- Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

## Report format

```
## Phase 6a report
- Task service/scheduler files
- Schedule kinds and cron/timezone validation
- Test-run restrictions and no-data policy evidence
- Approval timeout and audit evidence
- Keep-awake pairing + offline retry evidence
- IPC channels and Tasks UI
- Tests + npm test / typecheck / build results
- GUI smoke evidence
- Files changed / deviations / risks
```
