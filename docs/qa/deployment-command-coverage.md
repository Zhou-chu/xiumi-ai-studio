# Deployment coverage (Windows PowerShell / Pester 3.4)

Run with the already-installed inbox module, no installation or registration:

```powershell
powershell.exe -NoProfile -File tests/deployment/run-coverage.ps1
```

The runner analyzes both complete production files, `deploy/desktop.ps1` and
`deploy/install-desktop.ps1`, without line/function exclusions. Pester 3.4 uses
AST command breakpoints. Its **command** coverage is not V8 statement, line,
branch or function coverage; those four metrics are **N/A** here and must not
be synthesized or blended into a purported four-metric repository percentage.
The strict runner requires more than 90% commands and zero failed tests.
Raw hit/missed commands and source SHA-256 identities are written to ignored
`coverage-deployment/coverage.json` and `summary.json`.

Verified: 20 tests pass; 211 / 215 commands = **98.14%**.
- desktop.ps1: 187 / 189 = 98.94%.
- install-desktop.ps1: 24 / 26 = 92.31%.
- Four deliberately uncovered commands: both live CLI invocation guards,
  WindowsIdentity lookup, and one environment-value restoration alternative.

Only minimal production testability seams were added: the main deployment
body is callable, its previous successful `exit 0` paths return from that
function; the unchanged CLI calls it when not in FunctionsOnly mode. The
installer likewise supports FunctionsOnly and a mockable current-user lookup.
Exceptions still propagate, and the lock's finally disposal remains intact.

Tests define fail-closed fake native/process/HTTP/task commands before loading
production functions. They mock process ownership/start/stop, HTTP, native
tools, TCP listener construction, scheduler and identity; only TestDrive/temp
state files and a temporary .NET lock are real. Tests cover wrong runtime,
CI identity/failure, ownership, atomic state, startup health/failure, lock,
pause/offline restore, fresh build, rollback/incomplete release, failed switch
recovery and installer refusal/least-privilege task specification. The existing
`deploy/test-desktop.ps1` also runs unchanged under fake OS/process/port/HTTP
boundaries; that is a contract regression, **not** a new live deployment smoke
or permission to invoke the actual installer. No app process was started or
stopped, no production port bound, no task registered and no network requested.

Pester 3 mock assertions explicitly use `-Scope It`; the initial failures from
its Describe-wide default call-count accumulation were corrected without
weakening expected operations. Original source is executed, not copied into
a separate implementation under test. No production data is used.
