# Portable verification harness lifecycle hardening

Base: combined PR7–10 commit `1284931`. This candidate changes verification tooling only, not application behavior, permissions, upload limits, or deployment.

## Ownership and cleanup

Every process is registered immediately after this script spawns it, before startup polling. Cleanup uses that exact ChildProcess PID only while its exitCode/signalCode still indicate a live process. It never discovers or terminates processes by name. Existing tasklist inspection is count-only. Registered mock/port-occupier servers close in the same outer finally; listen errors become rejected promises rather than unhandled events. Closers run in reverse registration order and all are attempted. An original startup/assertion error is rethrown unchanged even if cleanup fails; successful checks followed by cleanup failure also fail the run.

Each owned process output is written to the private stage during cleanup. Failed stages are retained and their path printed; successful stages are removed only after all cleanup succeeds. Fixed ports 5390–5409 and 5450 require a single dedicated runner, not concurrent invocations. No real settings/data are used; the existing private LOCALAPPDATA and synthetic provider mock remain. This is not a guarantee against OS-level cleanup failure, abrupt runner termination, or hostile PID reuse between checking process state and invoking taskkill.

## CAS assertions

The actual EXE API scenario now creates a project, updates it with the returned revision, attempts a stale-revision update expecting 409, then reads back the winner's revision/title/digest. The winning title remains `验证项目`, preserving later restart expectations. No production CAS code changed. These Windows API assertions have been authored but not executed on Linux.

## Validation

Nine injectable helper cases cover startup failure, mid-operation failure, reverse-order cleanup, original error preservation despite cleanup failure, successful cleanup/removal, failure evidence retention, exact registered PID, and skipping exited/unspawned processes. The initial five lifecycle assertions failed against the no-cleanup implementation and passed after implementation; the four child-identity cases are additional boundary checks. Helpers use synthetic resources; they do not establish real Windows taskkill behavior. TypeScript/lint and full mixed-suite result are recorded in delivery.

Windows EXE, actual port conflict/forced kill, real CAS HTTP verification, and packaged runtime guard behavior remain pending. No workflow was added and no package was built or executed locally.

## Actual DOMPurify/runtime follow-up (not implemented here)

There is no public compile endpoint in this combined application. Do not add an artificial API or label HTML returned by an unrelated endpoint as guard verification. A valid next Windows test can launch the isolated EXE, seed synthetic HTML through its project API, open its bundled UI in Playwright, and assert both safe compiled DOM and no script execution/network beacon for entity-encoded javascript and SVG/foreignObject fixtures. Reuse the existing HTML-guard browser assertions against the packaged target; distinguish browser-bundle sanitizer behavior from server runtime dependency loading. The current verifier's startup alone tests only runtime loading; its page HTTP check does not execute browser code. The existing compressed-ZIP plaintext secret search also remains a limited heuristic, not proof about decompressed entries.

### Candidate Linux results

- Injected helper suite: 9/9 passed.
- Complete configured mixed suite: 85 files, 854 passed, 2 skipped / 856. Skips are the Windows-only case-alias tests in jsonMutation and projectRevisionHttp.
- TypeScript and changed-file ESLint passed; git diff whitespace check passed.
- New tooling helper is under scripts/, not a new src/server application module. No full coverage claim is made.

## Isolated Windows CI candidate

A dedicated workflow matches only `fix/upstream-package-verification-20261114` (or explicit workflow_dispatch). It has read-only repository permissions, no secrets, no credential persistence, no release or deployment action. Node22.19 generates the sample, builds the actual Windows package, records ZIP SHA256, runs the isolated verifier, and runs the complete packaged Playwright suite without snapshot updates or retries. Only explicit verify report/hash and browser evidence paths are uploaded, not private temporary data or the whole release. Execution is pending until the exact remote run is checked.

The old synthetic-key test searched compressed ZIP bytes and could miss a key in compressed entry content. A generated compressed-key case plus malformed archive case failed before the test-only helper change. The verifier now expands its own small synthetic backup and checks names and UTF-8 content. This is not an untrusted upload parser or a general archive memory-budget guarantee. No real key is used.

Final cloud candidate: 87 files / 858 mixed tests passed, two Windows-only skips; ESLint, TypeScript and production build passed (existing chunk-size warning). Workflow YAML parsed and its exact branch trigger/read-only permissions were checked. These results do not execute Windows process cleanup, real EXE or packaged browser assertions; those remain the purpose of the isolated remote job.
