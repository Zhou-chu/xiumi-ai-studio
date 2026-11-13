# DOCX and image processing resource boundaries

Base candidate: `6fce4a016f7eea643fb72f95725862bd6b35d9cf`. This change does not reduce the 30 MiB compressed upload / 64 MiB request limits, change Sonar rules, or resolve findings administratively.

## Enforced budgets

- DOCX: maximum 2,048 ZIP entries, 32 MiB actual inflated bytes per entry, and 128 MiB actual inflated bytes for the entire archive. All entries are streamed sequentially before Mammoth runs or any embedded asset is created. Limits are counted from data chunks, not trusted header sizes. Incorrect declared sizes, duplicate names and unsupported ZIP encodings are rejected; the active inflater is destroyed and the archive closed on failure.
- `yauzl` is fixed at 3.4.0, MIT licensed, from the official npm registry (Node >=12, compatible with this project's >=22.19.0). Its stream destruction propagates to the native zlib inflater and compressed source. JSZip 3.10.2 is a test-only direct dependency for controlled fixtures, not the production validation boundary. Mammoth's existing JSZip conversion follows successful validation; compressed data is not mutated between the two passes.
- Images: explicit 64,000,000 input pixels, allowing 48MP phone images by dimensions. Existing EXIF rotation, first-frame treatment, transparency, PNG/JPEG encoding and 2,400-pixel asset output remain unchanged. Input above the ceiling receives 413 with a readable action.
- Every application Sharp pipeline in assets.ts shares one active-operation gate and at most 64 waiting operations. More requests receive 429. Admission is returned only after the real encoding/output promise settles, including failures. Upload request concurrency is a separate boundary, not a substitute for this image gate.
- Mammoth can swallow image-converter errors; resource errors are therefore latched and rethrown after its conversion settles. On overall rejection, already-started image tasks are awaited before rolling back only assets created by that import. Rollback uses allSettled; failures are counted on the original Error as cleanupFailures and logged without filenames or user content, without replacing an original 413/429.
- saveAsset removes its own new output if encoding or index update fails. Cleanup failure is recorded without hiding the original error. No claim is made that filesystem permission errors or process termination can always be cleaned automatically.
- uploadGate uses explicit await/try/catch/finally for S4822 while retaining parser-once, disconnected-client admission, deadline and downstream-settlement behavior.

## Capacity and compatibility

These are logical work limits, NOT a complete process RSS ceiling. A 64MP four-channel raster alone represents about 256 MB before codec/runtime overhead; other sample depths/channels and image operations may require more. DOCX XML/object graphs and base64 conversion also add overhead. Only one Sharp pipeline runs at once, but retained input buffers and document parsing still exist concurrently. Multi-process deployments multiply per-process limits.

Documents exceeding expanded-content budgets must be split or have embedded images reduced. This intentionally rejects unusual huge XML/embedded entries even when the compressed input is small. Invalid or encrypted/unsupported archives return the existing readable 400 recovery message. ZIP validation failure occurs before asset side effects. External DOCX image access remains explicitly disabled and is covered by positive/negative control fixtures.

Abrupt termination can leave prior upload temporary directories. No startup deletion based only on age/PID is added: there is no existing lease proving those files are not owned by another active process. A future scavenger would need an application-specific namespace and verified exclusive ownership/liveness; never delete arbitrary temporary folders.

## Evidence and remaining gates

Observed red-to-green tests include excessive entries, compressed small / expanded 33 MiB entry, explicit image pixel configuration, concurrent Sharp work, swallowed resource errors, overall converter rejection after a saved image, late in-flight image completion during rollback, rollback failure preserving safety status, and partial image output cleanup.

Additional fixtures cover cumulative actual output, dishonest declared sizes, duplicate entries, unsupported compression, late stream events/cancellation, real Sharp metadata at 48MP and above 64MP, bounded queue overflow/recovery, normal embedded DOCX images, and denied external file relationships.

Tests use owned temporary fixtures and no live credentials. Focused coverage is diagnostic only; both new production files must remain in the integrating branch's full source denominator. Integration must rerun full unit coverage/browser gates and Sonar on its exact final commit. S5693 still sees the explicit 30 MiB upload setting, so its recommended-threshold finding remains subject to transparent review, not a false-positive claim or an automatic acceptance.

Focused verification at delivery: 55 tests passed across nine files; five-module diagnostic coverage S96.52% (306/317), B93.24% (138/148), F94.02% (63/67), L98.51% (199/202). New docxBudget.ts and imageBudget.ts individually have 100% statements/branches/functions/lines. TypeScript and changed-file ESLint passed. Vite production build passed, with the existing >500 kB chunk-size advisory. Full repository tests/coverage and E2E are deliberately left to the integrating branch's serialized gate; no partial result is presented as full-repository acceptance.

## Follow-up: derived image output budget

A separate output ceiling now guards explicit ratio variants before cache lookup or Sharp execution: 64,000,000 pixels. This does not silently change the requested aspect ratio. For example, 1:999 at width 2,400 would request 5,754,240,000 pixels and now returns 413; the reverse 999:1 at width 2,400 produces 2,400 x 2 pixels and remains valid. Ratios producing zero/non-finite dimensions return 400. Width is normalized to an integer once for both the resize operation and cache key. Ordinary ratios and existing integer-width keys are unchanged.

The shared image slot rechecks the cache, so concurrent identical requests do not overwrite an already completed output. New failed cache output is removed; cleanup failure is recorded without replacing the original error. Existing cached files are not deleted merely because a newly enforced budget rejects a request.

Four observed failing regression tests were made green (output limit/cache bypass, exact 64MP boundary, integer cache-width consistency, concurrent duplicate rendering); an additional cleanup-failure test passes. 18 focused tests passed. Assets/image-budget diagnostic coverage: statements 100% (107/107), branches 96.77% (60/62), functions 100% (23/23), lines 100% (84/84). TypeScript and changed-file lint passed. These remain focused results, not a full candidate gate.

## Atomic variant publication

A deferred-encoding regression exposed that direct writes to the final cache path allowed a second request to return a partial file. Variants now encode to a unique same-directory temporary filename and publish only after successful encoding with rename. Errors remove only the writer's temporary file, never an existing final cache file. Tests cover an actual partial-file/deferred promise, concurrent readers, and publication failure after another writer has produced a valid final output. 20 focused tests, TypeScript and changed-file lint pass. Hard termination may still leave temporary files, as documented above.
