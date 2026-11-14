# Combined shell fixture revision contract

The editorial shell suite predates project compare-and-swap revisions. Its beforeEach and two scenario-specific writers reused `editorial-shell-fixture` without a revision. In the combined tree, the first scenario's second write necessarily conflicts; subsequent scenarios also reuse the persisted fixture.

The test-only `seedProject` helper now allows only that exact fixture ID. It GETs the current fixture, accepts only 404 as absence, validates the existing object's ID and nonempty string revision, and PUTs the requested fixture with the current revision. Non-404 HTTP failures, invalid JSON, malformed existing records, and network errors stop before PUT. A concurrent 409 is reported without retry or deletion. No product CAS logic or user project is changed.

The three shell writers use the helper. Existing title, authored HTML, blocks, export/computed-style and visual assertions are unchanged. Repeated suite runs update only this owned fixture; they do not delete the project collection.

## Verification

- RED: an extracted implementation matching the old unconditional PUT behavior failed 8 of 9 controlled tests, including repeated seed and special authored-content replacement (409).
- GREEN: revision-aware behavior passed those 9 cases; an additional exact-ID allowlist case also passed (10 total).
- Targeted ESLint and full TypeScript check passed.
- Controlled request doubles exercise revision sequencing and failure propagation; these are not a real HTTP/browser run.
- No browser, complete suite, screenshots, or packaged executable was run for this patch. Combined Windows CI/browser validation remains required.
