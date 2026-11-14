# Model picker compatibility batch

Base: full candidate `763d0dc`. Scope: foldable accessible provider model list, bounded internal scrolling, mobile settings layout. No provider transport, connection probe budget, credentials, persistence or document/export changes.

## Preserved upstream contracts

AiSettingsModal only imports ModelPicker and replaces the permanent size-select with its controlled value/selectModel callback. endpointOf/provider, credentialScopes/tuningScopes, serviceDraft/checkCredentials/patch/discoverAfterEdit and request-generation checks are unchanged. Selecting a discovered model still applies its metadata. Hand-editing a model still retains manually chosen context/output/effort settings, unlike an older fork test; the existing upstream preservation assertions remain.

The list uses a native disclosure button and a single focused listbox with aria-activedescendant. Options are not additional Tab stops. Arrows/Home/End move the virtual cursor; Enter/Space selects and restores trigger focus; Escape first closes the picker; Tab/outside pointer closes without stealing focus. The top dialog alone delegates Escape to its open picker. Opening reveals the list by adjusting the nearest modal body only; subsequent cursor scrolling is confined to the list. Existing scoped picker CSS is reused, target height increased to 44px, settings input/control text set to 14px, and light-mode mobile settings get the single-column layout already present in dark mode. Authored-content exclusions remain.

## Evidence

- Before implementation: updated real settings DOM tests ran **13 failing / 18 passing**, missing disclosure behavior (not an import failure). An earlier attempt used an incomplete dependency link and collected no tests; that infrastructure failure is not counted as red evidence.
- After implementation: **38/38** focused real ReactDOM tests passed, including 31 settings tests covering discovery loading/error/retry, stale results and origin/credential/manual-tuning contracts, plus 7 picker interaction tests.
- TypeScript and scoped ESLint exited zero. Playwright discovery lists **6** new scenarios: light/dark x 1440x900, 1024x768, 390x844. Existing ai-issues/workspace model-selection steps were updated without weakening metadata assertions.
- New browser scenarios exercise loading/failure/retry, 40 synthetic models, long names, mouse-wheel containment, keyboard selection, modal/page scroll bounds, no horizontal overflow, Escape/Tab and manual-tuning preservation. They emit collapsed/loading/open/scrolled/failure screenshots under visual-evidence/model-picker.

## Remaining verification

No browser was launched locally: this cloud environment's browser EPERM limitation is already known. Windows browser execution, actual screenshots and visual review are **pending**; discovery is not browser verification. Touch hardware and screen-reader execution are not claimed. The fixture models are synthetic, not evidence of a live provider call. Parent owns independent review and serial full-suite gates.

Connection test protocol remains the current upstream implementation; the low-budget staged probe/feedback is a separate, unimplemented batch. No production service, saved configuration or external API was touched.

Known bounded limitations: the picker does not implement type-ahead search. It is not designed for an in-place models-array shrink while open; this settings integration clears modelList before fetching, unmounting the picker, and recreates it for the new result. Neither limitation is represented as completed functionality. No broader behavior was added for unreachable prop transitions.

## Frozen candidate serial gate

Full single-worker Vitest run: **105 files passed; 1083 tests passed, 2 skipped (1085 total)** in 109.89s. This is the full mixed unit/DOM/HTTP/filesystem suite, not a strict-unit-only coverage claim. Vite build passed (672ms); the existing >500kB chunk-size advisory remains. The suite printed jsdom's `Not implemented: navigation to another Document` warning; no test failed. SHA256 of all five changed production files matched before/after this run and build. Windows/browser visual evidence remains pending.

## Dark trigger cascade correction

A post-gate review found the general dark button rule overriding the 44px settings trigger rule. A new jsdom computed-style test loads every CSS import in the real main.tsx order: before correction, light passed at 44px while dark failed at 32px. Adding min-height:44px to the existing higher-specificity dark picker-trigger rule restores both modes without changing authored-content exclusions. Forty focused tests, types and scoped lint passed; six browser cases were discovered. Each browser case now also checks every option's bounding height >=44px, alongside its existing trigger-height assertion. This computed-style test is not browser layout evidence. No full mixed rerun or Windows screenshots are claimed for this CSS/test-only correction.

## First exact Windows result and fractional scroll repair

Remote 118f9aea passed 769 mixed tests in all four Node22/24 fork/upstream jobs, but each browser run passed48/49: light390 list bottom840.3125 exceeded body bottom840. All five other picker scenarios and original43 browser tests passed. The artifact contains error context but no trace or actual scroll-range values, so Windows maximum-scroll saturation was not measured. The settings DOM has normal-flow controls after the picker.

Two real-component regressions model rounded/clamped scrollTop with available local range and dynamic fractional rectangles. Both fail before correction (7 other picker tests passed). Rounding each necessary reveal delta toward visibility fixes both, without changing page scrolling or subsequent option-cursor/body behavior. Final full-candidate42 focused tests, types/lint and6-case discovery pass. The strict browser geometry assertion is unchanged and now includes actual scrollTop/max diagnostics if it fails. This is a candidate fix pending fresh exact Windows validation, not a claim that the old run passed. No retry/timeouts or geometry tolerance was loosened.
