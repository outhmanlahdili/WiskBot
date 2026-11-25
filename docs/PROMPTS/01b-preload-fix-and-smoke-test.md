# Handoff 01b — Fix preload/sandbox and finish Phase 1 verification

Owner: Session 1 · Prepared: 2026-11-25 · Target: Session 2 (Builder)

Copy everything below the line into Session 2.

---

## Context

Session 1 reviewed your Phase 1 report. Most of the work is accepted: scaffold, security settings, SQLite/Drizzle, secure store, provider registry, licence/community files, i18n, tests, and the documented build/test results are good.

**One blocking bug and one related fragility must be fixed before Phase 1 is complete.** Do not start Phase 2.

### Blocking bug: sandboxed preload cannot be ESM

Verified from Electron docs:

- <https://www.electronjs.org/docs/latest/tutorial/esm>: "Sandboxed preload scripts can't use ESM imports."
- <https://www.electronjs.org/docs/latest/tutorial/sandbox>: sandboxed preload `require` can only load `electron`; no Node built-ins.

Your built `out/preload/index.mjs` starts with:

```js
import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
```

With `webPreferences.sandbox: true`, this is unsupported and the external `zod` import would also fail. A build passing `typecheck`/`build` does **not** prove the app launches.

### Accepted deviations (no action needed)

- Apache-2.0 used despite the old ROADMAP line — Session 1 has corrected `docs/ROADMAP.md`.
- electron-vite 6 / Vite 8 / Tailwind v4 — current versions are intentional.
- `@ai-sdk/anthropic` and `@ai-sdk/google` — approved; native adapters are necessary.
- `app.deleteLocalData` IPC channel — approved; documented in `ARCHITECTURE.md`.
- Empty default model IDs — correct per ADR-011; keep them empty.
- `[CODE_OF_CONDUCT_CONTACT — TO BE SUPPLIED]` — correct; do not invent an email.
- npm cache clear — acceptable; no project files removed.
- `npm audit` 10 moderate findings — deferred to Phase 7, as you proposed.

## Your task (fix + verify only)

1. **Make the preload CJS and self-contained.** In `electron.vite.config.ts`, configure the `preload` build to emit **CJS** and **bundle dependencies**, e.g.:

   ```ts
   preload: {
     build: {
       lib: { formats: ['cjs'] },
       externalizeDeps: false
     }
   }
   ```

   Keep the main process ESM (`"type": "module"`). Do **not** set `sandbox: false`. If electron-vite 6 emits an unexpected filename, update `preloadPath()` in `src/main/window.ts` to match the actual file — verify by listing `out/preload/` after a build, do not guess.

2. **If bundling Zod into preload is awkward**, the alternative is to remove Zod from `src/preload/index.ts` entirely and do event validation in main or renderer. Keep the preload as a thin `contextBridge` wrapper. Do not expose `ipcRenderer` or Node APIs.

3. **Rebuild and inspect the output:**

   - `npm run build`
   - Confirm `out/preload/` contains a CJS preload (no `import` statements, no external `zod` import).

4. **Run the real GUI smoke test** on Windows and capture evidence:

   - `npm run dev` (or run the built app) and watch the console.
   - Confirm **no Electron security warnings**.
   - Confirm the window opens and the renderer renders.
   - Confirm `window.wiskbot` is available and one IPC round-trip works (e.g. `settings.get`, then a settings update).
   - Confirm adding a provider with an invalid key returns a **redacted** error and never prints the key.
   - Confirm `keys.enc` is created and the DB migrations apply on a fresh profile.
   - Capture a short console excerpt or screenshot as evidence. If any check cannot be completed, say so explicitly.

5. **Re-run** `npm test`, `npm run typecheck`, `npm run build`. All must still pass.

6. **Commit locally.** Do not push yet — send the report first.

## Answers to your questions

- **CODEOWNERS:** replace `@OWNER` with `@outhmanlahdili`.
- **ROADMAP MIT line:** fixed by Session 1; use Apache-2.0.
- **`app.deleteLocalData`:** approved.
- **Extra adapters:** approved.
- **Default model IDs:** keep empty.
- **CoC placeholder:** correct.
- **GUI smoke test:** Session 2 must re-attempt after this fix; Session 1 will not launch the GUI.

## Report format

```
## Phase 1b report
- Preload output: exact filename + format evidence
- Sandbox / contextIsolation still enabled: yes/no
- GUI smoke test: pass/fail with console excerpt or screenshot
- IPC round-trip result
- Key redaction result
- npm test / typecheck / build results
- Files changed since Phase 1
- Remaining risks
```

Do not mark Phase 1 complete without launch evidence. Phase 2 starts only after this review.
