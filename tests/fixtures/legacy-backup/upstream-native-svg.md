# Synthetic upstream SVG archive
`upstream-native-svg.zip` is the output of upstream `server/dataTools.ts:writeBackup`
at `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe` using a single synthetic project, no
credentials, media or external providers. SHA-256:
`5cc6c22f6eed866a2f9e6418bc26ce10d7d35aaff19c87e917f92840e34fa7c2`.

The full upstream project includes same-article cross-fragment IDs, references
and timing, intentionally not supported by this bounded restore. It must be
reported as unsupported, not imported with silently lost behavior. For the
positive round-trip, the test helper removes those two blocks from a disposable
copy, leaving the original click, touch and discrete-visibility HTML strings
unchanged. This does not establish parity for arbitrary SVG or markup.
