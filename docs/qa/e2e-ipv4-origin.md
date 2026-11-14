# Explicit loopback origin for the browser gate

PR 14 run 43568639186 at decbbe0 passed 133/134 scenarios on Node 22.19.0.
The import wizard scenario encountered `net::ERR_CONNECTION_REFUSED` fetching
`http://localhost:5273/src/core/enrich.ts`, before its business assertions.
The ImportWizard module and adjacent dependencies returned HTTP 200 from `[::1]`.
The failed request has no recorded remote IP. Logs do not show Vite restarting
or a module-transform error. This evidence does not prove which address failed.

The E2E Vite listener, browser base URL and service readiness URLs now use
127.0.0.1 consistently. The API listener and Vite API/media proxy already used
127.0.0.1 and are unchanged. This removes address-family ambiguity, not a claim
that the precise original transport cause has been established.

No production listener, port, independent data directory, business assertion,
lazy-import retry, test retry or timeout is changed. Readiness now checks the
actual IPv4 HTTP endpoints, including the read-only API status endpoint.

Verification on Node 22.19.0:
- Configuration invariant: before 1 failed / 1 passed; after 2 passed.
- Actual Chromium enrich + delayed-restore scenarios: 2/2 passed, 22.5s total.
- Targeted ESLint and TypeScript no-emit checks run separately.
- Existing NO_COLOR/FORCE_COLOR warnings are non-fatal.

The complete dual-Node remote matrix must still run on the integrated commit.
