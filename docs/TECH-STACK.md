# Technology stack

Owner: Session 1 · Status: validated proposal · Last updated: 2026-11-25

Versions below were observed on 2026-11-25. Session 2 should install current compatible versions and record the resolved versions in `package.json`; exact pins are not mandated here.

## Chosen stack

| Layer | Choice | Why | Primary risk / mitigation |
| --- | --- | --- | --- |
| Desktop shell | **Electron 45.x + electron-vite 5.x** | Windows-first, filesystem access, mature docs, `react-ts` template; electron-vite handles main/preload/renderer cleanly | Large binary and security surface → follow Electron security checklist, keep releases current |
| Language | **TypeScript (strict)** | Shared types across IPC, tools, provider config | Build complexity → keep `tsconfig` strict but simple |
| UI | **React + Tailwind CSS + shadcn/ui** | Fast iteration, accessible primitives, good fit with electron-vite renderer | shadcn/ui adds files to the repo (not a black-box dependency) → acceptable |
| Icons / validation | **lucide-react + Zod** | Consistent icons; one schema system for config, tool inputs, IPC payloads | Zod version must match AI SDK peer range (`^3.25.76 \|\| ^4.1.8` observed) |
| AI | **Vercel AI SDK 7.x** (`ai` + provider packages) | One interface for many providers, built-in tool calling, approvals, loop control, compaction | Rapid release cadence → pin versions, read changelog on upgrade |
| Cloud providers | OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, **OpenRouter** (community adapter), **Meta Model API (Muse)** | Coverage of paid and free tiers through one API; Muse is the named inspiration and a real BYOK provider | Provider quirks → capability flags and a connection test per provider; Muse regional availability → show an availability note |
| Local models | **Ollama** (`ollama-ai-provider` or OpenAI-compatible) and **LM Studio** (OpenAI-compatible) | No API key needed locally; privacy-friendly | Hardware limits → show model size/VRAM hints, never pretend local equals frontier quality |
| Browser automation | **Playwright** in an isolated utility process | Mature, deterministic, supports isolated contexts and persistent profiles | Browser binaries are large → document install step; domain allowlist required |
| Desktop control | **Windows UI Automation** via a thin adapter; screenshots via Electron `desktopCapturer` | Accessibility tree is more reliable than pixels; official Windows framework | No native TS binding → small adapter, Phase 5 only, explicit approval |
| Persistence | **SQLite + Drizzle ORM** with `better-sqlite3`, rebuilt via `@electron/rebuild` | Local-first, typed schema, migrations, synchronous access in main process | Native ABI mismatch → add rebuild step to install/build scripts and CI |
| Secret storage | **Electron `safeStorage` async API** | OS-backed encryption (DPAPI on Windows) | Same-user processes can still decrypt → never render keys in the UI, never send them to the renderer |
| Testing | **Vitest** (unit) + Playwright test utilities where useful | Single toolchain with Vite | Native module in tests → rebuild before test run or mock the DB boundary |
| Integrations | **MCP SDK (Phase 6)** | Open standard, large ecosystem | Untrusted tool descriptions → treat as input, pin names/versions, approval required |
| i18n | Lightweight key-based JSON catalogs (English, French, Arabic) | Morocco + global audience | RTL Arabic → use CSS logical properties from the start |

## Rejected / deferred alternatives

| Option | Reason |
| --- | --- |
| Web app / PWA | Cannot do reliable local filesystem and desktop control; conflicts with local-first goal |
| Tauri | Smaller binaries, but Rust adapter work and fewer ready-made examples for computer use; revisit after MVP if bundle size matters |
| Python backend bundled with Electron | Two runtimes, painful packaging, more supply-chain surface |
| LangChain / heavy agent frameworks | AI SDK already covers our needs; extra abstraction obscures approval and loop control |
| Screenshot-only computer use as the primary interface | Low reliability (see RESEARCH.md); use Playwright and UI Automation first |
| Local HTTP server + `useChat` for UI streaming | Adds network attack surface and an unnecessary server in a desktop app; stream via IPC instead |
| Storing API keys in `localStorage` / plain JSON | Unacceptable exposure; use `safeStorage` |
| `node:sqlite` today | Experimental availability inside Electron is not verified for our target; revisit after MVP |
| Arbitrary shell/PowerShell tool in MVP | Maps directly to OWASP ASI05/ASI02; defer until a real isolation boundary exists |

## Environment notes for Session 2

- Observed local toolchain: Node **v24.13.0**, npm **11.8.0**.
- `ai@7.0.181` requires Node >=22; `electron@45.5.0` requires Node >=22.12; electron-vite 5 requires Node 20.19+/22.12+. Node 24 satisfies all of these.
- Because `ai` is ESM-only, keep the main process build output as ESM (`"type": "module"` in `package.json`) unless electron-vite config proves otherwise.
- Add `@electron/rebuild` to `devDependencies` and make it part of `postinstall` or an explicit script used before `dev` and packaging.
- Install `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, **`@ai-sdk/anthropic` and `@ai-sdk/google`** (approved 2026-11-25 during Phase 1 review — Anthropic and Google are not OpenAI-compatible, so native adapters are required for their connection tests). The OpenAI-compatible package covers LM Studio, custom endpoints, and Muse Chat Completions; `@ai-sdk/openai` covers Muse's Responses API with reasoning continuity. See <https://ai-sdk.dev/providers/openai-compatible-providers> and <https://ai-sdk.dev/providers/openai-compatible-providers/meta>.
- **Sandbox constraint discovered in Phase 1 review:** Electron does not support ESM imports in sandboxed preload scripts, and preload `require` can only load `electron` (<https://www.electronjs.org/docs/latest/tutorial/esm>, <https://www.electronjs.org/docs/latest/tutorial/sandbox>). Therefore the preload bundle must be emitted as **CJS with dependencies bundled** (`build.lib.formats: ['cjs']`, `build.externalizeDeps: false`), even though the main process stays ESM via `"type": "module"`. Do not disable `sandbox` to work around this.

## Patterns adopted from the 2026-11-26 product study

These are **behavioural rules**, not new dependencies. Evidence is in `RESEARCH.md`.

- **Structured connectors before browser clicks.** Grok Bot and DuskBot both prefer connected apps/MCP over clicking a website when a structured tool exists. WiskBot keeps MCP in Phase 6 and browser clicks in Phase 3, but the agent should prefer a structured tool when one is available.
- **Secrets never enter model context.** Grok Bot's Vault/Secure Form, DuskBot's vault and AppuBot's vault all inject credentials around the model. WiskBot's `safeStorage` store follows the same rule: renderer and model see only `hasKey`/masked hints.
- **Read-only within own folders does not prompt.** DuskBot auto-allows reading a bot's own files. Our Phase 2 tools already do this; keep it.
- **Approval cards must show target, scope and values**, and chat-initiated approvals should not expire on a timer (Grok Bot). Background approvals may expire.
- **Memory is an index with on-demand reads**, user-editable, and imported/project memory is untrusted (Muse Code). Our Phase 4 memory design must follow this.
- **Routines need safe test runs** that send nothing, a no-data/stale-data policy, catch-up limits, rate limits and run history (Grok Bot, DuskBot).
- **Live activity and hard stop.** Show each agent step, allow visual takeover for sensitive steps, and provide an immediate stop control (DuskBot, AppuBot, Grok Bot).
- **Not adopted:** cloud-only execution, subscription gating, Full-access defaults, source-available licences, arbitrary shell in early phases, CLA, and ACP as the core protocol.
