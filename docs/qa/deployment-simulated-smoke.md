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
