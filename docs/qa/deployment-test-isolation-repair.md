# Deployment-test isolation repair: verified scope and remaining gate

The original Pester refactor incorrectly let a dot-sourced Root shadow the test Root. At 2026-11-14 07:55 UTC a fixture overwrote the real deployment control state. This is an incident, not a successful recovery. Production state has not been reconstructed. Its unknown previous-release metadata remains a user decision; no test may invent it.

## Isolation layers

- Each parent run creates a new private GUID directory and sets process-local LOCALAPPDATA, TEMP, TMP and XIUMI_TEST_SANDBOX for a same-engine worker. The parent restores its original environment in finally.
- The worker rejects missing or mismatched private environment. Paths are normalized, require separator-aware containment and reject existing reparse-point ancestors.
- Production scripts load only through FunctionsOnly with explicit private Root. Actual Save-State bodies run behind a checked local Root rather than relying on script-scope variable resolution.
- Pester OS/network commands default to throwing mocks, with exact call assertions. TCP listener construction is also denied unless a specific case provides an in-memory substitute. No global security settings or installed framework files were changed.
- Temporary evidence is retained. This is defensive test infrastructure, not an OS-enforced filesystem sandbox or proof against arbitrary future unsafe test code.

## Actual verification

1. IsolationOnly passed in PS5 and PS7. Same-process before/after checks confirmed environment restoration.
2. StateWriteProof captured the real production Save-State body in a different private decoy scope. Both engines wrote only approved/state.json, removed state.tmp, left the decoy empty and rejected a private sibling before invoking its body.
3. BoundaryOnly: 3/3 in both engines. Five dangerous commands invoked through a same-worker child script hit the expected mocks with exact counts. The actual state-writing body was routed through the checked Pester mock. Command identities were restored after Pester.
4. NonSmokeOnly: 21/21 in PS5 and PS7. Pester command coverage is 211/215 (98.14%) across the two existing deployment source files. It is not line/branch/function coverage and not proof that the excluded smoke suite ran.
5. The real incident-state file was only hashed before and after these approved synthetic checks; its hash was unchanged. No actual application process, task registration, live HTTP request or deployment was performed by these tests.

## PS7 assertion compatibility

An intermediate PS7 run had 11 failing cases even though production functions threw. A single-function control reproduced the same result with and without coverage: direct try/catch and explicit-message Should Throw passed, omitted-message Should Throw failed. Pester 3.4 calls String.Contains(null) when no expected message is supplied; the observed PS7 overload behavior yielded false. Fifteen affected assertions were strengthened to their specific expected error messages, keeping original operations and call-count assertions. This was not fixed by suppressing exceptions, changing production behavior or patching the global Pester installation.

## Not verified / not enabled

- The Pester-contained smoke-script contract has not yet been run after this isolation change. Its child-scope command visibility and all output paths still require a dedicated review and test.
- The actual built-application desktop smoke has not been rerun locally in this repair.
- No claim is made that the complete deployment suite or all-platform gate is green.
- The real deployment-state incident remains unresolved until the user approves a precise recovery plan. These tests neither restore that file nor authorize deployment.
