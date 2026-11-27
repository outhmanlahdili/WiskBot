# WiskBot

WiskBot is a free, open-source, BYOK, local-first Windows desktop AI assistant built with Electron, React, and TypeScript.

WiskBot is in **early development**. The chat agent, approval flow, local tools and a managed browser are implemented; memory, skills, scheduled tasks and desktop control are still planned. Expect rough edges and breaking changes.

## Principles

- **No WiskBot subscription** — the software is free and open-source (Apache-2.0).
- **Bring your own key (BYOK)** — you supply your own provider API key.
- **Keys stay on your device** — no WiskBot account, no WiskBot server, no telemetry.
- **Tools are permission-gated** — nothing acts on your behalf without your approval.

## Prerequisites

- Windows
- Node.js >= 22.12
- npm 11

## Getting started

```bash
npm install
npm run rebuild
npm run dev
```

`npm run rebuild` is required because `better-sqlite3` is a native module: its ABI must match the Electron runtime. Rebuild it again after changing the Electron version.

### Browser automation setup

The managed browser is an isolated Playwright Chromium profile at `%APPDATA%\WiskBot\browser-profile`. It never uses your own logged-in browser. Install the browser once during development:

```bash
npx playwright install chromium
```

WiskBot does not download browsers at runtime. Only HTTPS hosts you add in Settings → Managed browser domains are allowed. Page content is untrusted, and sensitive fields are always filled by you via **Take over**, never by the assistant.

### Windows desktop control

### Scheduled tasks and keep-awake

While a task runs, WiskBot can hold a Windows power-save blocker so the PC stays active (the screen may still sleep). Settings → Keep awake turns this off to save battery. **A fully sleeping PC runs nothing**: waking a PC requires Windows OS configuration such as wake timers, device wake or Wake-on-LAN, not an AI feature. Test runs perform no write or external actions, and if a data source is unavailable a task reports failure instead of reusing stale data.

Desktop control is Windows-only and disabled until you add exact window titles in Settings → Allowed desktop windows. It uses a fixed Windows UI Automation adapter (`resources/scripts/uia.ps1`) in an isolated utility process; there is no shell tool, no script execution from model input, and password/secret controls are refused. Use **Take over desktop** for sign-in, CAPTCHA or 2FA, and **Stop desktop** to interrupt an action immediately. Element names and window content are untrusted data, not instructions.

Other useful commands:

```bash
npm test
npm run typecheck
npm run build
```

Local data (including encrypted keys and the database) lives in `%APPDATA%\WiskBot\`.

## Documentation

Project documentation is in `docs/`:

- [PRODUCT](docs/PRODUCT.md)
- [ARCHITECTURE](docs/ARCHITECTURE.md)
- [TECH-STACK](docs/TECH-STACK.md)
- [ROADMAP](docs/ROADMAP.md)
- [PRELAUNCH](docs/PRELAUNCH.md)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately, never in public issues. See [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0. Copyright 2026 WiskBot contributors. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

WiskBot is **not affiliated with Meta**.
