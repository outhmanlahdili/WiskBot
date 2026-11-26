# Handoff 04b — Fix approval scope and memory trust labels

Owner: Session 1 · Prepared: 2026-11-26 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 4 was reviewed. The implementation, tests and GUI evidence are strong, but two behaviour details are wrong. This is a **small fix + verification** task — no new features, no Phase 5.

1. **"Allow once" grants a session.** `ApprovalDecision` is `allow-once | allow-session | deny` (`src/shared/ipc.ts`). In `src/main/agent/runner.ts`, the approval handler currently calls `grantSession()` for any approval of `wiskbot.skill.invoke.v1`. That makes "Allow once" behave like "Allow for this session", which is a permission bug.
2. **User-created Settings memories are labelled untrusted.** `TRUSTED_SOURCES` in `src/main/memory.ts` only contains `chat`, so memories added through Settings (`source: 'settings'`) are shown as untrusted. Only imported/project data should be untrusted.

## What to do

1. In `src/main/agent/runner.ts`, change the skill grant condition so `grantSession()` is called **only** for `decision === 'allow-session'`. `allow-once` must grant exactly one call; the next invocation must ask again.
2. In `src/main/memory.ts`, add `settings` to `TRUSTED_SOURCES` (i.e. `new Set(['chat', 'settings'])`). Keep `imported` and `project` untrusted.
3. Update/extend `src/main/__tests__/phase4.test.ts`:
   - skill: `allow-once` → second invocation produces a new approval request; `allow-session` → second invocation reuses the grant;
   - memory: `source: 'settings'` is trusted; `source: 'imported'` is untrusted.
4. GUI smoke on Windows with the fake provider and temp DB:
   - add a memory from Settings → confirm it appears in the memory-context indicator **without** an untrusted label;
   - invoke the built-in skill, choose **Allow once** → invoke again → approval card appears again;
   - invoke again, choose **Allow for this session** → next invocation runs without a card.
5. Re-run `npm test`, `npm run typecheck`, `npm run build`.
6. Commit locally. Do not push yet.

## Report format

```
## Phase 4b report
- allow-once second invocation asks again: yes/no
- allow-session second invocation reuses grant: yes/no
- settings-source memory trusted: yes/no
- imported-source memory untrusted: yes/no
- npm test / typecheck / build results
- GUI smoke evidence
- Bugs fixed (if any)
```
