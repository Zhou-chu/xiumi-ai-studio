# Navigation startup safety follow-up

## Observed failure and root cause

Remote CI 43413658472 passed static checks, build and deployment tests but had 66/69 E2E passes. Traces showed workspace fixtures and the oversized-export fixture were saved correctly, then replaced as the most-recent project by unintended blank/default drafts. The oversized-export assertion was therefore operating on the wrong article, not demonstrating a failed size limiter.

The client API wrapper converted every JSON body-reading failure, including navigation AbortError on a successful response, into `{}`. App startup had no cancellation guard. A late invalid value could be interpreted as an empty list or normalized into a default document and saved. React StrictMode also executed uncancelled initial creation twice.

## Deterministic red evidence

- Successful response-body AbortError and malformed JSON were incorrectly resolved as successful data.
- Empty-list StrictMode startup issued two initial saves instead of one.
- A real Chromium page reload with a deliberately pending response body reproduced an unintended newly saved draft.
- A first lifecycle fix exposed a persisted pageshow recovery gap; its red test drove generation-safe resumption without reloading or replacing an already loaded draft.

## Fix boundaries

Successful JSON failures now reject. HTTP error responses keep their status and friendly fallback. Startup validates list/document shape, ignores cancelled generations after each await, cancels on pagehide/unmount, and resumes only an incomplete initialization on persisted pageshow. Existing workspace and export-limit fixtures were not weakened or mocked to hide the issue. No new retry or increased timeout was added.

Ten new browser cases cover single initial save, interrupted navigation without phantom projects, malformed list/document shapes without writes, cached-page resumption with stale responses ignored, reuse of the same pending initial write on success/failure, and disabled editing/saving while startup is pending. Physical browser BFCache eligibility remains browser-dependent; the lifecycle test dispatches persisted page-transition events explicitly.

## Verification

Final local verification passed: 434 unit tests, lint, TypeScript and production build; all 79 E2E tests passed in 4.8 minutes with fixed snapshots and no retries. Independent final review found no blocking issue. Remote CI must be read separately after push.

Independent review also identified two adjacent startup risks and drove red-to-green tests: cached-page restoration during the first PUT now waits for that same promise rather than creating another draft, including failure; editing controls and save/edit keyboard shortcuts are unavailable until initialization finishes, preventing late startup from overwriting user input.

One intermediate full run passed 78/79 but Chromium's channel closed unexpectedly during an import-button click (232 ms after click start, before wizard behavior). No timeout or business assertion failed there; the trace lacked the browser stream and exit reason, so an OS/process cause is not asserted. Evidence was retained and the identical source was rerun without adding retries. Another prior run exposed a mobile help test's instantaneous visibility check during the new loading state; its setup now waits for the workspace and explicitly opens the property pane, retaining all touch assertions.

## Theme-aware CI fixture follow-up

Remote 33e1a5b passed all startup safety cases and the original project-contamination regressions, but finished 77/79. Its traces exposed two setup assumptions: the phone property-switch control is dark-layout-specific (the light layout already exposes that panel), and checking the AI-settings button before startup completes can select the wrong toolbar path. Both tests now wait for the actual workspace, select only the applicable visible entry, and run explicitly in light and dark contexts. All other setup-time visibility branches were audited and given the same workspace-ready condition. Product behavior, assertion intent, timeouts and retry settings are unchanged. Final verification: 434 unit tests, lint, TypeScript and build passed again; all 81 E2E tests passed in 4.3 minutes, including explicit light and dark cases. Remote CI remains a separately verified gate.
