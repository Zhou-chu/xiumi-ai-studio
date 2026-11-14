# PR #4: reasoning-effort errors and automatic-suggestion cancellation

Base: 3e350175667e5ddce148666a0fbf2db806c0b415. Scope: review items 2 and 9 only.

- A provider's explicit 400/422 rejection of configured reasoning effort now explains where to clear the value or choose a supported value, retaining the original diagnostic. No saved profile or requested effort is silently changed.
- Automatic suggestions pass the panel's AbortSignal to browser fetch. Closing the panel, changing selection, or otherwise invalidating that effect cancels that HTTP request.
- The suggestion route propagates request abort / unfinished response disconnect to chatText and the provider fetch. Normal request-body completion does not cancel processing. Listener cleanup runs on every completion; disconnected requests do not publish late results.
- chatText preserves its 180-second default deadline and budget/protocol behavior, distinguishes external cancellation from a timeout, and rejects late bodies after cancellation. Other AI routes are not newly given automatic cancellation.
- Cancelled suggestions and cancelled failures are not cached. The existing serialization and 30-second start-rate limit remain intact; a fresh request can run after the cancelled fetch settles and the rate limit permits it.
- Cancellation is best effort once sent: it cannot promise reversal of provider computation or refund of billed tokens.

Validation: initial new regression file had 6 failures / 2 passes against the base. Final targeted suite: 7 files, 80 tests passed, including actual localhost HTTP disconnect, UI panel-close/selection-change propagation, pre-send/after-send/late-response cancellation, timeout preservation, unchanged effort, and protocol/token-budget regressions. TypeScript and lint are checked separately. This is not a new full-source coverage, browser gate, or Sonar scan.

Unchanged review boundaries: current selected AI editing is strict update-only for selected IDs. It is not the older upstream filter policy and this patch does not expand insertion/selection behavior. Node >=22.19 is already documented; no CI matrix change is part of this patch.
