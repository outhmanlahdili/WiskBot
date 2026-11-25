# Contributing to WiskBot

Thanks for your interest in WiskBot! Contributions of all kinds are welcome — bug reports, fixes, features, documentation, and feedback. WiskBot is free, open-source software under the Apache-2.0 licence, `Copyright 2026 WiskBot contributors`.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Windows** (WiskBot is Windows-first)
- **Node.js >= 22.12**
- **npm 11**

## Getting set up

```bash
npm install
npm run rebuild
npm run dev
```

`npm run rebuild` is **required**: WiskBot uses `better-sqlite3`, a native module whose ABI must match the Electron runtime. If you skip this step, the app may fail to start or crash when it opens the database. Re-run it after changing the Electron version or reinstalling dependencies.

## Before you open a pull request

```bash
npm test
npm run typecheck
npm run build
```

All three should pass. Tests are required for any change in behaviour — add new tests or update existing ones so the change is covered.

## Pull request guidelines

- **One concern per pull request.** Separate unrelated fixes and features into separate PRs; it makes review faster and safer.
- Fill in the [pull request template](.github/pull_request_template.md).
- Update the documentation in `docs/` when architecture changes. Documentation is currently maintained by Session 1: if you need docs changes, **raise them in your PR description rather than editing `docs/` unilaterally** so they can be coordinated.
- Keep commits focused and write clear commit messages.

### Developer Certificate of Origin (DCO)

**DCO 1.1 sign-off is REQUIRED on every commit.** Sign off your commits using:

```bash
git commit -s
```

This adds a `Signed-off-by` line certifying that you have the right to submit the contribution under the project's licence. **There is no Contributor License Agreement (CLA)** — no CLA needs to be signed.

## Privacy and secrets

**Never commit** API keys, tokens, real user data, or WiskBot's local `%APPDATA%` files such as `keys.enc` and `wiskbot.db*`. Do not include them in test fixtures, screenshot attachments, logs, or issue reports either. WiskBot keeps keys on the user's device, so leaking them is a serious privacy issue.

## Reporting security issues

**Do not report security vulnerabilities in public issues.** See [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability reporting (Security tab → Report a vulnerability).

## Licence

WiskBot is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 WiskBot contributors.
