# Handoff 04 — Memory, preferences and skills

Owner: Session 1 · Prepared: 2026-11-26 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Phase 3 was reviewed and **accepted** (commits `b7b8ab0`, `ed676da`). Verified state:

- `src/main/tools/index.ts` holds `TOOL_META`, `ApprovalKind`, `toolNeedsApproval()` and `createTools()`.
- `src/main/agent/runner.ts` owns the agent loop, system instructions, `activeTools`, approvals and context compaction.
- `src/main/ipc.ts` + `src/shared/ipc.ts` hold typed IPC channels and the Zod `ChatEvent` union.
- `src/main/database/schema.ts` **already has** `memories` and `skills` tables (created in Phase 1) — reuse them, do not create new tables.
- Current tools: time, fs.list, fs.read, and five browser tools. No memory/skills tools yet.

Now implement **Phase 4 only**. Read `docs/ROADMAP.md` Phase 4, `docs/ARCHITECTURE.md`, `docs/TOOL-CATALOG.md`, and the current files above. Do not modify `docs/`. Do not start Phase 5. Do not push to GitHub yet.

## Your task

### 1. Memory service (main process)

Create `src/main/memory.ts` using the existing `memories` table (`id`, `kind`, `content`, `source`, `confidence`, `createdAt`, `updatedAt`, `enabled`).

- `saveMemory`, `listMemories`, `updateMemory`, `deleteMemory`, `setMemoryEnabled`.
- Validate all inputs with Zod. Cap content length (e.g. 4 KB) and number of memories (e.g. 200).
- Every write is audited via `writeAuditEvent(action, target, decision, detail)` from `src/main/audit.ts` (it redacts secrets in `detail`).

### 2. Memory tools and index injection

Add to `TOOL_META` / `ApprovalKind` / `toolNeedsApproval()` / `createTools()`:

- `wiskbot.memory.save.v1` — save a preference or fact. Risk `write`. Always ask. Record `source: 'chat'`.
- `wiskbot.memory.recall.v1` — search enabled memories. Risk `read`. Auto-approve, but cap results and output size.

Extend the `ApprovalKind` union in `src/main/tools/index.ts` with new kinds (e.g. `'memory-write'`, `'memory-read'`, `'skill-invoke'`) and handle them in `toolNeedsApproval()` — today the union only covers `none`, filesystem and browser modes.

In `src/main/agent/runner.ts`:

- `SYSTEM_INSTRUCTIONS` is currently a module-level constant. Change it to a function (e.g. `systemInstructions(tone)`) and build it per run so tone and memory index can be included. Do not mutate the constant.
- Inject only an **index** of enabled memories into the system instructions: id, kind, and a short content preview. Cap the index (e.g. 8 KB); the model calls `memory.recall` to read a full entry.
- Emit a `memory-context` event (add a Zod variant to `ChatEventSchema`) listing which memory ids/kinds were injected, so the UI can show "context shown to model".
- Keep the system instruction that tool results are untrusted data. Any memory with a `source` other than `chat` (e.g. imported/project memory) must be labelled **untrusted** in both the index and the recall result.

### 3. Preferences

Extend settings across all layers — `SettingsSchema` in `src/shared/ipc.ts` (it is `.strict()`), `DEFAULT_SETTINGS` / `load()` / `updateSettings()` in `src/main/settings.ts`, `settings.update` IPC, and `SettingsView.tsx` — with one new field:

- `tone: 'concise' | 'friendly' | 'formal'` (default `concise`).

Use `tone` in `SYSTEM_INSTRUCTIONS`. Do **not** add a second autonomy setting — `permissionDefaults` already covers that. Update all three i18n catalogs.

### 4. Skills (Markdown + manifest only)

Use the existing `skills` table (`id`, `name`, `version`, `path`, `manifestJson`, `enabled`, `requiredScopesJson`).

- Skill layout under `getUserDataDir()` from `src/main/paths.ts` — i.e. `%APPDATA%\WiskBot\skills\<id>\`: `SKILL.md` (instructions) + `manifest.json`. Use that helper instead of hard-coding the path.
- Manifest Zod schema: `name`, `version`, `description`, `whenToUse`, `requiredScopes: string[]` (tool names or risk levels), `maxSteps`. Validate on load; invalid skills are reported, never executed.
- Add IPC channels `skills.list` and `skills.setEnabled` (Zod-validated, sender-checked via the existing `handle()` helper in `src/main/ipc.ts`). Renderer can list/enable/disable skills in Settings.
- **Also update `PHASE_2_TOOLS` in `src/main/ipc.ts`** (rename it to something like `TOOL_DESCRIPTORS`) so `tools.list` includes the new memory/skill tools — otherwise the UI shows a stale tool list.
- Ship **one built-in example skill** (e.g. "Summarise a folder" using `fs.list` + `fs.read`) created on first run if no skills exist. Add an `ensureBuiltinSkill()` helper called after DB init; it writes the skill files under `getUserDataDir()` and inserts a disabled row. It must stay disabled until the user enables it.
- Add tool `wiskbot.skill.invoke.v1` — load the skill's `SKILL.md` and return its instructions as a tool result for the agent to follow. Risk `external`. There is **no general "granted scopes" map** in the code: use the existing `grantSession()` / `hasSessionGrant()` in `src/main/permissions.ts`. First use per skill requires approval; on approval, grant a session allowance with tool name `wiskbot.skill.invoke.v1` and the skill id as target. Later invocations reuse `hasSessionGrant()`. Also reject any `requiredScopes` entry not present in `TOOL_META` with a clear reason.
- **No scripts, no code execution, no arbitrary paths.** A skill is text instructions only.

### 5. Tests (deterministic, offline)

Use the existing fake provider and a temporary SQLite DB — never the real `%APPDATA%\WiskBot` profile.

Cover: save/recall round-trip; index size cap; untrusted labelling for imported memory; tone affects system instructions; invalid skill manifest rejected; skill scope denial; first-use approval; audit records.

Run `npm test`, `npm run typecheck`, `npm run build`. All pass.

### 6. GUI smoke test

Run the built app on Windows and capture evidence:

- Ask the assistant to save a memory; approve; confirm it appears in the memory list and can be recalled in chat.
- Confirm the `memory-context` indicator shows which memories were injected.
- Change tone in Settings; confirm it persists after restart.
- Enable the built-in skill; invoke it in chat with approval; confirm the instructions appear as a tool result and the run reaches `done`.
- Confirm no secret or full memory dump appears in console/logs.

Capture a short console excerpt or screenshot. If a check cannot be completed, say so explicitly.

## Security rules (non-negotiable)

- Keys stay in main; renderer sees only `hasKey`/masked hints.
- No raw `ipcRenderer` or Node API through `contextBridge`; validate IPC senders.
- Tool `execute` re-validates targets; all decisions audited.
- Memory and skill files are user data: treat imported content as untrusted prompt input.
- No code skills, no shell, no browser changes in this phase.
- Do not push to GitHub yet — report first.

## Report format

```
## Phase 4 report
- Memory service files/API
- Memory tools + index injection evidence (caps, untrusted labels)
- Preferences field and i18n changes
- Skill manifest schema, built-in skill, scope checks
- New IPC channels/events
- Tests added + npm test / typecheck / build results
- GUI smoke evidence
- Files changed
- Deviations from docs/ with reasons
- Remaining risks and questions
```
