# Strict-unit staging checkpoint (not a release)

This independent staging checkpoint preserves reviewed work on combined compatibility base `2b57e2ded2ea76ad1e917d95bf9ed68525d89d5b`. It does not replace fork main or any upstream pull-request branch, and does not deploy to the desktop. Private run reports, local paths and intermediate history are not published.

## Verified Linux code and test snapshot

The source code, test contents, test-layer manifest, runner configuration and dependency lock match the isolated, verified snapshot. The public branch adds this summary and a staging-only CI workflow.

| Check | Result |
| --- | ---: |
| Strict unit tests | 1,919 passed in 178 files |
| Production files included | 148 |
| Statements | 92.42% |
| Branches | 90.11% |
| Functions | 92.45% |
| Lines | 93.42% |
| Mixed regression | 2,458 passed, 2 Windows-specific skips, 0 failures |
| ESLint, TypeScript, production build | Passed |

All four strict coverage dimensions pass the unchanged 90.01% thresholds. The reviewed inventory has zero pending or mixed files awaiting classification; the original mixed regression is run separately and is not counted toward strict unit coverage. Build output still carries Vite's main-bundle size advisory.

Fresh Windows CI, real desktop browser and model calls, portable EXE, and current Sonar results are separate acceptance checks. Earlier runs for different commits do not prove this checkpoint passes.

## Reproduce

Install with the frozen lockfile, then run `node tests/quality/test-layer-check.mjs` and `pnpm exec vitest run --config vitest.unit.config.ts --coverage`. Run `pnpm test` separately for mixed regression. The test-layer inventory binds source and test digests, reviewed targets and rationale. Integration, tooling, and browser coverage are not relabeled as unit coverage.

The snapshot includes regression fixes for asynchronous document ownership, malformed image drag inputs, imported inline image surrounding text, rich heading and replay text fidelity, crop hint validation, and local model readiness keyed by the actual endpoint. The existing upstream PR review remains independent.
