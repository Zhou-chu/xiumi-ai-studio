# Upload resource boundary follow-up

This patch preserves the existing 30 MiB per-file / 64 MiB cumulative request capability. It does not lower or conceal the Multer limit to satisfy Sonar S5693's recommended 8,000,000-byte threshold. A fresh full-candidate analysis and explicit security review are still required; this document does not assert that finding or the gate passed.

## Runtime contract

- One application instance admits at most two upload requests across `/api/assets` and `/api/import`. Admission covers parsing and downstream processing; excess requests receive 429 with Retry-After: 1.
- Upload parsing has a 120-second deadline (408). This timer stops when parsing finishes and does not replace the LLM's independent 180-second budget.
- Files stream to randomly created temporary directories and a fixed exclusive-created filename, never the supplied filename. Files use mode 0600 where supported by the OS. Completed files are read into the existing business API's buffers and removed before the storage callback completes.
- File, field and part counts are bounded. Accumulated file bytes, including across files, remain capped at 64 MiB per request. Two admitted requests therefore bound retained uploaded-file payload buffers to 128 MiB per application instance. This is NOT a process RSS limit: Sharp decoded pixels, downstream transformations, stream buffers, runtime overhead and other endpoints are outside that number.
- Disk exhaustion is 507; interrupted streams, file/request size rejection and normal completion all clean owned temporary files. Cleanup failure is reported rather than silently treated as success. An abrupt process kill can leave temporary files; crash-recovery scavenging is not implemented here.
- Normal request `close` after its body is read does not cancel processing. A disconnected response cannot free admission while a non-cancellable handler is still running. Admission is released exactly once, after both processing and tracked storage cleanup complete.
- The previous in-memory storage implementation is removed. Existing limit/error/abort tests now exercise the production disk implementation rather than an unused compatibility implementation.

## Verification

45 focused tests passed across uploadStorage, uploadDisk, uploadGate, uploadGateIntegration and serverApp. They include real HTTP incomplete multipart timeout, real client disconnect while business processing remains pending, disk-full injection/recovery, cumulative limits, stream errors, cleanup, malformed configuration, synchronous/asynchronous errors, a 9 MiB successful upload, and two-slot admission with a rejected third request.

TypeScript compilation and ESLint on the changed source/tests passed.

Targeted diagnostic coverage for ONLY the two storage/gate modules: statements 97.87% (184/188), branches 94.11% (64/68), functions 100% (35/35), lines 98.93% (93/94). This is not the full-repository coverage gate. Both production modules must be included in the integrating branch's unchanged full-source denominator and fresh LCOV; no exclusion is added.

Reproduce focused tests:

```text
node node_modules/vitest/vitest.mjs run tests/unit/uploadGateIntegration.test.ts tests/unit/uploadDisk.test.ts tests/unit/uploadStorage.test.ts tests/unit/uploadGate.test.ts tests/unit/serverApp.test.ts
```

Full unit/browser regression, fresh full-source coverage, and Sonar re-analysis belong to the integrating candidate after this commit. No real credentials, user data or shared service configuration were changed by these tests.
