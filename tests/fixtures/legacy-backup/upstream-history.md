# Upstream project-history fixture

`upstream-history.zip` is a direct output of upstream
`550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe` `server/dataTools.ts::writeBackup`.
It contains a single synthetic text project, an older labeled version of that
same project, and the generated archive manifest. It contains no source
credentials, `.env`, user manuscript, provider settings, or image.

To regenerate, materialize the project and version JSON entries into an owned
temporary data directory and invoke the pinned writer with
`XIUMI_DATA_DIR=<temporary-directory> XIUMI_SKIP_ENV_FILES=1 node --import tsx`.
Use a file stream for `writeBackup(output, '0.1.0')` and wait for its finish.
The manifest timestamp differs between runs.
