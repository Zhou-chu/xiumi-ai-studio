# Isolated simulated deployment smoke verification

2026-11-14. This is a Pester-only simulated smoke subset, not a real application smoke test or a complete deployment suite pass. No production deployment script changed in this patch.

## Actual engine results

- Explicit Windows PowerShell 5.1.26100.9818: 1 passed, 0 failed, 2.39 s.
- Explicit resolved pwsh 7.6.9: 1 passed, 0 failed, 1.24 s.
- Both used `run-coverage.ps1 -SmokeOnly`, which selects only the smoke tag, requires exactly one passing case, and reports no coverage percentage.
- Process LOCALAPPDATA/TEMP/TMP/XIUMI_TEST_SANDBOX restored. Dynamic read-only real-state hashes matched before/after each run. This is not a fixed expected state hash: normal deployment may update it.

## Failures retained and resolved without weakening boundaries

1. Child invocation changed script scope, so script-scoped mock context was unavailable. A uniquely named worker-global context now restores its previous value in finally.
2. Stop-Process binds InputObject as Process[]. The guard requires exactly one element and reference identity with the unattached fake Process, not merely a matching PID.
3. Initial HTTP expectation of two calls was wrong: each of two Start-App calls requests /api/projects then /. Exact observed sequence is asserted, alongside total four calls and two per endpoint. This corrects test expectations, not product behavior.

All original path and process assertions remain: exact repository working directory; redirect and data paths within private TEMP; one GUID child root; hidden launch request; Start/Get/Stop counts 2/9/2; three mocked TCP listener creations. Child filesystem audit requires exactly two new files under its private root (state.json and data/preserve.txt), no state.tmp, and expected fake PID/release. No real process launch/stop, listener or HTTP request is used by the simulated child; the isolation wrapper does start test PowerShell worker processes.

## Reporting correction / remaining verification

An earlier invocation named coverage-smoke-only-ps5 actually used the default PS7 shell and failed; its name is not engine evidence. Likewise the earlier coverage-nonsmoke-explicit-ps5 result cannot establish a PS5 run. The explicit engine versions above are verified. Earlier independently executed PS5 NonSmoke evidence remains separate.

The combined complete suite has not been rerun after this patch. Real application smoke is not authorized by this result. No global Pester installation, Sonar issue state or product deployment state was modified.

## Subsequent explicit-engine complete isolated suite verification

After the subset results above, the approved complete wrapper suite was executed once per explicitly selected engine on the same product/test source (commit 3b80d96858b78966f7cf35947a85aeb18be80bbb):

| Engine | Result | Duration | AST command coverage |
| --- | --- | --- | --- |
| Windows PowerShell 5.1.26100.9818 (explicit powershell.exe) | 22 passed, 0 failed/skipped | 6.15 s | 211/215, 98.14% |
| PowerShell 7.6.9 (resolved pwsh.exe) | 22 passed, 0 failed/skipped | 5.19 s | 211/215, 98.14% |

Both reports contain `completeSuite=true`. Each run comprises 21 non-smoke cases and one Pester-mocked smoke case. This supersedes the earlier statement that the combined suite had not yet run, but does not establish a real application smoke result. Neither run directly invoked an independent real smoke/deployment process. Coverage is Pester's AST command metric for deploy/desktop.ps1 and deploy/install-desktop.ps1 only; it is not branch, function, line, strict-unit-only, or full-repository coverage.

The real deployment state was read only for dynamic SHA-256 comparisons. Its hash was identical before and after each run: FAEDF5B68778BA8FEAE588D23A92E6FED6BE7C1C549025EA2BAF9A16753FC195. This is observation evidence, not a hard-coded fixture expectation; normal CD had changed the deployment state since earlier subset checks. The tests wrote only within their isolated test roots/report directories. LOCALAPPDATA, TEMP, TMP and XIUMI_TEST_SANDBOX process values were restored; worker command-identity restoration checks passed. No recovery or state rewrite was performed.

Local generated report directories: coverage-complete-explicit-ps5 and coverage-complete-explicit-ps7. Generated reports are not committed. No additional test run or production-source change accompanies this documentation update.

## Integration verification on current fork main

Replayed without conflicts onto `c74f4db` in an independent feature branch. Explicit Windows PowerShell5.1.26100.9818 and pwsh7.6.9 each reran the complete isolated22-case suite and passed, retaining211/215 command coverage. Real deployment state hash was checked before, between and after and stayed unchanged; wrapper same-process environment restored in both engines. Four Cloud scope audit cases passed. No production JS/TS, desktop.ps1 or install-desktop.ps1 bytes changed. Remote CI and Cloud analysis must still run for this new feature SHA; no claim that these local results clear remote issues.
