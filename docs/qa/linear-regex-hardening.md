# Linear regex hardening: batch 1

Baseline: 1e1d78e. Six original S8786 findings addressed: ai.ts old lines 22/153/195, aiModels.ts 78, settings.ts 140/162.

Trailing-slash replacement uses a backwards ASCII slash scan. Fenced JSON extraction uses first delimiter offsets and trimStart, retaining first-block/language/fallback semantics. No prompt, generation budget, deadline, protocol, or credential changes.

Red evidence: real chatText on 200,000 non-trailing slashes and chatJson on an unclosed fence followed by 400,000 whitespace characters both exceeded the independent child-process 5-second deadline. Processes were terminated by spawnSync timeout. Initial 200,000-space fence completed in roughly 4 seconds; the larger bounded case confirmed the regression. Seven ordinary endpoint/extraction cases passed before production edits.

Green: 101 tests across eight AI/settings suites; typecheck and focused ESLint pass. New tests include line terminators, empty suffixes, first-fence and JSON-language boundary behavior. Both hostile-input subprocesses now finish within the deadline. No network calls: fetch is substituted in tests. Full-suite/coverage/browser validation deferred to integrator as requested, not claimed passed for this patch.

Remaining S8786 findings outside this batch require separate semantic and worst-case review. Legacy issue count is not a count of exploitable defects.

## Batch 2: text tag spans and CSS numbers

Six further original findings: importer.ts 9, exporters.ts 54, old ops.ts 166 (now operationDescriptions), fragments.ts 56/63, wxImport.ts 223. Text-only legacy tag-span removal now uses delimiter offsets; it is explicitly NOT a sanitizer. Empty <> and unmatched < tails retain original output. Pixel grammar uses disjoint integer/decimal alternatives rather than two overlapping digit repetitions; accepted units/signs/rounding remain unchanged. Number.parseFloat spelling is only an equivalent namespace clarification, not a functional bug claim.

Red: real htmlToMarkdown with 200,000 unmatched '<' characters and horizontalInset with 200,000 invalid digits each exceeded a 5-second child deadline. Green: both bounded cases pass, 157 targeted tests pass; typecheck/focused lint pass. Exhaustive four-character alphabet strings through length seven compare tag removal including replacement spaces against the old semantics. No full-suite claim.

## Batch 3: whitespace, names and bounded highlights

Four unbounded expressions replaced: slots.ts old301, old ops.ts32 (now htmlUpdateValidation), styleExtract.ts23, AiSettingsModal.tsx141. Unchanged expressions were first characterized through extracted helpers; each of three 400,000-character no-match cases exceeded the 5-second child deadline before replacement. Deterministic 3,000 mixed-delimiter samples retain historical output. The name parser preserves the first matching line and greedy last closing full-width parenthesis.

Outline QTY (old119) retains its exact expression but now checks the preexisting 6–39-character eligibility before regex evaluation. Real parseArticle section-path input of 200,000 digits exceeded the child deadline before this change and completes afterwards. An initial intro-only test did not reach the section highlighting path; it was corrected before claiming red evidence.

95 affected-path tests plus typecheck pass; 33 combined new regression tests and focused lint pass. Child tests now separately measure algorithm execution after imports (1,500ms budget) and bound the whole child at 15 seconds, so slow cold module loading is not conflated with regex execution. The original known-bad cases already exceeded 5 seconds of total time and remain well outside the algorithm budget. No full-suite claim.

## Batch 4 and complete original-issue map

Seven editorial grammars were characterized against the old expressions, then each demonstrated a bounded child timeout before replacement. Linear scanning preserves first-match, greedy/lazy delimiter choice, quote source length, Unicode line terminators, and exact fraction separators/zero padding. A 5,000-case deterministic legacy-output comparison caught an early quote-parser error involving newlines inside separator whitespace; the implementation was corrected, not the assertion weakened.

Two adjacent outline image-syntax expressions (Markdown detection and image removal) used the same dangerous pattern before/after the flagged extraction. Both separately timed out before replacement and now share the delimiter scanner while preserving their broader grammar (whitespace-only image body counts as syntax but not a usable extracted URL).

Two findings were not reproducible as super-linear at their actual call sites: compiler space alternatives already consume all 2+ runs before the trailing alternative; cleanText normalizes every ASCII-space run to one space before trimming around newlines. Both 200,000-space public-path characterization tests passed BEFORE changes. Equivalent explicit simplifications were made for clarity, not claimed as vulnerability fixes. Compiler now matches each space run once and checks its position; cleanText uses bounded optional single spaces after normalization.

All 14 legacy S7773 issues' paths were reviewed and remaining global parseInt/parseFloat calls changed to Number.parseInt/Number.parseFloat. This is an equivalent naming clarification, not an observed behavior bug. Multiple original issues can share a source line.

### Original S8786 locations (revision 5018a4e)

| Original location | Current action / evidence |
|---|---|
| server/ai.ts:153 | Linear trailing-slash scan; real chatText hostile endpoint red to green |
| server/aiModels.ts:78 | Same trailing-slash helper; model-list regression suites |
| src/core/slots.ts:301 | Whitespace runs containing LF only; exact mixed-whitespace comparisons |
| server/ai.ts:195 | Same trailing-slash helper; Anthropic protocol tests |
| src/core/compiler.ts:86 | Already constrained by earlier alternative; explicit one-pass space replacement; public old/new output tests |
| src/core/assemble.ts:37 | Same-line 3-letter run and separator detection; long absent separator red to green |
| src/core/assemble.ts:125 | Digit-run fraction parser; exact separator and total-width preservation |
| src/core/copy.ts:37 | Hash/whitespace heading scanner; failing Unicode-line-boundary long input red to green |
| src/core/copy.ts:48 | Short quote scanner preserving 1–2 dash choice and <=30 UTF-16 source length |
| src/core/copy.ts:103 | Two-sided punctuation scan; long interior punctuation red to green |
| src/core/fragments.ts:56 | Disjoint integer/decimal pixel grammar; public horizontalInset red to green |
| src/core/fragments.ts:63 | Same disjoint pixel grammar for border-width token selection |
| src/core/wxImport.ts:223 | Same signed pixel grammar; retains bare zero and invalid-value behavior |
| src/core/ops.ts:32 | Moved to htmlUpdateValidation; LF-containing whitespace-run helper, NOT removed by DOMPurify |
| src/core/slots.ts:64 | Already bounded after whitespace normalization; explicitly optional single spaces |
| server/ai.ts:22 | First-fence delimiter offsets and trimStart; public chatJson red to green |
| server/importer.ts:9 | Linear legacy tag-span deletion; malformed text preserved; NOT a sanitizer |
| server/settings.ts:140 | Linear trailing-slash helper, retains prior trim order |
| server/settings.ts:162 | Linear trailing-slash helper, does not add trim |
| src/core/exporters.ts:54 | Same legacy tag-span helper; retains prior line-break/entity pipeline |
| src/core/ops.ts:166 | Moved to operationDescriptions; same tag-span helper with space replacement, NOT removed by DOMPurify |
| src/core/outline.ts:119 | Existing 6–39 character eligibility checked before unchanged QTY expression; real section-path red to green |
| src/core/outline.ts:170 | Linear image delimiters; adjacent detection/removal also fixed and tested |
| src/core/outline.ts:176 | First valid double-dash quote split including multiline source semantics |
| src/core/styleExtract.ts:23 | First !important offset plus preceding trimEnd; exact case sensitivity retained |
| src/editor/AiSettingsModal.tsx:141 | First matching line / greedy full-width parenthesis scan; preset UI behavior tests |

Summary: 23 original expressions replaced with linear equivalents; 1 bounded by existing eligibility; 2 already-constrained contexts simplified equivalently. This is NOT a claim of 24 remotely exploitable vulnerabilities, nor a new Sonar analysis/issue resolution. No unresolved original S8786 code location remains in this local mapping. New production modules urlText, textLinear, editorialText must all remain in full-source coverage and scanning.

Final batch verification: 196 targeted tests across 12 suites, TypeScript and focused ESLint passed. Full-source coverage, full E2E, live API and Sonar candidate analysis remain the integrator's serial gate, not claimed here.

Additional final boundary verification: all five new regression files passed (46 tests), followed by four extra quote/heading/fraction/nested-image table tests; final editorial file 15/15 passed with focused lint. Final added-test count is 50. These extra cases explicitly check 29/30/31-character quote sources, whitespace-only headings, Unicode line separators, nested malformed image prefixes, and fraction zero padding.
