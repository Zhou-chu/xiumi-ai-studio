# Native filled image frame backup

`upstream-filled-frame.zip` was written by the unmodified upstream
`550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe` production app. Synthetic 16×12
images were uploaded through `POST /api/assets`, the editor's `assetRef` and
`createBlock('frame')` made the original native records, and the project was
written via PUT. A version written via `POST .../versions` uses a different
image and frame layout. The response to `GET /api/data/backup` is stored here
unchanged. It contains only synthetic project/history/images and the usual
upstream metadata. SHA-256:
`eae558e2e4e6d22fd647edcb490ee03be2b13ad5d59a9fd8831b59ecaee30552`.

The restore test verifies the existing image opt-in, preview without writes,
confirmed restore, exact reopened layouts and captions, and byte-identical
assets served using the restored generation-pinned URLs. Both frames then
render through the ordinary compiler; the Markdown export keeps the
archived caption punctuation literal. The circuit frame's photo is referenced
only by history, not by the live ticket frame.
