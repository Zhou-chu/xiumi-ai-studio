# Imported HTML theme adaptation

## User-visible behavior

An explicit AI request to restyle an article can now propose `update` with a known `themeId` for each imported HTML block, alongside the document `setTheme`. Merely changing the document or application theme does not mutate imported content.

The local transformation harmonizes chromatic inline/SVG colors and normalizes heading/body typography. It preserves text, DOM layout structure, links, image URLs, tables, code typography and SVG geometry. Text-slot edits can accompany the same proposal. Review remains opt-in: preview, accept, reject, undo and stale-proposal protection use the existing pipeline.

## Safety and limits

- Model-supplied arbitrary HTML remains rejected; output is calculated from the current trusted fragment.
- Unknown theme IDs are rejected. This first implementation supports registered built-in themes, including Tsinghua purple.
- Any manual HTML edit after a theme proposal makes that proposal stale, avoiding overwrite of newer text or styling.
- This is safe palette/typography adaptation, not arbitrary structural redesign. Raster artwork is not regenerated or recolored. CSS named colors, external styles and embedded image artwork may retain original colors. These limits must not be described as complete visual regeneration.

## Verification

New unit tests cover transformation, text/media/table/link preservation, SVG/code preservation, invalid input, slots plus theme, non-mutating preview, accept-once, rejection, exact undo, stale text/style edits and model instructions.

Commands: `node node_modules/vitest/vitest.mjs run tests/unit/htmlTheme.test.ts tests/unit/htmlTheme-ops.test.ts`, `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.

Desktop real-model calls, integrated browser review/export/save-reload and overall coverage gates remain integration-gate checks, not claimed by these unit tests.

## Controlled structural reconstruction (2026-11-13)

`update` can additionally request `layout: "editorial" | "chapters"`, with an explicit valid `themeId`. Editorial creates an ordered sequence of separated sections; chapters groups original nodes under their existing headings. This rebuilds the DOM structure, not just its palette.

Only plain div/section/article/main wrappers with known cosmetic inline styles are flattened. Original text nodes and content elements are moved in source order. Tables, SVG, unknown containers, class/ID-dependent containers, background-image and positioning structures remain intact opaque islands. The proposal reason reports how many opaque islands retained their internal structure. An entirely opaque fragment is rejected with an explicit explanation instead of claiming it was rebuilt. External/CSS-dependent layouts therefore are deliberately not universally supported.

Before returning output, exact text content, ordered source/link/media attributes and serialized opaque islands are checked. No arbitrary model HTML is used. Standard preview, accept/reject, exact undo and full-HTML stale checks apply. Export uses the normal sanitizer/compiler, with inline layout styling.

Verification added: actual nested-wrapper reconstruction; two chapter groups; text/link/image/alt retention; table/SVG/background structure retention; wholly opaque refusal; invalid layout refusal; proposal preview/accept/undo/export and stale protection. Browser integration test uses a synthetic provider response explicitly, but real UI and project persistence. Live paid-provider behavior is a separate integration gate.

### Verified isolated gate

- 58 unit-test files / 483 tests passed; changed-file ESLint, TypeScript and production build passed.
- Desktop Chromium: actual AI instruction control → synthetic provider operation → review acceptance → visible two-chapter DOM → real API persistence → reload: passed twice.
- Same 1440×900 viewport/content screenshots: `visual-evidence/html-layout-before.png` and `visual-evidence/html-layout-after.png` (local evidence, not a real-model claim).
- Dedicated test command: `node node_modules/@playwright/test/cli.js test -c playwright.html-layout.config.ts` (ports 5773/5774).
- Integrated red/green review renderer, real model output and overall >=90% coverage remain the main integration gate's responsibility.
