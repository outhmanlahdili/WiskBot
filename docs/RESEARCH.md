# Research findings

Owner: Session 1 · Last verified: 2026-11-25

## Method and limitations

- The built-in `websearch` tool returned no results for all queries during this session. Research was therefore done by direct fetches of official documentation and the GitHub REST API.
- All figures below are **as observed on 2026-11-25** and can change. Star counts and versions are evidence of maturity, not proof of fitness.
- Where a claim could not be verified, it is explicitly labelled **unverified**.

## Meta Muse — verified findings and remaining caveat

**Verified (2026-11-25).** Muse is a real family of models served by the **Meta Model API**, not a desktop product:

- Official docs: <https://dev.meta.ai/docs/quickstart>, <https://dev.meta.ai/docs/models>, <https://dev.meta.ai/docs/computer-use>.
- Base URL `https://api.meta.ai/v1`, key from the Model API dashboard (`MODEL_API_KEY`). Compatible with the OpenAI Responses API, Chat Completions API, and Anthropic Messages API.
- Hosted models: **Muse Wonder** (`muse-wonder-1.0`, most capable, for long-horizon agentic work), **Muse Spark** (`muse-spark-1.3` recommended; also 1.2/1.1 and Contributor variants), **Muse Ember** (`muse-ember-1.0`, cheap execution model), Muse Image, Muse Voice Transcribe, SAM 3.1. Open-weight: Muse Spark Open (816B MoE / 42B active) and Muse Glimmer.
- The Vercel AI SDK documents a dedicated provider page for Meta Muse: <https://ai-sdk.dev/providers/openai-compatible-providers/meta>. Use `@ai-sdk/openai` with `createOpenAI({ baseURL, apiKey })` and `meta.responses('muse-...')` for the Responses API, or `@ai-sdk/openai-compatible` with `createOpenAICompatible({ name: 'meta', ... })` for Chat Completions.
- Responses API is recommended for tool-calling agents that need reasoning continuity across turns: set `forceReasoning: true` (Ember is not auto-detected as a reasoning model), `reasoningEffort`, `reasoningSummary: 'auto'`, `store: false`, and include `reasoning.encrypted_content`; retain `response.messages` across turns. Chat Completions supports function calling but does not preserve reasoning across turns.
- Verified geographic policy (<https://dev.meta.ai/legal/geographic-use-policy>, updated 2026-11-09): access is controlled by Meta per jurisdiction; Muse Wonder / Wonder Full are explicitly unavailable in South Korea; a list of Restricted Territories includes Western Sahara. Morocco is **not** listed in the Restricted Territories, but general availability is not guaranteed and can change. WiskBot must present Muse as "availability depends on your region" and must not encourage circumventing geographic controls.

**Computer use (verified, directly relevant to WiskBot Phase 5):** the Meta Model API exposes a native `computer` tool on the **Responses API only**. The model returns `computer_call` items with actions (`click`, `double_click`, `drag`, `keypress`, `move`, `scroll`, `type`, `screenshot`, `wait`) as pixel coordinates in the latest screenshot. The API defines the action protocol, **not** an environment: WiskBot must supply the environment, driver, screenshots, validation, logging, and safety decisions. Screenshots are base64 PNG/JPEG data URLs ≤25 MiB. `pending_safety_checks` must be reviewed by our harness/user and explicitly acknowledged — never auto-filled. The loop is bounded by a step budget, and the model can terminate with an "infeasible" message. `previous_response_id` chaining or stateless replay (≤29 call/output pairs) carries trajectory state.

**Important unverified point:** whether the AI SDK's tool abstraction can express Meta's native `{"type": "computer"}` tool is **not confirmed** by the pages fetched. Phase 5 must either use a direct Responses API adapter or a custom provider; do not assume `tool()` covers it. Until verified, WiskBot's browser and desktop automation remains our own Playwright/UI Automation driver layer, with Muse as one possible reasoning model behind it.

**Product caveat:** the user's phrase "inspired by Meta Muse" is now understood as inspiration from Muse's agentic model capabilities (tool use and computer use), not from a Muse desktop application. Do not claim WiskBot is affiliated with Meta.

## Similar projects and prior art (GitHub API, 2026-11-25)

| Project | Stars | License | Relevance |
| --- | ---: | --- | --- |
| [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) | 68,962 | Apache-2.0 | Long-running local agent project. Current description is a *coding agent for open models*, not a general desktop assistant — useful as a caution that scope drifts. |
| [trycua/cua](https://github.com/trycua/cua) | 32,921 | MIT | Open-source computer-use drivers, cross-OS sandboxes, benchmarks. Good reference architecture; too large to adopt wholesale. |
| [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) | 26,662 | Apache-2.0 | "Computer use CLI for AI agents" in Rust; repository topics are macOS-focused. Worth tracking, not a Windows-first dependency. |
| [screenpipe/screenpipe](https://github.com/screenpipe/screenpipe) | 22,546 | NOASSERTION | Local screen/work history capture and workflow discovery. Inspiration for background memory; license needs review before reuse. |
| [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha) | 15,558 | NOASSERTION | Electron + React + TypeScript local-first agent workbench with computer use and skills. Closest architectural analogue; license needs review before copying code. |
| [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | 13,048 | Apache-2.0 | Open-source computer-use agent with grounding/memory research. Reference for agent loop design. |
| [microsoft/fara](https://github.com/microsoft/fara) | 6,261 | MIT | Microsoft research computer-use models. Reference for model capabilities, not a runtime dependency. |
| [the-open-agent/openagent](https://github.com/the-open-agent/openagent) | 5,755 | Apache-2.0 | Personal assistant with computer-use, browser-use, coding agent, RAG. Closest product-level prior art. |
| [e2b-dev/open-computer-use](https://github.com/e2b-dev/open-computer-use) | — | — | Open-source LLMs plus E2B Desktop Sandbox; reference for isolated desktop execution. |

**Conclusion:** there is no small, mature, MIT/Apache-licensed "Muse-like Windows desktop assistant" that WiskBot can simply fork. The right move is a thin, purpose-built Electron app that borrows *patterns* (tool registry, approval gates, sandboxing, memory, audit log), not a large framework.

## Reliability reality check

Anthropic's 2024 computer-use announcement reported Claude 3.5 Sonnet at **14.9% on OSWorld (screenshot-only)** and **22.0% with more steps**, and explicitly described the capability as experimental, cumbersome, and error-prone, especially for scrolling, dragging, and zooming. Source: <https://www.anthropic.com/news/3-5-models-and-computer-use>.

Implication for WiskBot: prefer **structured browser automation (Playwright)** and **accessibility-tree desktop automation (Windows UI Automation)** over raw pixel clickers. Keep a human in the loop and never promise unattended reliability.

## Stack validation evidence

### Vercel AI SDK

- Official docs: <https://ai-sdk.dev/docs/introduction>, <https://ai-sdk.dev/docs/foundations/providers-and-models>, <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>, <https://ai-sdk.dev/docs/agents/building-agents>.
- Registry: `ai@7.0.181`, engines `node >=22`, Apache-2.0 (2026-11-25).
- Verified features we will use: `ToolLoopAgent`, `tool()` with Zod `inputSchema`, `toolApproval` (including `'user-approval'` and dynamic functions), `activeTools`, `stopWhen: isStepCount(n)`, `prepareStep` + `pruneMessages` for context compaction, `experimental_sandbox` as a *contract only*, tool lifecycle callbacks, `Output.object`.
- Verified caveat: manual approval completes the generation and returns `tool-approval-request` parts; the app must send a `tool-approval-response` and call the model again. Approval is a two-call flow.
- Verified caveat: passing an experimental sandbox does **not** sandbox the tool; isolation depends on the implementation. Do not treat a local working directory as a security boundary.
- Providers confirmed in official list include OpenAI, Anthropic, Google, Mistral, Groq, Cerebras, DeepSeek, Fireworks, Together, xAI; community providers include **OpenRouter** (`@openrouter/ai-sdk-provider`), **Ollama** (`ollama-ai-provider`), and Mem0. LM Studio is documented via the OpenAI-compatible provider.

### Electron / electron-vite

- electron-vite guide: <https://electron-vite.org/guide/> — v5.0.0, requires Node 20.19+/22.12+ and Vite 5+, with `main` / `preload` / `renderer` config sections. `npm create @quick-start/electron@latest` scaffolds a `react-ts` template.
- Registry: `electron@45.5.0`, engines `node >=22.12.0`.
- Local toolchain observed: Node v24.13.0, npm 11.8.0. Node 24 is a compatible superset for the above requirements; Session 2 should still verify each package's engine field during install.
- Electron security checklist (official): <https://www.electronjs.org/docs/latest/tutorial/security> — require `contextIsolation`, sandbox, no `nodeIntegration`, CSP, permission handlers, navigation/window restrictions, IPC sender validation, custom protocol instead of `file://`, current Electron version.
- `safeStorage` (official): <https://www.electronjs.org/docs/latest/api/safe-storage> — use the **async** API `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()`; sync API is deprecated and slated for removal in Electron 46. On Windows keys are protected by DPAPI: safe against other users, **not** against other apps running as the same user.
- Native modules (official): <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules> — native modules such as `better-sqlite3` must be rebuilt for Electron with `@electron/rebuild` because Electron's ABI differs from Node's.

### Database

- Drizzle SQLite docs: <https://orm.drizzle.team/docs/get-started-sqlite> — native drivers are `libsql`, `node:sqlite`, and `better-sqlite3`. Registry: `better-sqlite3@13.2.0`, engines `node >=22`.
- Decision: `better-sqlite3` + `drizzle-orm` + `@electron/rebuild` (mature, synchronous, local file). `node:sqlite` is a future option if Electron ships it reliably; `libsql` is an option if encrypted-at-rest or remote sync is needed later.

### Browser automation

- Playwright docs: <https://playwright.dev/docs/browser-contexts> — `browser.newContext()` gives isolated cookie/storage state; supports persistent profiles via `launchPersistentContext` (available in the Playwright API; verify signature during implementation). Browser automation should run in an isolated utility process.

### Desktop computer use

- Microsoft UI Automation: <https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32> — an accessibility framework providing programmatic access to most desktop UI elements and the ability to manipulate them. Designed for C/C++ COM and available to managed code via .NET.
- Implication: there is no first-class TypeScript binding in Electron. Plan a small Windows-side adapter (PowerShell/.NET bridge or a thin native helper) rather than adopting an unmaintained npm wrapper. Treat this as Phase 5, after browser automation.
- Electron `desktopCapturer` is available for screenshots (official API list). Screenshots of arbitrary windows are sensitive; require explicit approval.

### BYOK, free models, and local models

- AI SDK providers page (above) confirms both cloud and self-hosted routes.
- OpenRouter docs: <https://openrouter.ai/docs/guides/overview> and <https://openrouter.ai/docs/llms.txt> — standardised multi-provider API, documented free-model routing and BYOK endpoints. Do not hard-code a list of "free models"; availability and limits change — fetch from the provider's models endpoint and mark entries by observed price/capability.
- Ollama API docs: <https://docs.ollama.com/api> — local base URL `http://localhost:11434/api`, OpenAI-compatible `http://localhost:11434/v1`, Anthropic-compatible base `http://localhost:11434`; local requests need no API key. This makes local BYOK straightforward via the OpenAI-compatible provider.
- Groq is an official AI SDK provider and is commonly used as a free/cheap tier, but specific free quotas are not documented here. Treat any quota statement as unverified and show a "check provider" link in the UI instead.

### MCP

- Official intro: <https://modelcontextprotocol.io/docs/getting-started/intro> — open standard connecting AI apps to external tools/data; broad ecosystem support.
- Decision: adopt as an optional Phase 6 integration layer, not a Phase 1 dependency.

## Security research

- OWASP LLM Top 10 (2025): <https://genai.owasp.org/llm-top-10/> — includes Prompt Injection, Sensitive Information Disclosure, Supply Chain, Improper Output Handling, Excessive Agency, System Prompt Leakage, Unbounded Consumption.
- OWASP Agentic Top 10 (2026): <https://genai.owasp.org/top-10-for-agentic-applications-2026/> — ASI01 Goal Hijack, ASI02 Tool Misuse, ASI03 Identity/Privilege Abuse, ASI04 Supply Chain, ASI05 Unexpected Code Execution, ASI06 Memory/Context Poisoning, ASI07 Inter-Agent Communication, ASI08 Cascading Failures, ASI09 Human-Agent Trust Exploitation, ASI10 Rogue Agents.
- ASI02 detail page: <https://genai.owasp.org/agentic-applications-2026/asi02-tool-misuse-and-exploitation/> — recommends least privilege per tool, action-level approval, sandboxes and egress allowlists, a policy enforcement point that treats model output as untrusted, adaptive budgets, immutable logs, and fully qualified tool names to avoid typosquatting. These recommendations map directly to WiskBot's permission engine.
- Practical consequence: every web page, PDF, email, screenshot, skill file, and MCP tool description is **untrusted input**. Only the main process may execute tools; the renderer only renders and requests approval.

## Open-source strategy and licensing (researched 2026-11-25)

### Is open source the right strategy?

**Yes, with caveats.** Evidence:

- The Open Source Guides define open source as freedom to use, study, modify, and distribute for any purpose, and explicitly note that **free ≠ free of charge**; "most open source projects are free, but 'free of charge' is not part of the open source definition" (<https://opensource.guide/starting-a-project/>). The OSI Open Source Definition likewise requires free redistribution (clause 1) and forbids discrimination against fields of endeavour (clause 6) (<https://opensource.org/osd>). This means a non-commercial restriction would make WiskBot *not* open source.
- The same guides list the core benefits as collaboration, adoption/remixing, and transparency — transparency being especially relevant to security software (<https://opensource.guide/starting-a-project/>). For an app that stores API keys and drives a desktop, inspectability is a trust feature.
- The guides also warn that maintainers must expect non-coding work: issue triage, code review, documentation, and community management, and that "most projects only have one or two maintainers who do most of the work" (<https://opensource.guide/building-community/>). This is the main long-term cost for a solo developer.
- Licence changes are cheap now and expensive later: once external contributions exist, relicensing generally requires agreement from all copyright holders. Decide before accepting the first PR.

### Advantages

- Global adoption and lower trust barrier for users in Morocco and worldwide.
- External contributions for providers, skills, translations, and bug fixes.
- Auditability of permission/approval logic and secret handling.
- Free OSS code-signing eligibility via SignPath Foundation (OSI-approved licence + public repo required — `PRELAUNCH.md`).
- No vendor lock-in for users; aligns with BYOK and local models.

### Disadvantages and risks

- **Free-riding:** permissive licences allow others to ship closed, paid forks. This is inherent to MIT/Apache and is the price of maximum adoption.
- **Support burden:** public issue queues fill with environment-specific Windows/hardware problems; documentation and triage become ongoing work.
- **Security exposure:** attackers can read the code and find vulnerabilities; mitigate with private vulnerability reporting and secret scanning, not obscurity.
- **Supply-chain obligations:** third-party components (Electron, React, AI SDK, native modules) have their own licences and notices; Apache-2.0 requires preserving notices and a `NOTICE` file.
- **Trademark:** copyright licences do not grant rights to the WiskBot name or logo (Apache-2.0 §6 explicitly excludes trademark use); a separate trademark policy is advisable.
- **Community risk:** uncoordinated or low-quality contributions (including AI-generated patches) can overwhelm a solo maintainer; scope and review rules must be explicit.
- **SignPath's "no hacking tools" clause** could affect a desktop-automation app; ask before relying on free signing.

### Licence comparison (verified from licence texts, 2026-11-25)

| Licence | Type | Key conditions | Patent grant | Forks may be closed? | Fit for WiskBot |
| --- | --- | --- | --- | --- | --- |
| [MIT](https://choosealicense.com/licenses/mit/) | Permissive | Preserve copyright + licence notice | **No explicit grant** | Yes | Simple, maximal adoption; weakest patent protection |
| [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/) | Permissive | Notice, licence copy, state changes, `NOTICE` file; no trademark grant | **Yes, express** (§3), with litigation termination | Yes | Best balance: adoption + patent protection for an AI/tool ecosystem |
| [GPLv3](https://choosealicense.com/licenses/gpl-3.0/) | Strong copyleft | Disclose Corresponding Source, same licence, state changes | Yes (§11) | No — derivatives must stay GPLv3 | Keeps forks free but adds distribution complexity and may deter corporate contributors |
| [AGPLv3](https://choosealicense.com/licenses/agpl-3.0/) | Strong copyleft + network clause | GPLv3 terms plus source offer to remote users (§13) | Yes | No | Designed for network services; WiskBot is local-first with no server, so the main benefit does not apply |
| [MPL-2.0](https://choosealicense.com/licenses/mpl-2.0/) | Weak/file-level copyleft | Modified MPL files stay MPL; larger work may be other terms | Yes (§2.1(b)) | Partially | Middle ground, but file-level accounting is awkward for a cohesive app |
| Source-available / "fair-code" | Not OSI | e.g. n8n's Sustainable Use License restricts commercial use and hosting | Varies | No | Conflicts with "fully open-source" and SignPath eligibility |

Important corrections to common assumptions:

- **GPLv3 does not stop commercial sale.** The licence text says "you may charge any price or no price for each copy that you convey". It keeps *derivatives* under GPLv3, not *prices* at zero.
- **GPLv3's distribution burden is real.** "Corresponding Source" includes source for dynamically linked subprograms the work is specifically designed to require (§1), and §6 "User Product" installation-information rules exist for locked-down consumer devices. WiskBot's separate software distribution is unlikely to hit the locked-device case, but this is a legal question worth counsel review if GPLv3 is chosen.
- **AGPLv3's network clause is about servers.** For a local desktop app with no hosted service, it adds obligations without solving a WiskBot problem.
- **MIT has no explicit patent licence.** In an AI/tools space where patent assertions are plausible, Apache-2.0's express contributor patent grant is a meaningful advantage.
- **None of these licences prevent paid support, hosting, or dual licensing** if you own the copyright.

### What comparable projects actually use (GitHub API, 2026-11-25)

| Project | Stars | Licence | Sustainability observation |
| --- | ---: | --- | --- |
| [n8n-io/n8n](https://github.com/n8n-io/n8n) | 212,125 | NOASSERTION — "Sustainable Use License" | Source-available with commercial restrictions; large adoption but not OSI open source |
| [microsoft/vscode](https://github.com/microsoft/vscode) | 195,781 | MIT | MIT core with a separately distributed commercial product from the same vendor |
| [ollama/ollama](https://github.com/ollama/ollama) | 188,120 | MIT | Permissive core, company-backed project |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | 149,990 | MIT | Permissive core, company-backed; DCO sign-off enforced (`web_commit_signoff_required: true`) |
| [home-assistant/core](https://github.com/home-assistant/core) | 92,530 | Apache-2.0 | Permissive core; the same team sells optional cloud/hardware/services |
| [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) | 68,962 | Apache-2.0 | Permissive licence for a local-agent tool |
| [signalapp/Signal-Desktop](https://github.com/signalapp/Signal-Desktop) | 16,735 | AGPL-3.0 | Strong copyleft where network-service concerns exist |

Pattern: **successful desktop/AI tools overwhelmingly use MIT or Apache-2.0 for the core**, and fund development through a company, optional services, or donations — not through copyleft. The strongest-copyleft example (Signal) has a network-service dimension WiskBot does not have. The largest source-available example (n8n) shows that restrictions are possible but make the project non-OSI and ineligible for some OSS programmes.

### Sustainability models that fit WiskBot

- **GitHub Sponsors** lets individuals/organizations fund open-source work directly; setup requires 2FA, bank/tax details, and a sponsorship profile, with an option to use a fiscal host (<https://docs.github.com/en/sponsors>). Lowest-friction starting point.
- **Optional services around the free core**, exemplified by Nabu Casa for Home Assistant: paid remote access, hardware, and support, with "no VC money... your purchases alone fund our work" and "the majority of our profit goes to the foundation" (<https://www.nabucasa.com/>). This works only if the optional service does not betray local-first/privacy promises — e.g. paid support, not mandatory telemetry.
- **Company backing / dual licensing later**, possible with MIT/Apache only while you own all contributions. If you accept DCO sign-offs instead of a CLA, you keep contributor rights simple but make later proprietary relicensing harder; a CLA preserves that option at the cost of contributor friction.
- **Foundations/donations** for long-term stewardship; worth considering only if the project gains a real community.
- **Avoid:** selling user data, default telemetry, or putting core features behind a paywall — all contradict `PRODUCT.md`.

### Governance, contributions, and security practice

- Minimum launch files per Open Source Guides: `LICENSE`, `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, clean history with no secrets, and at least two admins (<https://opensource.guide/starting-a-project/>).
- `CONTRIBUTING.md` is surfaced by GitHub on PRs/issues; include setup, tests, issue/PR templates, and behavioural expectations (<https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors>).
- Developer Certificate of Origin 1.1 is a lightweight sign-off that the contributor has the right to submit the code (<https://developercertificate.org/>). LangChain enforces it via GitHub. A CLA is the heavier alternative that also enables future relicensing.
- Contributor Covenant 2.1 provides a ready-made code of conduct with an enforcement ladder (correction → warning → temporary ban → permanent ban) and a placeholder for a private reporting contact (<https://www.contributor-covenant.org/version/2/1/code_of_conduct/>).
- Use GitHub **private vulnerability reporting** for public repos so researchers do not disclose in public issues; customise the form with summary/PoC/impact and optionally require a CWE (<https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository>). Open Source Guides note security issues are a legitimate exception to public-by-default communication.
- Dependencies: keep a lockfile, run `npm audit`, enable Dependabot, generate an SBOM/licence inventory, and copy upstream notices into `NOTICE`/third-party credits. GitHub secret scanning + push protection are free for public repos (`PRELAUNCH.md`).
- Governance: write a small `GOVERNANCE.md` naming the tiebreaker (initially the project owner), how decisions are made, and how contributors graduate to maintainers; the Open Source Guides recommend defining this before a conflict occurs.

### Recommendation (user-approved 2026-11-25)

- **Strategy:** proceed fully open source.
- **Licence:** **Apache-2.0** (approved). MIT was the fallback; GPLv3/AGPLv3 were rejected for this product shape, MPL-2.0 for unnecessary complexity, and source-available licences because they contradict the stated goal and block OSS signing.
- **Contributions:** DCO 1.1 sign-off only, no CLA (accepted trade-off: future proprietary relicensing needs contributor agreement).
- **Community files:** `CONTRIBUTING.md`, Contributor Covenant 2.1 `CODE_OF_CONDUCT.md`, `SECURITY.md`, `TRADEMARKS.md`, `NOTICE`, `.github/` templates, Dependabot config. Security response times are **targets**, not guarantees.
- **Copyright notice:** `Copyright 2026 WiskBot contributors`; no personal legal name or email published without explicit approval.
- **Implementation status:** these files are **planned but not created**; Session 2 will create them in Phase 1 per `PROMPTS/01-foundation.md`.
- **Sequence:** create `LICENSE` + `NOTICE` → `CONTRIBUTING`/`CODE_OF_CONDUCT`/`SECURITY`/`TRADEMARKS` → enable GitHub settings → then accept first external PR.
