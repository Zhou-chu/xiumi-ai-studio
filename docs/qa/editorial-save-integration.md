# Editorial theme and save-safety integration

## Baseline and scope

Independent branch `integration/editorial-save-safety-20261113`, based on #10 `aa5b3c9`, with the visual work from #12 `56a7837` cherry-picked without conflicts. #10 already contains #11's cover-title protections through `dd0bc9c`; #11 must not be cherry-picked a second time. The production service on port 5174 and original visual preview on 5175 were not overwritten.

## Integrated safeguards

- Revision compare-and-swap and per-project serialized writes reject stale concurrent saves with HTTP 409. Conflict copies preserve the losing tab's content without overwriting the winner.
- Failed saves prevent new/switch/import navigation from discarding current edits. Undo history is independent of the last acknowledged server revision.
- Delayed project reads, version restores, and cover uploads cannot replace a different or subsequently edited document. Version restore remains undoable.
- Batch variants re-read and validate cached revisions (rejecting remote edits/deletions), retain successful receipts across partial failure, persist the selected variant last, and replace the editor only after successful persistence. Closing the wizard stops follow-up application/requests.
- First version collections create their project subdirectory before listing or saving; this fixes an actual ENOENT on a manuscript's first historical snapshot.
- The dark conflict banner uses the editorial typography and wraps with reachable controls on a 390px viewport.

## Evidence and boundaries

The regression suite uses disposable `data-e2e`, ports 5273/5274, and synthetic manuscripts. HTTP 503 is explicitly injected for recoverable-save tests; concurrency tests use real server revisions and 409 responses. Model-discovery failure calls the real backend against unreachable localhost, not a fabricated success.

`visual-evidence/before` preserves the original comparison. The integrated full run regenerates `visual-evidence/after` using the same route, fixture and 1440x900 / 1024x768 / 390x844 dimensions. Chromium font inspection verifies custom Chinese glyphs in locally hosted Noto Sans SC and Noto Serif SC. Authored HTML typography and preview output are invariant across application theme switches.

Only one API process may own a DATA_DIR. The lock is in-process, not a distributed filesystem lock. This work does not claim live publication to WeChat/Xiumi, paid LLM completion, physical-device testing, screen-reader certification, or Firefox/Safari validation. The existing main bundle >500kB warning remains.

## Final verification

2026-11-13 final source-static validation: `pnpm check` passed (47 unit files / 419 tests), `pnpm build` passed, and `pnpm e2e --update-snapshots=none` passed 64/64. Deployment guard tests passed under both Windows PowerShell and PowerShell 7. Independent production-built preview on http://127.0.0.1:5176/ returned 200 and rendered the expected Chinese title and graphite toolbar in Chromium. The 5174/5175 services still returned 200. No production deployment is implied by this document alone.
