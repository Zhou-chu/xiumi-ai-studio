# Late version restore: operation-specific E2E synchronization

## Failure evidence

PR 14 CI run 43566689571, Node 24, failed at the global
`page.waitForLoadState('networkidle')` in `late-document-operations.spec.ts`.
The trace records the delayed version GET returning 200, followed by the new
manuscript PUT returning 200. At timeout the page still displays the new title
and the saved indicator. No save/restore assertion failed: they had not yet run.
The trace does not establish which connection or frame prevented network idle;
this patch does not claim a Vite WebSocket is itself the cause.

## Change and controlled regression

A held, unrelated browser request makes global network-idle waiting unsuitable
for this scenario deterministically. The original wait fails with a 15-second
test timeout at the same call. The replacement checks the exact delayed response
status and body completion, then runs all original UI title, saved-state,
persisted-title, normal-restore and undo assertions. The unrelated request is
released only after those assertions. No production behavior, assertion, retry
setting or CI timeout was weakened.

The isolated run uses ports 5373/5374 and its own data directory; the checked-in
Playwright configuration is unchanged. Targeted browser regression is repeated
three times with the same 15-second per-test budget. Full matrix CI remains a
separate required gate; these targeted results do not substitute for it.

## Verified local results

- Before fix: 1 failure at global network idle (15-second budget).
- After fix: 3/3 browser runs passed (4.1s, 3.2s, 3.2s).
- Targeted ESLint, TypeScript no-emit and git diff whitespace checks passed.
- Existing NO_COLOR/FORCE_COLOR environment warnings remain non-fatal.
