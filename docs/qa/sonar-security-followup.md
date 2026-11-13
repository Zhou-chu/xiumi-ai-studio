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
