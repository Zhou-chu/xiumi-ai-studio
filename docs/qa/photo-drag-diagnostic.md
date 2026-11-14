# Photo swap regression diagnostic only

Based on 763d0dc (combined multi-selection). Remote ef0a9e failed the same existing photo-swap scenario on both Node versions and packaged EXE; 90/91 passed. Five new multi-selection cases passed but do not excuse this regression. Root cause remains unknown.

Only features.spec.ts gains passive capture listeners immediately before its unchanged dragTo and original toast/content permutation assertions. It records at most 120 events plus a dropped counter: dragstart/over/drop/end and mouse down/up, bounded block/photo identifiers, coordinates, elementFromPoint identity, first-three image boxes, scrollTop, transfer types and parsed source block/index only. It never records URLs, image bytes, text, settings, headers, credentials, or raw transfer data. No listener prevents default or changes document/selection/layout. Finally removes listeners and attaches JSON on success or failure. Attachment errors cannot override the original test failure. Diagnostic no-op on production, no product code changes.

Local validation: TypeScript, targeted ESLint, E2E discovery only. Cloud browser remains unavailable; no browser or Windows execution claimed. Existing trace evidence is preserved. Parent will run the exact scenario on isolated Windows runner, without retries or assertion/timeout changes.
