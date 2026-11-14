# Minimum Node compatibility

CI now runs its complete existing gate independently on exact Node 22.19.0
and Node 24. No matrix leg skips checks; fail-fast is false and artifact names
include the Node version to avoid upload collisions. The application engines
remain >=22.19.0, matching undici 8.12.4; no unsupported 22.18 claim is made.

The previous test-only jsdom 30.1.3 officially requires Node ^22.22.2,
^24.15.0 or >=26. A minimal DOM/30-case smoke happened to work on22.19,
but that does not override the package engines. Test jsdom is now fixed to
28.1.0 (and types28.0.0), matching the application's isomorphic-dompurify3.0.0
resolved DOM. Its engines support ^20.19.0 || ^22.12.0 || >=24.0.0.
Runtime DOMPurify/undici versions are unchanged.

The first full22.19 run passed1254/1257 tests; three existing image-rehosting
and source-detection assertions exposed jsdom28's selector-engine issue:
[style] matched one background URL element while [style*="url("] matched zero.
The fix uses [style] followed by the exact same case-sensitive substring
predicate before existing URL processing. No assertions were weakened and
application selection semantics are preserved.

Official npm node-win-x64@22.19.0 is isolated outside the checkout and only
prepended to the runner process PATH; system Node and production are unchanged.
The runner directly invokes this binary for ESLint, TypeScript, Vitest and Vite.
Local logs are node22-{lint,types,unit,build}.log and node22-done.json.
Full coverage, live browser and remote matrix results must be regenerated on
the integrated commit, not inferred from this compatibility check.

Audit reports one pre-existing dev-only moderate advisory:
GHSA-g3hv-75wg-m249, minimatch10.2.6 via ESLint/@eslint/config-array and
@typescript-eslint/typescript-estree. It concerns untrusted glob amplification;
these development linters consume repository/tool configuration, not the
application HTTP surface. Fixed version >=11.0.1 is a major upgrade, deliberately
not forced during this narrow runtime compatibility change. No new production
advisory was reported. This npm audit result is not a Sonar issue resolution.

Final local result (2026-11-14, Node v22.19.0): lint0, typecheck0,
1257/1257 unit tests in140 files pass, build0 (existing chunk-size warning).
Node v24.19.0 with the same jsdom28 lock: both affected suites91/91 pass.
Matrix YAML parsed successfully (16 unchanged gate steps per leg), frozen-lock
installation succeeds. New combined-candidate full coverage/E2E and remote CI
are intentionally left for the integration gate; no local result substitutes
for those jobs.
