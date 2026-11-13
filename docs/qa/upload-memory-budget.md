# Bounded multipart upload memory

Per-request file payloads are now limited to 64 MiB cumulative, retaining the
30 MiB single-file and 50-file count limits. Many small files remain supported;
large batches must be split. Multipart fields are bounded to eight fields of
64 KiB and 58 total parts. Limit failures produce HTTP 413 with an error body.

The custom Multer storage counts received file chunks, not Content-Length.
It rejects before retaining the chunk that crosses the budget, clears pending
chunk arrays, settles each pending callback once, and lets Multer drain and
remove successful buffers. Abort and stream errors settle outstanding writes.
No filesystem is used. Buffer concatenation can temporarily duplicate the
current file, so live retained payload can approach 64 + 30 MiB plus parser,
field and chunk overhead; 64 MiB is not a claimed total RSS ceiling. Concurrent
requests remain separate budgets; process-wide admission/concurrency limiting
is a residual deployment consideration.

The prior unbounded storage failed four of six initial regressions, including
cumulative chunked uploads and abort cleanup. New tests use tiny byte budgets,
real HTTP multipart requests, concurrent PassThrough streams, per-file limits,
request recovery, removal and error propagation. App route tests remain intact.
No existing data, instances, credentials or external services were touched.
