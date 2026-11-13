# Diffused monochrome surfaces and collapsible model picker

## Requested changes

The supplied screenshots showed an always-open native model listbox, blue selection, and large flat black areas. This refinement keeps the black/white editorial language while making the model list a deliberate disclosure and adding broad, neutral black/gray diffusion to the surrounding application surfaces.

## Implemented behavior

- Model results are collapsed by default; the trigger opens and closes the list. Selected model metadata and manual model entry keep the existing behavior.
- A bounded internal scroll container handles long lists. Selection closes it and restores focus; Arrow keys, Home/End, Enter/Space work. Escape closes the picker before the dialog; Tab and outside clicks dismiss without stealing focus.
- Wide grayscale radial gradients are limited to application backdrop, workspace surroundings, overlay header and settings gutter. The form column, inputs and authored article remain opaque and stable.
- Overlays use 20px corners, restrained edge light and a 6px backdrop blur. No colorful glow or glass effects are applied to document content.
- Selected options, native checkbox/radio accents and keyboard focus use the monochrome palette. Reduced-transparency and forced-colors fallbacks remain available.

## Evidence

The three viewport sizes are 1440x900, 1024x768 and 390x844. `visual-evidence/diffused-gray/before` and `visual-evidence/diffused-picker/after/settings-*` show the built settings dialog with the same synthetic form. `built-styles.json` records actual computed gradient, radius, blur, opaque form/article and overflow checks. `picker-{1440|390}-{open|scrolled}.png` uses an explicitly synthetic 40-model discovery fixture to exercise the real picker; it is not a claim that the user's provider returned 40 models.

Only the isolated preview at http://127.0.0.1:5176/ is updated. No production 5174 replacement, credential copying, new external model requests, PR creation or merge is part of this refinement.

## Final verification

Final local verification: pnpm check passed (431 unit tests, lint and TypeScript); production build passed; pnpm e2e --update-snapshots=none passed all 69 tests in 4.8 minutes. Independent code review found no blocking issue. All three local endpoints 5174/5175/5176 returned HTTP 200. Physical touch devices, screen readers and Firefox/Safari remain unverified.

The preceding remote commit d8e1bcd had 66/67 E2E passes: a beforeEach resource button never appeared after successful navigation. Its artifact lacked a screenshot or trace, so the root cause remains unproven. Retain-on-failure tracing and failure screenshots are now enabled without changing timeouts or adding retries. A local passing run is not a claim that this intermittent remote startup failure is resolved; the new push must be checked separately.
