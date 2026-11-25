# WiskBot — product definition

Status: draft v1 · Owner: Session 1 · Last updated: 2026-11-25

## Vision

WiskBot is a **free, open-source, local-first desktop personal AI assistant** for Windows. It is inspired primarily by the idea of an assistant that can actually *do* work in a browser and on a computer, not just answer questions. Meta's Muse models are a verified example of models with tool use and a computer-use protocol; WiskBot is **not affiliated with Meta** and implements its own automation driver. Users bring their own AI provider credentials (BYOK), so there is no WiskBot subscription and no mandatory paid AI plan.

Morocco is the initial market; the product is designed for a global audience from day one.

## Product principles

1. **Free and open source.** No paywall in the app, no mandatory paid AI subscription.
2. **BYOK and provider freedom.** API keys belong to the user, stay on the user's machine, and are sent only to the provider the user selected.
3. **Local-first.** Conversations, memory, preferences, skills, and audit logs live on disk. The app must be usable with a local model and no internet connection where possible.
4. **User control over agency.** The assistant never acts silently on high-impact actions. Permissions are explicit, granular, revocable, and auditable.
5. **Safe by default.** Least privilege, allowlists, approval gates, and no arbitrary shell access in the MVP.
6. **Honest capability.** Computer use is imperfect. The UI must set correct expectations and surface failures instead of hiding them.
7. **International by design.** English, French, and Arabic (Latin and Arabic script) are the first target locales; no hard-coded English-only strings in the UI.

## Target users

- **Primary:** a technically comfortable individual in Morocco or worldwide who already has (or is willing to create) an AI API key, uses Windows daily, and wants an assistant that can operate a browser and local files.
- **Secondary:** users with no paid API plan who want a usable assistant through free provider tiers or a locally running model (Ollama / LM Studio).
- **Explicitly not targeted at first:** enterprises, children, shared/kiosk machines, and users who need guaranteed unattended autonomy.

## Capabilities

### In the first release

- Chat with streaming responses from multiple providers/models.
- Provider settings with secure key storage and a connection test.
- Conversation history persisted locally.
- Permission prompts and an audit log for tool calls.

### Progressive capabilities (see ROADMAP.md)

- Personal memory and preferences (explicitly save/recall, user-editable).
- Filesystem tools within user-configured allowlisted folders.
- Browser automation in a dedicated browser profile with domain allowlists.
- Reusable skills (local, versioned, permission-scoped).
- Windows desktop computer use via UI Automation, with screenshot verification.
- Background/scheduled tasks with visible run history and cancellation.
- Optional MCP integrations.

## Non-goals

- A hosted WiskBot cloud service or account system in the MVP.
- Automatic trading, payments, account deletion, or other irreversible high-impact actions without confirmation.
- General-purpose arbitrary shell/PowerShell execution, registry editing, or malware-like behaviour.
- Training models on user data.
- Claiming human-level reliability for screenshot-only computer use.
- Supporting macOS/Linux in the first release (architecture should not block them later).

## Definition of done for the MVP

A user can: install the Windows app; add a key (or connect a local model); chat; run a safe tool with an approval prompt; inspect the audit log; delete their data; and do all of this without paying WiskBot anything.

## Open-source strategy (approved 2026-11-25)

**Conclusion: open source is a strong fit for WiskBot.** Full evidence and sources are in `RESEARCH.md`; decision records are in `DECISIONS.md`.

Why it fits:

- **Trust:** the app holds API keys and can drive a browser and desktop. Users need to inspect exactly what it does. Source visibility is a product feature, not just a licence choice.
- **No subscription to protect:** BYOK means there is no paid tier to defend with closed code.
- **Adoption:** permissive terms lower friction for users and for contributors adding providers, skills, and integrations.
- **Transparency and community:** local skills, provider adapters, and audit tooling are the kind of extensions a community can own without core-team bottlenecks.
- **Practical benefit:** SignPath Foundation's free OSS code signing requires an OSI-approved licence and a public repo (see `PRELAUNCH.md`).

Important nuance: **"free" in open source means freedom, not price.** No OSI-approved licence prevents someone else from selling the software or offering paid support. If the real requirement is "nobody may monetise it", that is not open source; it would need a non-commercial / source-available licence, which would conflict with the goals above and with OSS signing.

**Licence decision (user-approved):** **Apache-2.0**. MIT, GPLv3, AGPLv3, MPL-2.0, and source-available licences were evaluated and rejected for these goals; rationale and sources are in `RESEARCH.md`. Contributions use DCO 1.1 sign-off with no CLA. The copyright notice is `Copyright 2026 WiskBot contributors` — no personal legal name or email is published (ADR-031/032).

**Implementation status:** the licence is approved but **`LICENSE`, `NOTICE`, and other repository files have not been created yet.** Session 2 is instructed to create them in Phase 1 (see `PROMPTS/01-foundation.md`). No application code has been changed.

## Open questions for the user (not blockers)

1. Should the first public release include browser automation, or ship chat + files first? Current plan: chat + safe files first, browser next.
2. ~~Licence~~ **Resolved: Apache-2.0** (user-approved 2026-11-25; ADR-014). Files not yet created.
3. Should skills be Markdown-only initially, or allow TypeScript modules? Current recommendation: Markdown + JSON manifest first.
4. Distribution: portable ZIP vs NSIS installer first? Current recommendation: NSIS after signing is available.
5. ~~Contribution model~~ **Resolved: DCO 1.1 only, no CLA** (user-approved; ADR-025). A CLA would be needed if commercial dual licensing is ever wanted.
6. **Contact details still needed from you:** a dedicated Code of Conduct enforcement address. It remains a placeholder in the docs; your personal email will not be published without explicit approval.
