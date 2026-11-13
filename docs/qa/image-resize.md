# Direct article image resizing

## Maintained feature contract

- Click a movable article image to reveal a bottom-right resize handle and percentage label.
- Drag horizontally to resize proportionally within 10–100% of its existing layout cell. Original source dimensions and URLs are retained. No raster resampling is performed.
- Pointer events support mouse, pen and touch; coarse-pointer targets are 44px. Arrow keys change 1%, Shift changes 10%, Home/End set bounds. Escape cancels an in-progress drag.
- A completed drag is one history entry. Undo/redo, autosave and reload use the persisted width. Imported HTML stores inline image sizing; native image and kit blocks store `ImageRef.displayWidth` and compile it to inline HTML.
- Controls are siblings outside the article, never document nodes or export content. Preview mutations are restored before committing. Stale document/block changes cancel the gesture rather than overwrite newer edits.
- Existing movable image coverage: image, imageText, profile, cover, frame, gallery, photos, carousel, and non-decorative HTML image slots. Background images, decorative images and QR slots are intentionally excluded. This is proportional resizing, not cropping or free distortion.

## Regression evidence

`tests/unit/image-resize.test.ts` tests compiler output, metadata preservation, bounds, invalid targets, gallery/kit cells and HTML structure preservation.

`tests/e2e/image-resize.spec.ts` runs against a real isolated local API and browser: native and imported HTML drag, API persistence, undo/redo, refresh, keyboard bounds, Escape rollback, Delete protection, and 390px mobile layout. Only the deterministic test image network response is stubbed. No provider success or document persistence is mocked.

Mobile screenshot: generated `test-results/image-resize-mobile.png`. Touch hardware has not been exercised; mobile keyboard and pointer-event implementation are not equivalent to a physical-device touch acceptance test.

## Remaining release gates

The feature has no independently measured 90% coverage report yet (coverage provider is absent from the current baseline). Full integration coverage and interaction with the concurrently changing inline AI review and text-formatting features must be checked by the integration gate. Do not treat passing behavior tests as a numerical coverage claim.
