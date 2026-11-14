# Proposal safety and single-selection synchronization combination

Baseline: `8de50e3294586a8dd1924ab9bd27f27afb9f4431`, the separately validated typography/image/portable combination. Integrated source commits `b0bfeb4` (proposal safety) and `da16eef` (single-selection scope synchronization), not the fork's narrower update-only selection semantics.

## Conflict review

- RightPanel imports conflicted with the existing `UiIcon` import. All imports were retained, including `previewProposal` and `useSelectionScope`; shell icons and layout were not replaced.
- Store interface and initialization conflicted where proposal version met saved revision/conflict tracking. Both sets of fields were retained.
- Store `load` now increments proposal version while preserving `raw.revision`, resetting save conflict/error and maintaining existing repair/dirty behavior. CAS save functions, queue, ApiError handling and project APIs were not changed.
- `server/aiEdit.ts`, core operation validation and selection anchor policies remain byte-identical to the baseline. Filter/strict, ignored counts, selected subtree and anchored insertion behavior are retained. Preview and acceptance share the safety projection; HTML topology/style changes reject stale operations, independent text/field edits are preserved, and arrays remain atomic.
- History clears stale proposals without altering the existing selection model. AI scope follows effective single selection, including batched A→B→A and delayed requests. This is not Ctrl/Cmd multi-selection, inline review UI or transport cancellation.

The prior loopback follow-up was inspected but not cherry-picked: this baseline already has explicit 127.0.0.1 development/packaged addresses, typed readiness URLs and retain-on-failure traces. Existing light-theme deterministic browser setup and responsive-combination flags are unchanged. No duplicated configuration, dependencies, lockfile, packaging harness or deployment changes were made.

## Gates

Normal and packaged E2E discovery both list 77 tests in 27 files, adding four proposal and three selection scenarios to the previous 70. No browser was launched; cloud EPERM is an established blocker. Fresh Windows development and actual EXE gates remain required; the previously green image/typography package does not validate these new behavior changes.

The two new production modules `editor/proposalSafety.ts` and `editor/useSelectionScope.ts` must remain in the complete source-coverage denominator. Mixed React/store tests are not called strict isolated unit tests; no new coverage percentage is asserted. Full mixed suite passed: 98 files, 1009 passed and two platform skips (1011 total). Full lint, TypeScript and production build passed; the existing >500 kB chunk warning remains. No push, PR or deployment was performed.
