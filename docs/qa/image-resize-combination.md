# Image resize in the typography / portable combination

Baseline: `c5c457ccb67ad16adf74f6e529f5357bae4a47cb` (local typography/portable combination). Added the two independently reviewed image-resize commits as `a302283` and `c295f1e`; their source commits are `bf1144d` and `bf68ad77`.

Both cherry-picks applied without conflicts. The combined diff was inspected: Canvas gains only the image-control import and sibling mount; compiler changes only per-reference native image wrapping. Typography and HTML selection controls, ColorPicker, replay, save revision semantics, responsive shell, DOMPurify, origin validation and portable verification lifecycle are retained. No server, dependency, lockfile, packaging runtime or deployment logic changes were introduced.

Both normal and packaged E2E workflow steps explicitly set `XIUMI_RESPONSIVE_COMBINATION: '1'`. Thus the existing 390 px image test is enabled on this responsive combination instead of being skipped as on the narrow desktop-only base. Other workflow triggers, assertions, timeouts and snapshot policies are unchanged.

Cloud verification of this combination:

- Full ESLint and TypeScript checks passed.
- Full mixed test suite: 95 files passed; 966 tests passed, two existing platform skips, 968 total.
- Production build passed; existing large-chunk warning remains.
- Normal and packaged Playwright discovery both list 70 tests across 25 files, including eight image scenarios. Discovery does not execute tests or prove mobile behavior.
- No cloud browser execution or new Windows package execution was performed. Prior successful typography/portable artifacts do not establish this changed combination's behavior. A fresh Windows CI build, verifier and both E2E targets are still required, including actual 390 px, zoom, swap and small-image re-enlargement cases.

Three new production TypeScript modules remain part of the complete coverage denominator. No new coverage percentage is claimed from this non-coverage run. No push, PR, deployment or real data/credential access was performed for this candidate.
