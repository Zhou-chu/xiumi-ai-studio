# Article images to asset library

The AI design input recognizes explicit Chinese image-library requests (including the reported “帮我把原文中的图片加入我们自己的素材库”) and opens the local collection confirmation. This is a deterministic local command, not a general LLM tool-calling agent. A direct collection button is also available, including when no model is configured.

## Guarantees
- Uses the selected module or whole-document scope, including nested image references, HTML images/backgrounds, and whole-document cover.
- Lists candidates before any network request. Does not change article content, undo history, or selection, and does not send image data to an LLM.
- Only existing local assets and the established WeChat/Xiumi image host allowlist are supported. Existing safeFetch redirect, private-network and size protections remain in force.
- Persists canonical source URL for idempotent retry. Shows per-image imported/existing/failed results; retries only failures.
- Closing stops unsent requests. An already-started request may still save one image; reopening/retrying recognizes its stored source URL.
- Asset index read/modify/write is serialized, fixing loss of entries during concurrent uploads.
- Other instructions included with a collection command are not silently executed; original input remains available.

## Validation
- Unit coverage: command routing/negation, selected scope, HTML extraction, immutability, host/protocol restrictions, per-image failure, concurrent source deduplication, concurrent asset indexing.
- Browser coverage: exact reported command without model access, confirmation before requests, selected scope, unchanged article, actual local upload/import API, blocked host, partial failure/retry, close before confirmation, close during a pending request.
- Remote CDN success is tested with injected fetch responses, not claimed as an authenticated or live WeChat download verification. A remote image may still be unavailable due to its source permissions, expiry or network restrictions; the UI reports failure rather than fabricated success.
