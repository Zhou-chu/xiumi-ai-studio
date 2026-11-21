# Upstream component and image restore fixture

The checked-in ZIP was written by upstream
`123huangcan250/xiumi-ai-studio@550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`
using the normal `src/core/components.ts::makeDraft` shape and genuine
`server/dataTools.ts::writeBackup`. It contains a synthetic HTML fragment
and a locally generated green 8 × 6 PNG with its index and archive manifest.
The source label and account are fictional; no project, external image,
credentials, settings, or personal data are present.

To regenerate: generate the indexed 8 × 6 PNG and its component JSON in an
owned temporary data directory, then invoke the pinned writer with
`XIUMI_DATA_DIR=<temporary-directory> XIUMI_SKIP_ENV_FILES=1 node --import tsx`,
passing a writable file stream to `writeBackup(stream, '0.1.0')` and waiting
for finish. The manifest timestamp varies.
