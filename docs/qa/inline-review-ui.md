# Inline proposal review (combined candidate)

## Scope and contract

Based on combination `f4446087730307254e522f059f4407afc7149ef8`, including PR13 proposal projection/safety, selection synchronization, PR9 DOMPurify, responsive shell, typography and image controls. This is not a narrow f0 patch or a change to server policies.

- Original live modules remain mounted. A red overlay marks their entire bounds without intercepting pointers. Full green suggested modules appear below, with readable solid-white work content and a lightly blurred green chrome background. Accept (green) and Reject (red) are explicit 14px controls with 44px minimum height.
- Side-panel item list is removed. Summary, filter-policy explanation, ignored/error counts, accepted/rejected/pending totals, batch actions, preview and close remain. Existing E2E operation-count assertions now count real inline cards; accepted/rejected assertions use the summary totals. Content and policy assertions were not removed.
- Every individual display is one `resolveProposalItems` projection. Its actual inserted identity locates the insertion; no separate validation/rebase algorithm or new ID is used for display. Acceptance always calls the store with the captured proposal identity, not cached HTML. The existing appliedStructure journal, orderInsert, field-stale logic, undo/redo and filter/strict semantics remain authoritative.
- Delete has an explicit no-replacement explanation. Move shows the complete moved module and destination index. Metadata shows full old/new values. Theme shows complete old/new compiled document previews. Missing/stale targets remain rejectable at the article end.
- Overlapping box/child cards are lifted below the enclosing marked original, so the parent's red layer does not tint a green suggestion. Upstream only permits **one box layer** (`tree.ts` and normalization); this patch does not introduce arbitrary nested editing or expand validation policy.
- Preview HTML is compiled and DOMPurify-guarded inside a script-free, pointer-inert iframe. No editable work DOM is copied back. CSP forbids scripts, objects, nested frames and forms; images allow self/data/HTTPS and fonts self/data. ResizeObserver, image load and font readiness update preview height without a fixed maximum clip.
- Tap replay is rendered from a display-only automatic-play copy, then frozen at upstream scene final times by the owning editor. This is explicitly labeled static final artwork. Native original/exports retain their playback configuration. No script permission or link interaction is enabled in the iframe.
- Necessary preview content also has an auxiliary plain-text reading disclosure. This is not a claim of full screen-reader or physical-touch certification.

## Verification

Behavior-first local tests cover pure full projection/history immutability, stale suggestions, actual insertion placement, nested target/delete and move-journal semantics; actual React wrapper node/focus survival, duplicate action history, stale accept/reject, review event isolation and guarded/export-separated content. Separate red/green cases cover parent/child card placement, metadata/theme views, renderer failure isolation and tap replay display versus unchanged export.

The original component node test uses a focused input as the stable child. It does **not** alone prove the full editor: added Windows browser cases separately exercise a real mounted rich editor during proposal creation and typing, and real image controls while a long image/font-dependent suggestion is shown.

Added browser sources: 1440×900, 1024×768 and 390×844 full red/green screenshot evidence; original node identity; keyboard acceptance/undo; 44px targets and page horizontal bounds; persistence without review artifacts; insert/delete; long suggestion/image/font height; original image-resize interaction; real rich-editor preservation and stale typing. These are discovery-only in cloud until Windows CI runs. Existing Windows visual snapshots are unchanged.

Cloud Chromium cannot launch in this environment (previously established socket permission failure). No new browser attempt, screenshot, Windows/EXE test or real-model API claim is made here. Synthetic provider browser fixtures are not live model verification. Full test totals below are a **mixed** suite, not strict unit coverage >90%.

## Remaining validation

Windows full dev, shell and real packaged EXE gates must run on this exact candidate. Inspect actual three-width screenshots, very long suggestions, nested parent/child presentation, responsive focus/scroll and final replay frames. No push, upstream PR, deployment or user DATA mutation is part of this local change.

## Frozen local gate

- Focused review suites: **15 passed**, including recorded red/green cases above.
- Complete Vitest mixed suite: **100 files, 1024 passed, 2 Windows-only skipped** (2026-11-15 UTC cloud run). No strict-unit coverage percentage is inferred.
- Full ESLint and TypeScript: exit 0. Vite production build: exit 0, with the existing >500KB chunk warning.
- Playwright discovery: **84 cases / 28 files**, including seven new inline-review cases. This is discovery, not browser execution. No snapshot baseline updated.
- Display replay additionally strips source-authored `data-review-freeze`, uses per-projection UUID/out-of-band times, rejects invalid or >24-hour preview times, disables looping only in its copy, and reports unsupported SMIL freezing without stopping height measurement. A static code review is not proof of actual Windows tap/loop rendering; the new browser case remains mandatory.
