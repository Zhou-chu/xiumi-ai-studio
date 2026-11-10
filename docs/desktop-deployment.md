# Windows desktop CI/CD

CI runs on GitHub-hosted Windows with Node 24 and pnpm 11.23.0. It checks
lint, types, unit/red-team tests, production build, deployment guards and
Chromium E2E. Screenshot updates are explicitly prohibited. Existing
baselines are Windows-specific; visual failures require human review.

## Security and isolation

The public repository is **not** given a self-hosted runner or desktop token.
The desktop polls public GitHub APIs every ten minutes and accepts only the
exact main SHA whose latest CI push run succeeded. API/rate-limit/network
failure leaves the running release untouched. Only trusted reviewed changes
should be merged to main: a successful CI result is not a security audit.

The app listens at http://127.0.0.1:5174 only. No firewall, DNS, nginx,
Cloudflare tunnel or Access policy is changed. Notebook remains untouched.
Remote access is deliberately NOT configured until the intended hostname and
email allowlist are verified and anonymous access is proven blocked.

## Installation (after CI and review)

Requirements: Git, Node 24, pnpm 11.23.0 available to the Windows user.
From the reviewed checkout run in PowerShell:

    powershell -NoProfile -File deploy/test-desktop.ps1
    powershell -NoProfile -File deploy/install-desktop.ps1

The scheduled task `XiumiStudio-CD` runs as the current logged-in user with
limited privileges, at logon and every ten minutes. It does not run before
login and cannot deploy while the computer is off. It copies a fixed local
control script; reinstalling/upgrading that script is a separate reviewed step.
Existing tasks are never overwritten. No execution-policy bypass is installed.
If local policy blocks scripts, do not relax it automatically.

Data: `%LOCALAPPDATA%\XiumiStudio\data` (outside immutable releases).
Releases: `%LOCALAPPDATA%\XiumiStudio\releases\<sha>`.
State: `state.json` holds the owned PID/start time and current/prior release.
Logs: `logs\<sha>-<port>.out.log` and `.err.log`.
Optional AI settings are entered in the local app and stored in its data;
no credentials are needed for this CD mechanism or stored in GitHub.

The deployer builds and checks a candidate, starts it against separate smoke
data on loopback port 5275, then switches only its own node process. A failed
production health check restarts the prior release. An occupied unowned port
causes failure rather than killing another app. Release/data directories are
never deleted automatically. Check available disk periodically.

## Operations

Run one poll manually:

    & "$env:LOCALAPPDATA\XiumiStudio\desktop.ps1"

Rollback to previous code and pause future updates:

    & "$env:LOCALAPPDATA\XiumiStudio\desktop.ps1" -Rollback

Resume updates: remove only `%LOCALAPPDATA%\XiumiStudio\paused`.
Disable automatic updates: disable `XiumiStudio-CD` in Task Scheduler.
Stopping the task does not stop the detached app process. Inspect state.json
and PID/start time before stopping the app. No generic `kill node` commands.

Rollback changes code, not user data. Back up the data directory with the app
stopped before any future incompatible data migration. Current app has no
migration mechanism. Do not automatically roll back across incompatible data
formats. Retained releases and smoke data can be cleaned up manually after
review; never delete the production data directory.

## Verification status

Windows deployment/install/rollback and full E2E must be executed on the final
combined commit before calling this deployment operational. These files alone
do not indicate that the scheduled task is installed or that a service is live.
