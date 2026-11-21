# Upstream template and theme fixture

`upstream-design.zip` is the direct output of the upstream
`550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe` writer
`server/dataTools.ts::writeBackup`. The synthetic template uses a heading,
quote, and divider, sets one valid role, and binds to the included custom
document theme. No projects, history, media, settings, or real data are present.

To regenerate, materialize only the two JSON entries in their declared paths
under an owned temporary data directory. Invoke the pinned writer with
`XIUMI_DATA_DIR=<temporary-directory> XIUMI_SKIP_ENV_FILES=1 node --import tsx`,
passing a file stream for `writeBackup(stream, '0.1.0')` and waiting for finish.
The generated manifest timestamp varies.
