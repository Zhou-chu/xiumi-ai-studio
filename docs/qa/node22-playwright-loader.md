# Node 22 Playwright ESM loader initialization

On exact47b08fb with Node22.19.0, normal Playwright `test --list` fails before
collecting any tests: html-encoding-sniffer6/jsdom28 reports that
`./fallback/encoding.js` is not in the module cache. Native import of the same
production DOMPurify graph succeeds. Initializing that graph with Node's
`--import isomorphic-dompurify` before Playwright installs its TS loader makes
all134 tests/33files collect successfully. This local red/green differential
isolates the interaction to loader initialization; it does not establish an
upstream Node or Playwright bugfix version.

The unified `pnpm e2e` command now performs that native preload before invoking
the existing Playwright CLI. It does not replace or bypass the sanitizer, alter
dependencies, relax the Node minimum, skip tests, change assertions or increase
timeouts. Forked Playwright workers inherit the Node preload argument.

Verified locally on Node22.19:
- original --list exits1 /0tests; preloaded --list exits0 /134tests;
- a real Playwright worker imports guardHtml and rejects entity-encoded script
  URLs and scripts while retaining safe content,1/1 passed;
- actual `node --import tsx server/index.ts` starts without the preload on
  isolated5988/temp data and /api/projects returns successfully; logs confirm
  the correct listener, and only that newly started PID was stopped.

Full dual-version remote E2E remains required after integration; collection
and one worker test alone are not a full browser gate.

Actual Chromium subset on the minimum Node passed5/5 unchanged keyboard,
multiselect, delete/undo,390px touch and1440px paper-isolation cases, using
isolated5989/5990 services and data. Node24 also collects all134 tests with the
same preloaded entry. No test or timeout was edited.
