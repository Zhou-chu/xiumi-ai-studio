# Upstream library backup fixture

`upstream-library.zip` is the unmodified output of `server/dataTools.ts:writeBackup`
from upstream commit `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. It contains
three synthetic empty projects, one synthetic empty template, a 1×1 PNG and
its index, and a redacted test provider profile. It contains no user data,
real credentials, or .env. This is not the fork's single-project export.

To reproduce, write the entries listed by unzip -l (excluding the generated manifest) to
a fresh temporary directory, put any non-secret marker in the fixture
profile's source `apiKey`, and run a small ESM script in the pinned upstream
checkout. Use `XIUMI_DATA_DIR=<tmp> XIUMI_SKIP_ENV_FILES=1 node --import tsx
<script>`. The script calls `writeBackup(createWriteStream(out), '0.1.0')`
and awaits the stream's finish. Output timestamps differ, and the profile's
source key is always redacted by the upstream writer.
