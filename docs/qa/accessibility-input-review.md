# Keyboard and pointer interaction review

## Scope and implementation

Reviewed the historical Sonar S6848/S6845/S6853/S9379 locations against current UI behavior, rather than treating every event handler as a button.

- Settings profile editing, image/background replacement, asset selection and component insertion have named native buttons. Active-model radios are separately named. Interface/import-mode groups expose selected state.
- Draggable rich previews retain pointer click/drag, but are named groups without a misleading keyboard button stop; a separate native insertion button provides the keyboard action.
- Resizable separators remain separators with pointer capture and arrow-key resizing, expose current/min/max values, and support Home to reset.
- Blocks have a separate named selection button (including unique block ID), with Ctrl/Cmd multi-selection. Article content is not converted to a button. Modifier Enter/Space is explicitly handled without duplicate default activation.
- Fragment collection has keyboard candidate navigation using the existing fragment boundary logic. Explicit entry moves visible focus; explicit completion returns focus. Switching blocks does not cause the old editor to steal focus.
- Image deletion uses click activation rather than mouse-down-only activation. Toolbar icon buttons have descriptive accessible names.
- Rich-text import is a named multiline textbox. Dialog focus cycling includes editable regions and excludes hidden/inert, disabled, and contenteditable=false targets, retaining nested-dialog isolation.

## Reviewed handlers that are not independent controls

The click handlers on BlockTextEditor/RichEditor wrappers, Canvas editor/picker/error wrappers merely stop propagation. They have no independent activation action and should not acquire button roles or extra Tab stops. Canvas background deselection has Escape as its keyboard equivalent. Modal backdrop dismissal has a named native close button and Escape; the backdrop should not become a Tab stop. Contenteditable article regions remain editable text, not buttons. The explicitly invoked text editor retains intentional focus management rather than indiscriminately removing focus behavior to silence autofocus warnings.

No authored article HTML, document serialization, or exporter code was modified. Additional controls remain outside rendered article DOM.

## Evidence and limits

New tests first reproduced missing native controls, modifier-key activation, focus stealing, and editable-region focus-loop omissions. Existing behavior assertions remain intact. Older tests selecting any aria-label containing 正文 now explicitly target the textbox role, because the new module selection button legitimately also names its block type.

Browser validation uses only disposable data, synthetic settings/media, dedicated 5373/5374 ports, and a separate Vite cache. Touch testing is Chromium touch emulation, not a claim about physical devices or a screen-reader audit. `visual-evidence/accessibility/canvas-phone.png` shows the 390px touch selection control with a valid synthetic image, after save completion and without transient notices.

## Verified result

- Targeted DOM/unit tests: 69 control tests plus 30 Canvas/dialog tests passed (99 total).
- Browser: 22 keyboard/selection/model-picker/drag/save/export/editing tests passed; the 17-test responsive suite also passed (39 total), including light/dark phone and tablet layouts.
- Scoped ESLint and full TypeScript checking passed.
- The first browser pass exposed real modifier/focus/name issues, which were fixed and rerun. The final runs do not rely on increased timeouts, retries, skipped assertions, or fake API-success states.
- Physical touch devices and assistive-technology speech output remain untested. Whole-repository coverage and full CI are integration responsibilities, not claimed by these targeted runs.
