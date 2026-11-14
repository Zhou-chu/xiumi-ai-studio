# Isolated combined candidate after dark 44px correction

Base abfa68d. Clean ordered cherry-picks: e796bc6 article collection, 8e38b8c model picker, ab0bcac model dark44 cascade,4559806 controlled HTML theme/layout. No conflict hunk required manual selection. Existing CAS/ApiError, strict/filter/subtree/anchors, proposal journal, replay, text/image controls and native photo-gesture regression remain. No dependency/lock changes. Normal workflows retain all execution stages; only model-picker artifact path added.

Static cross-check: RightPanel collectionOpen synchronous ref aborts/suppresses pending suggestions and documentEpoch rejects edit/undo ABA; suggestion-only redaction does not affect edit context. HTML theme/layout adds exact whole-original-HTML stale checking while preserving existing independent text-slot merging. New route uses existing wrapper and shared image pipeline; no existing fetch/net route replaced. AI prompt changes limited to HTML capability and known themes, no fork insertion semantics.

Production source additions9: articleImages(server/client),cssImageUrls,ArticleImageImport,suggestionContext,ModelPicker,htmlTheme,htmlLayout,htmlUpdateValidation. Current complete src/server inventory354files,138TS/TSX (no d.ts), source SHA256 identical before/after gate. This inventory is not a coverage percentage or strict-unit claim.

Final production-source gate: full ESLint/typecheck pass; focused8files119tests pass; complete mixed111files1151passed+2platform skipped in114.15s. Build pass with existing500KB chunk warning. Actual dev discovery101cases/33files (old91+image2+HTML2+models6). Cloud browsers not launched. No real CDN/LLM or credentials touched.

After full gate, evidence-only changes capture collection confirmation/partial state and HTML before/review/after/undo to testInfo.outputPath with attachments, and retain visual-evidence/model-picker in package always/CI failure artifacts. Final types/targetedlint/discovery passed; production hashes unchanged, so full mixed not repeated. Existing assertions/timeouts/retries unchanged.

Cross-feature evidence limits: existing authored E2E covers selection→collection and separately HTML→inline preview→accept→save/reload/export. No single scenario yet runs collection followed by theme/layout on the same selected HTML document. Separate passes are not proof of that combined lifecycle. Browser assets/import service is mocked in these E2Es; service HTTP/FS tests use controlled boundaries. Full new-SHA Windows Node matrices, actual packagedEXE, screenshots and the cross-flow gap remain for parent verification. No publishing, main/upstream merging or deployment performed here.

## Authored continuous cross-feature regression (pending Windows execution)

Added one real-page scenario after the production gate: Ctrl-select an HTML block plus native image; natural-language local collection confirms two scoped URLs with zero aiEdit calls and unchanged saved blocks; then generate a synthetic HTML chapters proposal on that same selected union, accept through the real inline review, wait for saving and reload, asserting original text/image URL plus the independent image block unchanged. Screenshot attached after reload. API/provider boundaries are explicitly synthetic; this is authored integration coverage, not yet observed browser success. Final discovery102cases/34files; full production source hashes still identical. No test assertions/timeouts/retries were removed.

## Picker fractional scrolling follow-up, new production gate

Before publishing, incorporated reviewed591dd54 as52d293f: reveal scroll delta rounds upward to avoid integer-scroll rounding leaving part of the model list clipped. Original strict browser geometry assertions remain unchanged; added actual scrollRange diagnostics. This is a new production snapshot; earlier1151 mixed pass is historical, not reused as this gate.

Final serial gate on corrected source:111files/1153passed+2platform skipped (1155total),114.88seconds; complete ESLint/TypeScript and build passed, existing large-chunk warning retained. All354src/server file hashes exactly match before/after. Production denominator remains138TS/TSX,9 additions versus base. Continuous E2E remains authored only pending new Windows/full portable execution; neither the previous PR17 failure nor jsdom red/green is treated as Windows proof.

## a423 Windows evidence and footer locator correction

Exact a423fb11512a39cbf83c64839ec5ee2053c5aa95 completed both Node 22.19/24 jobs: 111 files / 1155 mixed tests passed each; browser suites each reached 99 passed / 3 failed of 102. Actual packaged EXE verifier passed 25 checks, then also 99/102 browser cases. All three failures were the same ambiguous close locator: the accessible header and footer both correctly expose 关闭. The corrected tests select the exact footer action via `.modal-actions`, retain both product controls, all screenshots and all original behavior assertions. The React component regression proves the footer is unique and closes without import. No production source changes, timeouts, retries, skips or scope reductions.

All six model-picker cases and both HTML layout cases passed in the original a423 EXE run; their actual screenshots and failed-case traces are preserved. The continuous collection→HTML scenario stopped at close, so its later steps remain unverified until the next Windows run. Shell stage did not run after dev E2E failure. The correction is not a claim that the complete suite now passes.
