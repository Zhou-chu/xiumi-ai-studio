# HTML selected-text controls, stage 3 candidate

Based on cloud candidate `d710e77`. This is a new reviewable cloud increment, not recovery of the offline desktop's uncommitted work. It is not published.

## Scope

HtmlEditor gets font/size and B/I/U controls plus the existing ColorPicker. Only selected text is eligible: collapsed/outside ranges are disabled, saved HTML must still match, the original endpoint nodes must remain in the connected current editor, and the range must stay within a single text/cell region. Replacing nodes with identical HTML is stale too. Selections touching SVG (including foreignObject) or crossing/containing separate table cells are refused rather than reconstructing graphics/table structure. Ordinary images and links inside a supported text selection are retained in the cloned fragment. The source helper never mutates the live DOM.

Font and size changes use validated values and native insertHTML; B/I/U and color use native editing commands. This retains the browser transaction mechanism needed for undo/redo, but native behavior still requires the pending browser gate. Unsupported commands report failure without claiming success. The existing Canvas sanitizeHtml/storedHtml commit and export path are unchanged; no sanitization bypass is added. Right-panel HTML slot colors, SVG fill/foreignObject color behavior, replay, fragment collection and AI selection policy are untouched.

## Color semantics

The optional ColorPicker resetLabel prop defaults to its original label, so existing callers do not change. HTML's action is explicitly labelled **使用当前模板正文色**. It writes the current document theme's text color to the selected text; it does not clear ancestor color history, revert to the original imported appearance, or create future theme inheritance. Later theme changes preserve that explicit work color. No removeFormat command is used to erase unrelated font/size/B/I/U. Theme, common and custom swatches reuse the upstream picker, including Escape handling.

Controls and hints use scoped >=14px typography and wrap on mobile. UI is outside contentEditable and is not stored/exported. HtmlEditor's Done action now supports keyboard click activation.

## Validation and remaining gate

- Pure DOM fragment suite: initial 2 failures / 2 passes, then passing implementation; final 6 cases cover structure, injection, cross-cell/SVG rejection and image/link preservation.
- Component suite: 13 cases failed against absent controls, then passed; two additional ColorPicker semantics/Escape regressions give 15. React is real; native execCommand/queryCommand APIs are mocked in jsdom. These are component/DOM integration checks, not evidence of actual browser undo or strict-unit coverage.
- Focused new and existing typography/color suites: 34 passed.
- Full configured mixed suite: **88 files / 912 passed / 2 skipped / 914 total**. Skips remain Windows-only case-alias checks.
- TypeScript, changed-file ESLint, build and whitespace checks passed. Build retains the pre-existing >500 kB chunk warning.
- Playwright discovery finds four new real-browser scenarios: native undo/save/export, B/I/U/color, table/stale boundaries, and phone/replaced-node/SVG/template-color behavior. **None ran locally** because cloud browser launch is already blocked; no redundant launch was attempted.
- Actual font glyphs, mobile geometry, native selection/undo timing, persistence through browser actions and production packaged HTML guard interactions still require Windows CI/live verification. No screenshots or browser-pass claims are made.
- Two new production TS/TSX modules must enter full-source coverage; no coverage percentage is claimed. Tests use .test.ts/createElement and are discovered by the existing pattern; no silent TSX test exclusion.

## Pre-insertion security follow-up

A malicious cloned-link/image case failed before the extra boundary and passed afterward: entity-encoded javascript href and onerror attributes are removed before native insertHTML, while the local image URL survives. selectedTextStyle now reuses the existing guardHtml/DOMPurify policy before returning its fragment; the policy itself is unchanged. Final new helper/component checks: 21 passed. Full mixed, types, lint and build were rerun on this final production source and passed with the counts above.

### Browser assertion strengthening (test-only follow-up)

The HTML color scenario now compares alpha's actual computed color before coloring, after applying #123456, after undo (exact original color), and after redo (exact rgb(18, 52, 86)); it no longer relies on the absence of a hex serialization. The phone scenario compares alpha's computed color with the current fixture theme's text color normalized by the browser. Structure/save assertions and timeouts are unchanged. TypeScript/lint and discovery are checked; these browser scenarios remain unexecuted locally. Production source is unchanged, so the final six-helper-case / 912-passing mixed count above remains the last full measurement, not a claim of a new full run.
