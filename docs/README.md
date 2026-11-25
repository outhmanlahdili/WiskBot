# WiskBot documentation

This folder is the shared source of truth for the two-session workflow.

| File | Purpose |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Vision, users, scope, non-goals |
| [PRELAUNCH.md](PRELAUNCH.md) | Repo, licensing, security features, Windows signing checklist |
| [RESEARCH.md](RESEARCH.md) | Verified findings, sources, open-source landscape |
| [TECH-STACK.md](TECH-STACK.md) | Validated technology choices and rejected alternatives |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Process model, modules, data flow, storage, permissions |
| [TOOL-CATALOG.md](TOOL-CATALOG.md) | Agent tools, risk levels, approval rules |
| [ROADMAP.md](ROADMAP.md) | Development phases and exit criteria |
| [DECISIONS.md](DECISIONS.md) | Architectural decision records |
| [PROMPTS/](PROMPTS/) | Implementation prompts handed to Session 2 (`01-foundation`, `01b-preload-fix-and-smoke-test`) |

## Rules for both sessions

1. Session 1 (Research & Architect) owns everything in `docs/`. Session 2 (Builder) owns source code and configuration.
2. Never edit the same file from both sessions at the same time. Hand off reports and prompts manually.
3. Session 2 must not assume a capability exists without evidence in its report.
4. If implementation reveals an architectural problem, Session 2 reports it; Session 1 updates the docs and sends the next prompt.
5. Research claims must carry a source URL and a verification date. Unverified claims must be labelled as such.
