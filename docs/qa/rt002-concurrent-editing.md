# RT-002: concurrent project saves

## Failure and cause

On baseline 5018a4e, PUT /api/projects/:id overwrites the entire document without checking its loaded version. Serializing file renames does not prevent stale clients from replacing newer content. Regression failure transcripts are retained alongside this report: both simultaneous saves originally fulfilled; undo reused an obsolete token; overlapping same-page saves made two requests.

## Change

- Server-generated opaque revisions; GET derives a stable SHA-256 token for legacy JSON without modifying the file.
- Per-project serialized read/compare/write, including deletion. Stale, missing, or deleted-document versions return HTTP 409 without writing. Creating a new ID requires no revision.
- An old client may still create projects, but cannot blindly overwrite an existing project. Refresh/update the client to continue editing; old clients that ignore returned save tokens will safely fail on their next save.
- Client persistence token is separate from undo/redo and restored historical content. Same-page overlapping saves share one request; edits made during a request use the returned token on their next save.
- Conflicts retain the local draft and stop automatic retries. A visible warning offers an independent conflict copy or the existing export flow. Failed copy attempts leave the draft intact. Edits made during copy creation remain dirty and are saved with the new copy's token. Existing beforeunload guard warns on unsaved state.

## Verification

- Unit regression: server stale/simultaneous writes, legacy migration, deleted-project stale writes; client undo, same-page save overlap, conflict retry blocking, copy failures, double-click copy, edits/title changes during copy.
- Full unit suite: 393 passed across 40 files. Typecheck, ESLint, and production build passed (existing large-chunk advisory only).
- Real two-page Playwright scenario added at tests/e2e/save-concurrency.spec.ts, covering winner preservation, visible conflict, copy creation, reload, and undo after saving.
- Cloud browser launch was blocked by Chromium Unix-socket EPERM, including the approved elevated retry. This is an unexecuted browser scenario, not a browser pass. The scenario must run on the desktop or CI before merge.

## Deployment constraint

The file store supports one API process per DATA_DIR, as in the current desktop deployment. The queue is process-local; do not run multiple API processes against the same directory. Supporting that topology needs a transactional database or an inter-process locking strategy. No forced overwrite or automatic content merge is offered.
