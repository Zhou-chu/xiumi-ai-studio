# Browser-gate failure investigation and repairs

## Evidence

- The failed `components` trace records HTTP 500 from `/api/samples/load`, with a JSON error identifying `EPERM` on atomic rename of the asset index temporary file. The subsequent `assets is not iterable` was a test destructuring that error response, not a malformed asset array.
- Assets already serialize index read/modify/write, and storage already serializes replacements per target. No E2E test directly writes an asset/template index. The trace does not establish which external handle caused the Windows denial; concurrent reading or scanning is a plausible trigger, not proven attribution.
- The failed `features` test parses the photo-unit JSON section of an AI prompt. The app-factory extraction added indentation inside multiline template literals, changing runtime prompt bytes and breaking the test mock's section delimiter. This was an extraction regression, not corrupted persisted JSON. The earlier whitespace-stripped source comparison missed it.

## Repairs and regression tests

- Restored all 18 multiline template-token chunks to their exact pre-extraction contents. Five actual HTTP route calls now assert the entire `chatJson` user prompt against static fixtures produced from baseline `c961c78`. The test failed on added indentation before repair.
- Atomic rename retries only `EPERM`, `EACCES`, and `EBUSY`, at most six attempts with five bounded delays totaling 620ms. It keeps the original destination and temporary file during retries, preserves the existing per-target queue, never removes the destination as a fallback, and cleans temporary files afterward.
- Injected lock tests failed before repair and now cover all three retryable errors, exhausted retries followed by a queued save, continuous visibility of the old JSON, and immediate failure for permanent `ENOSPC`. Existing permanent-failure tests now inject `EIO` rather than a transient one-shot `EPERM`.

All changes were made in the isolated audit worktree. No running E2E data, services, or shared browser instances were modified. The integrator must rerun the browser gate against the patched candidate.
