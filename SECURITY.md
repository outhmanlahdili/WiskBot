# Security Policy

WiskBot takes security and privacy seriously. This policy explains what is supported and how to report a vulnerability responsibly.

## Supported versions

**Only the latest release is supported** with security fixes. Please update to the newest version before reporting an issue; older releases are not maintained.

## Reporting a vulnerability

Report vulnerabilities via GitHub **private vulnerability reporting**: go to the repository's **Security** tab and choose **Report a vulnerability**.

**Do not report security vulnerabilities through public issues.** Public disclosure before a fix is available puts users at risk.

Please include in your report:

- **Summary** — what the vulnerability is
- **Affected version** — which release(s) are affected
- **Proof of concept** — steps or code demonstrating the issue
- **Impact** — what an attacker could do and who is affected

**If you think an API key may have leaked, rotate it at the provider immediately.** Do not wait for a fix and do not paste the key into a report.

## Privacy model

WiskBot has **no server and no account**. API keys stay on the user's machine and are never sent anywhere except to the provider the user configured. There is no WiskBot-hosted service that stores user data.

## Response times

The following are **targets, not guarantees**:

- We aim to **acknowledge** a report within **7 days**.
- For a confirmed **high-severity** issue, we target a **fix within 30 days**.

Complex issues may take longer; we will keep you informed through the private report thread.
