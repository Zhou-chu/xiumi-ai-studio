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

The offline hosted observation uses two inert, static HTML fixtures. The
`upstream-native-svg-compiled.html` file comes from upstream `compileDoc`
wrapped in a test-only CSP. SHA-256:
`96d0f3aac7dc6785ea0fed9b020f2f0bfcd43e391915759efb01c638763ca5a1`.
`synthetic-svg-detached.html` keeps the three independent fixtures, reconstructs
the bounded two-fragment case with deterministic inner IDs and embeds it in an
opaque sandbox under default-deny CSP, with a same-ID outer decoy.
SHA-256: `799d2ceed32f6cd6def661a6acacd60e1d9954cfe025455fbf3f31025f6f8f19`.
Both are reference evidence only: no application path accepts these cross-root
manuscripts. Cross-root timing and explicit href are observed separately, not
assumed to work in Chromium.

The controlled matrix pairs each sandboxed `srcdoc` payload with its exact
decoded standalone bytes: `synthetic-svg-top-rewritten.html` with
`synthetic-svg-detached.html`, and `synthetic-svg-top-original.html` with
`synthetic-svg-detached-original.html`. The original-ID variant differs only
in the two IDs, corresponding event and target references, and same-ID outer
decoy. All cases use the same no-network policy and actual hit-tested input.

The generated-name positive witness `synthetic-svg-detached-underscore.html`
changes only the separators in the two synthetic IDs, including their timing,
target, and outer-decoy occurrences, relative to the hyphenated sandbox fixture.
The test requires actual timing and target opacity changes separately, without
any change to the sandbox or application.
SHA-256: `48bf2912664950d665caf7573a3c6186e5187f770b882d793a0567efca876cda`.
