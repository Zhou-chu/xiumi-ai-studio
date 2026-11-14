# Inline review visual-fixture correction

The first green Windows candidate used literal `<p>…</p>` strings as stored paragraph content. That is not the RichText storage schema: startup repaired the fixture and the screenshots showed literal markup and a repair toast. The first screenshots also used an implicit time-dependent light shell. Those runs proved their actual behavior assertions, not clean Chinese dark-design acceptance.

This test-only correction uses shared Chinese fixture text and `createBlock` + `textToRich`, with a focused normalization/idempotence regression. The original malformed fixture failed this test; the corrected fixture passes. E2E checks the persisted blocks, complete original text, absence of literal markup and absence of the repair notification before reviewing.

The full combination explicitly selects existing `xiumi-color-mode=dark`, asserts `data-color-mode=dark` and the editorial shell's `--bg:#141414`, waits for both documents' font readiness and the complete suggestion height, and records 1440/1024/390 screenshots plus full original/suggestion pair captures. It introduces no theme implementation and no document-theme changes.

The narrow candidate shares valid content and readiness checks but does not select/assert the absent PR8 dark shell. Existing responsive/image-control capability gates remain. No source production code or replay behavior is modified here; the separate original-canvas replay investigation is not addressed by this fixture correction.

Browser snapshots remain pending a new Windows run. Cloud regression/discovery does not prove the new screenshots exist or look correct. No snapshot assertion, timeout, retry or existing behavior check was removed.

Local integration result after original-canvas replay patch `81680a5`: full lint/types/build passed; complete mixed suite **102 files, 1027 passed, 2 platform skips**. Playwright discovery **86 cases / 29 files**. Existing >500KB build warning remains. No fresh Windows screenshot or browser execution has yet been observed for this corrected candidate.
