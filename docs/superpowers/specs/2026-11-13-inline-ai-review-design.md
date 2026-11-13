# Inline AI review design

Replace the side-panel operation list with small numbered markers beside the corresponding article content and one expanded review bubble. The user explicitly chose in-document accept/reject and delegated implementation details. Always-expanded cards would obscure the article; a fixed bottom list would lose the requested spatial relationship.

Markers target HTML text slots when their baseline structure/text still match; otherwise use honest block-level anchors. Remove/move attach to the block, insert to the neighboring boundary, metadata/theme to the article heading. Multiple operations may share a marker; only one bubble is expanded. Before/after text remains plain text, with reason, accept/reject and previous/next. Compact preview/batch/close controls remain outside the sidebar list.

The overlay lives outside .phone/.article so article zoom, serialization and export cannot include it. Recompute coordinates on scrolling, resize, zoom and content/font/image layout changes. Keep the bubble within the visible canvas, use nearby vertical placement on narrow screens, hide detached/offscreen anchors, and retain keyboard focus and accessible names. Selecting review from a folded side panel must reveal the canvas.

Safety: accepting is idempotent and validates the original targeted fields/HTML slot identity against the current document. Stale changes are explicit, never silently applied or labeled user-rejected. Independent fields can proceed; conflicting operations cannot overwrite accepted/manual edits. Batch acceptance uses one history commit. Undo/redo closes the now-outdated review explicitly. No new model call is needed to validate this UI.
