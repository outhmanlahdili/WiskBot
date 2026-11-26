# Handoff 03b — Finish Phase 3 verification

Owner: Session 1 · Prepared: 2026-11-26 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 3 implementation was reviewed and is **nearly accepted**. Code, tests, typecheck and build are good; secret scan is clean. Two verification gaps remain. This is a **verification-only** task — no new features, no Phase 4.

1. The GUI smoke script never sent a `wiskbot.browser.screenshot.v1` chat message, so that tool was verified only by implementation and type checks.
2. The smoke flag `fill_run_done: false` was reported as a counting artifact (the DB confirmed `filled: true` and the assistant text appeared). Confirm with a clean run so evidence is unambiguous.

## What to do

1. Re-run the built app on Windows with the existing local fixture page and fake provider.
2. Send a chat message that asks the assistant to **take a screenshot** of the managed tab.
   - Approve the card.
   - Confirm the tool result contains a **local path** (not image bytes).
   - Confirm the file exists on disk and no image content entered the model context or console.
   - Confirm the run reaches `done`.
3. Repeat one `fill` flow and confirm the run reaches `done` with `filled: true` in both the UI result and the audit record.
4. Re-run `npm test`, `npm run typecheck`, `npm run build`.
5. Do not change behaviour unless a real bug appears. If you find one, fix only that bug and report it explicitly.
6. Commit locally. Do not push yet.

## Report format

```
## Phase 3b report
- screenshot_approval_seen: yes/no
- screenshot_path_returned: yes/no
- screenshot_file_exists: yes/no
- screenshot_bytes_in_model_context: yes/no
- screenshot_run_done: yes/no
- fill_run_done: yes/no
- fill_result_in_ui_and_audit: yes/no
- npm test / typecheck / build results
- Bugs fixed (if any)
```
