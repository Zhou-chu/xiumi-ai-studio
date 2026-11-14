# PR 7–10 isolated combination

Inputs: PR7 a60ca708, PR8 ad06d36c, PR9 23779d1, PR10 tree-equivalent local 02dcc4e (published 089a5ffe). Upstream base f0c819f. This is a separate integration candidate, not an upstream merge or deployment.

Independent read-only review identified four save/shell conflict files. Resolutions retain active/expected-document/loadIfUnchanged ownership, ApiError status, conflict-copy button, delayed navigation guards, and both UI and safety imports. main.tsx preserves saveBeforeLeave and ColorModeProvider/CSS. PR9 package runtime, lockfile and DOM preloading scripts remain byte-identical to its verified candidate.

PR8+10 test storage origin mismatch was reproduced: one failing/four passing configuration cases. A single baseURL supplies browser access and storage origin; both dev127:5273 and packaged127:5284 now pass, five/five total. Independent shell5873 configuration is unchanged. No snapshot, timeout, retry or original business assertion changes.

Cloud Node24.22.1 verification: lint/types passed; final complete mixed suite84 files845 passed/two Windows-only skipped. Production build passed with the existing >500 kB chunk warning. Shared existing dependency install matches PR9's unchanged lockfile; package-manager automatic dispatch was unavailable, so commands used installed Node tool entrypoints directly. This is not strict-unit coverage.

Cloud Chromium cannot start (socket EPERM); no new browser pass is claimed. Exact-commit Windows CI and refreshed Windows EXE remain unverified for this combination. Individual PR matrices do not establish combined browser correctness. No user DATA, credentials, desktop service or existing PR head changed.

Final independent review also caught shell fixture PUTs incompatible with revision CAS. Test-only allowlisted seed now GETs the current revision, refuses malformed/error reads and never retries conflicts or deletes projects. Ten focused cases pass after eight initial failures. Product CAS and all visual assertions remain unchanged. Final dev/shell discovery finds55/10 cases, not executed locally.
