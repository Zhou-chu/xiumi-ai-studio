# Sonar-informed security follow-up (in progress)

The public SonarCloud project `Zhou-chu_xiumi-ai-studio` last analyzed main
`5018a4eb1e7a7edb00332ed247f591e18a824b55` at 2026-11-13T16:37:11Z.
This is not the integrated `ac86d8e` candidate. Its Quality Gate is `NONE`
with no conditions, not passed; no coverage measure is present.
The legacy issue inventory is 24 bugs, 6 vulnerabilities and 68 code smells.
The agreed release criterion is overall Maintainability A, verified security
and reliability resolution, Quality Gate pass, plus independent CI full-source
coverage greater than 90% in all four V8 metrics. No main merge is justified
by the old report or by a new-code-only PR gate.

## Verified local follow-up

- AI protocol refactor preserves provider credential/header boundaries,
  redirect rejection, budgets, deadlines and bounded retries. Independent
  review found no protocol regression. See ai-protocol-quality.md.
- Untrusted operation validation now separates validation, mutation,
  selection boundaries and descriptions; fractional positions are normalized
  before proposal anchors, invalid metadata/reasons are rejected. Further
  prototype-name and JSON coercion regression cases were added after review.
- Dynamic API resource IDs: 11 attack cases failed before the fix; strict
  server-compatible ID validation plus encoding now prevents dot segments,
  slashes, query/fragment injection and oversized IDs. 19 API tests pass.
- All four CI Actions are pinned to full commits resolved from the existing
  v4 tags through GitHub's repository API, not guessed hashes.
- DOCX external file access: installed Mammoth explicitly defaults to false
  (lib/options-reader.js and lib/docx/files.js), so the old warning alone does
  not establish an exploitable traversal. The importer now also passes false
  explicitly; a new configuration regression failed before and passed after.
  13 importer tests pass. Three additional real Mammoth ZIP tests pass: an
  explicit true-only positive control reads a temporary synthetic sentinel;
  false refuses the same relationship; actual importFile preserves only
  embedded image bytes and document text. No personal file or network is used.
- LCOV was added as an additional reporter. No production source exclusions
  or thresholds were relaxed, and no scan was uploaded to Sonar.

The intermediate combined state passed 1026 unit tests and measured
S96.84/B91.86/F97.32/L98.33. Later security changes are NOT covered by that
measurement and require another frozen full run. Browser, CI and Sonar
results for this follow-up remain pending. The ac86 preview and original
5174 instance are unchanged.

## Remaining work

- Robust HTML render sanitization for entity-encoded script URL bypass.
- Multipart aggregate allocation limits. DOCX local-file boundary has evidence above.
- Async UI failure/late response handling, including theme save switching docs.
- Current-candidate Sonar analysis with LCOV and an actual computed gate.
  Existing automatic analysis does not accept coverage and does not scan
  independent feature-branch pushes. Repository Actions secrets list is empty.

## Expanded source gate (2026-11-13 UTC)

After the explicitly scoped real-image test timeout adjustment (5s to 30s,
all byte/content/dimension assertions retained), frozen full coverage passed
1128/1128 tests. Production JS/TS now includes all src, server, scripts and
both template generator/runtime files, without business-source exclusions:
S96.90% (10011/10331), B91.86% (7595/8268), F97.41% (2675/2746),
L98.35% (7656/7784). Raw relative file counts and source hashes are in
expanded-source-coverage.json; LCOV is generated in coverage/.

Both complete PowerShell production scripts are separately measured with
Pester 3.4: 20 tests pass, 211/215 AST commands = 98.14%. Its four V8-style
metrics are N/A, not blended or invented. Actual live deployment entrypoints
and identity lookup remain intentionally unexecuted; all system operations
are mocked, temporary file state is real. CI enforces both independent gates.

The application browser suite passed 122/122 with screenshot updates disabled.
The subsequent script-only work does not alter application rendering. Lint,
TypeScript and build pass. Sonar still analyzes the older main revision; new
candidate Sonar/security/reliability closure is pending. Further regex and
keyboard/accessibility review is in progress in isolated worktrees. This is
an engineering checkpoint, not authorization to merge main or a claim of
completed Sonar quality gates.

The same frozen application subsequently passed the real-provider headed
Chromium live gate against the restarted candidate at 5176: DeepSeek
returned actual chapters layout, accepted/persisted/reloaded, followed by
an edit confined to the selected heading. Settings-file hashes before and
after matched. Updated structured evidence: live/model-gate.json.
The initial readiness probe mistakenly requested a nonexistent /api/health
(404); the actual /api/ai/status and full browser flow then passed. This is
not a hidden service failure. Original production 5174 remains untouched.

## Frozen accessibility and linear-parser follow-up

- Complete production JS/TS denominator now includes 116 files across src, server, scripts and templates. All 1,195 tests / 131 test files pass. V8 statements 96.92% (10221/10545), branches 92.05% (7791/8463), functions 97.30% (2707/2782), lines 98.41% (7810/7936). Per-file source hashes and complete counters are in expanded-source-coverage.json.
- Whole deployment-script command coverage rerun: 20 tests pass, 211/215 commands (98.14%); other PowerShell coverage metrics remain N/A, not merged with V8.
- Lint and typecheck pass. Production build passes in an isolated temporary output, preserving the running preview; the existing large-chunk warning remains. Generated output was removed before final lint (linting that temporary minified bundle is not a source-code finding).
- First full run exposed an incomplete CSSStyleDeclaration test double after adding real separator width semantics. Replaced the mock with the real switcher's display style, preserving view/focus assertions; focused 3/3 and full 1195/1195 reruns pass.
- Original 26 regex findings are mapped individually in linear-regex-hardening.md: 23 linear replacements, one existing length bound evaluated first, two already-bounded contexts simplified equivalently. These are not asserted to be 26 exploitable vulnerabilities.
- This local verification is not a new Sonar analysis or Quality Gate pass. The last verified Cloud analysis still targets historical 5018a4e; main/upstream publication remains gated on current-candidate quality verification.

- Browser run: 131 passed, one legacy assertion counted the new selection-control glyph as article text, and two serial successors did not run. The two corresponding empty-article assertions now target `.block-html`, with a separate assertion for the real selection button; no product source was changed. The complete seven-case components file then passed, including both blocked successors. Thus all 134 scenarios have passing evidence for the same frozen product source, but this is explicitly a full run plus targeted rerun, not a claim that the first full invocation passed. Remote CI will rerun the full suite on the exact commit.

- Preview 5176 was rebuilt/restarted at 4f807b2; original production 5174 remains untouched. A headed desktop live gate on the saved deepseek-flash profile passed (10.6 seconds): the real settings connection-test UI reached stage=complete and displayed the final server message, full-document AI returned chapters layout, selected-heading editing stayed in scope, accepting/saving/reloading succeeded. Settings file SHA-256 was identical before/after. No provider mocks or credentials in the report. New evidence is docs/qa/live/model-gate.json and visual-evidence/live-gate-layout.png.

- Exact 4f807b2 remote CI completed with 133/134 browser scenarios passing; all earlier check/coverage/build/deployment steps passed. The remaining test timed out tapping workspace-right. Downloaded trace confirms the mobile context used automatic light mode while that switcher belongs to the dark responsive layout. Commit 3699d6a explicitly initializes dark mode for the dark-layout image keyboard/touch cases; no product source or behavior assertion was relaxed. The entire controls file then passed 6/6 locally. A new exact-commit full CI run is still required after integration.

## Upload-resource hardening candidate 8656eff

- Integrated disk-backed multipart storage and a shared two-request upload/processing admission gate, preserving 30 MiB per file and 64 MiB cumulative file payload per request. Upload deadline is 120 seconds; downstream model deadline remains unchanged. Response disconnect does not release admission before business processing finishes. The independent follow-up verifies explicit 429 connection closure and one-shot parser completion.
- Final full-source unit gate: 1,223 tests in 137 test files pass. All 118 production JS/TS files across src, server, scripts and templates are counted: statements 97.00% (10430/10752), branches 92.19% (7907/8576), functions 97.33% (2740/2815), lines 98.41% (7908/8035). Per-file hashes and scope remain in expanded-source-coverage.json. No business file is excluded to meet the threshold.
- Deployment Pester: 20 passed, zero failed; command coverage remains 211/215 (98.14%), with unsupported metrics reported N/A separately. ESLint and TypeScript pass; isolated production build passes with the existing bundle-size warning. Generated Playwright report/build/coverage artifacts are ignored by ESLint, not production source.
- Full browser regression is being rerun using a hidden independent test runner because execution-connection resets interrupted earlier invocations. Incomplete invocations are not reported as passes. The runner uses isolated ports 5273/5274 and data-e2e, not production 5174 or preview data.
- Last actual Sonar analysis remains 4f807b2 and its Overall Gate is ERROR. Current-candidate reanalysis and exact-commit remote CI are still pending. A 30 MiB upload exceeds the Sonar recommendation of 8,000,000 bytes; capacity hardening must not be described as automatically removing that rule or as a false positive. Payload limits do not cap Sharp decoded image memory, all import processing, or scratch files left after process hard-kill.

- Final complete browser invocation on 8656eff: Playwright HTML report records 134/134 expected, zero unexpected/flaky/skipped, no global errors, duration 408.8 seconds; .last-run.json also reports passed. Windows PowerShell's ErrorAction=Stop subsequently classified a native NO_COLOR warning as a harness exception. The independently parsed full report is preserved by hash and aggregate in browser-gate-8656eff.json; this is not a claim that the PowerShell wrapper exit was zero. No additional browser run was needed or started.

## Resource-budget final verification (66b59e2)

All 1,257 unit tests passed with all 120 production files included; V8 S/B/F/L 97.04/92.21/97.39/98.43%. Complete browser regression passed 134/134 in one invocation (6.6 minutes), zero failed/skipped. Static checks, isolated build, deployment Pester (20 tests, 211/215 commands) and the headed real-provider connection/layout/selection/save-refresh live gate passed. The initial nested-shell Pester result-export command-loading failure and successful unchanged independent rerun are documented in resource-final-gate.json rather than hidden. Preview 5176 now serves this candidate; production 5174 is unchanged. Settings hashes matched before/after live testing.

Independent review confirmed actual fixes for partially visible variant caches and repeated DOCX image-reference amplification. Variant output is published by atomic rename from a unique owned temporary file. DOCX conversion is limited to 256 image conversions and 128MiB new-asset output receipts; a crossing asset may be temporarily written before rollback, not a filesystem reservation. Resource ceilings are not a global RSS/time guarantee; process hard-kill and cleanup failures can leave owned temporary output.

The 20 contextual accessibility findings were individually commented and marked false-positive, with a separate API readback, on the previous exact 6fce4a0 analysis. Neither upload S5693 nor async S4822 was included. S4822 has since been rewritten with explicit await/finally and awaits rescan. The 30MiB upload setting remains visible and exceeds the S5693 recommendation; no risk acceptance, quality-profile relaxation, gate change or source exclusion was made.
