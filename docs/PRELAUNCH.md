# Pre-launch setup checklist

Owner: Session 1 · Researched: 2026-11-25

This answers: "What should I do before starting?" Nothing here blocks Session 2 from coding, but items 1–7 should be done **before** the first implementation prompt so history and secrets are handled correctly from the start.

## Name and availability check (verified 2026-11-25)

- GitHub repository search for `wiskbot`: **0 results** (<https://api.github.com/search/repositories?q=wiskbot>).
- npm registry `wiskbot`: **404**, i.e. package name not taken.
- Web search for exact "WiskBot" returned no meaningful product match (only unrelated "out of the ark" noise).

Conclusion: the name appears free on GitHub and npm. This is not a trademark search; do a proper trademark check before public launch if that matters to you.

## Do now (before Session 2 starts)

1. **Initialize git locally.** Observed: `git 2.53.0.windows.1` is installed, but `gh` CLI is **not**. Run `git init`, set `user.name`/`user.email`, make an initial commit of `docs/`, and set the default branch to `main`. Use the GitHub web UI for repo creation, or install `gh` if you prefer CLI.
2. **Create a public GitHub repository named `wiskbot`.** GitHub docs: <https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository>. When importing an existing local folder, **do not** tick "Add a README", ".gitignore", or "license" during creation — that creates conflicts. Add those files locally instead.
3. **License is decided: Apache-2.0** (user-approved 2026-11-25, ADR-014). An OSI-approved licence is required for free OSS code signing from SignPath Foundation. Session 2 will create `LICENSE` + `NOTICE` in Phase 1 — they do not exist yet. Copyright notice: `Copyright 2026 WiskBot contributors` (no personal identifiers).
4. **Add a `.gitignore` before any install.** Must cover `node_modules/`, `out/`, `dist/`, `*.log`, `.env*`, `%APPDATA%` artifacts, `keys.enc`, `wiskbot.db*`, Playwright browser downloads, and `.DS_Store`/`Thumbs.db`. Session 2's prompt already asks for this.
5. **Enable free GitHub security features** (public repos): secret scanning and push protection, Dependabot alerts + security updates, CodeQL code scanning, and **private vulnerability reporting** with a structured form. Add `.github/dependabot.yml` (npm + GitHub Actions, weekly) and `.github/VULNERABILITY_REPORT.yml`. Standard hosted runners are free for public repos (<https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>). Defer branch protection until after the first release (user-approved). Do not publish a personal email; the Code of Conduct contact stays a placeholder until you supply a dedicated address.
6. **Commit after each phase.** Because both sessions share one working folder, Session 1 commits doc changes and Session 2 commits code changes as separate commits. Never edit the same file from both sessions simultaneously. Git history is your rollback point when a phase goes wrong.
7. **Write the README and privacy statement early.** WiskBot is BYOK with no telemetry by default; state that plainly. SignPath Foundation's OSS terms require a published code signing policy and privacy statement if you use their certificate later.

## Public vs private (verified 2026-11-25)

Per GitHub's Advanced Security availability table (<https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security>):

| Feature | Public, free | Private, free |
| --- | --- | --- |
| Secret scanning + push protection | Yes | **No** (needs paid GitHub Secret Protection) |
| Code scanning / CodeQL | Yes | **No** (needs paid GitHub Code Security) |
| Dependabot alerts, dependency graph | Yes | Yes |
| Standard hosted Actions runners | Free | $12/month included allowance on GitHub Free |

SignPath Foundation's OSS signing also requires a public repository with a verifiable build from that repo (<https://signpath.org/terms>).

**Recommendation: public from the start.** WiskBot is defined as free and open source, so there is no proprietary code to protect. The free secret-scanning/push protection is especially valuable for a BYOK app where accidental key commits would be damaging. If you prefer private during early development, you can create it private and flip it to public later (history is preserved) — but you lose those free safeguards until then, and you must switch before applying for OSS signing.

## Do not need upfront

- **No API keys required to begin.** BYOK means WiskBot has no provider account of its own. For early testing you can use local Ollama with no key, or a free provider tier. Ask the user to add keys only in the app's Settings screen.
- **No company, domain, or paid plan.** A personal GitHub account is enough for public repos, Actions, Dependabot, and secret scanning.
- **No code signing certificate yet.** That is a distribution concern, not a development one.

## Before the first public release (Phase 7, not now)

### Windows code signing — the main practical hurdle

- Electron's official guidance: Windows blocks/prevents unsigned apps, and since **June 2023 Microsoft requires an EV (extended validation) code signing certificate** for SmartScreen benefit; older OV/authenticode certificates no longer help. EV certificates require hardware tokens (or cloud signing). Source: <https://www.electronjs.org/docs/latest/tutorial/code-signing>.
- **Azure Artifact Signing** is described by Electron as the cheapest option and removes SmartScreen warnings, **but** Public Trust identity validation for **individual developers is limited to the United States and Canada**. Morocco is not in that list. Organizations have a wider country list (US, Canada, EU, UK, Australia, NZ, Japan, South Korea, Singapore, Switzerland, Norway, Israel), still not Morocco. Source: <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites>.
- **SignPath Foundation** offers free OSS code signing with no personal identification required: <https://signpath.org/>. Conditions (<https://signpath.org/terms>) include: OSI-approved license, no proprietary components, actively maintained and already released, MFA for all maintainers, a published "Code signing policy" page with privacy statement, manual approval of each release, verifiable builds from the public repo, and a "no hacking tools" clause. WiskBot's browser/desktop automation is ordinary automation, but confirm with SignPath that it is acceptable before relying on it.
- **Unverified:** whether a SignPath Foundation certificate removes Windows SmartScreen warnings. The certificate is issued to the Foundation, not an EV certificate in your name. Plan for continued SmartScreen warnings initially and document the manual "More info → Run anyway" path for early adopters.
- Practical plan: ship an unsigned portable build first for technical users, then apply to SignPath Foundation once the repo is public and a release exists; revisit EV/cloud signing if budget and eligibility allow.

### Also in Phase 7

- Run `npm audit`, commit a lockfile, and review dependency licences (Electron/Chromium and bundled runtime components have their own obligations).
- Test on a clean Windows VM without developer tools installed.
- Decide NSIS installer vs portable ZIP; add uninstall instructions (SignPath requires them if you use their certificate).
- Add SBOM/provenance if you can; it strengthens both supply-chain posture and OSS signing applications.

## Sources

All URLs are inline above. Verification date for every item: 2026-11-25. Unverified claims are labelled as such.
