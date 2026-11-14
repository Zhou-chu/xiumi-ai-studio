# AI protocol responsibilities and native health verification

Baseline: ac86d8ef0cf4b49c66afecdfd38b8d4df6867cbd. Independent worktree; no main or shared preview edits.

## Behavior-preserving refactor

`server/ai.ts` now names separate responsibilities: configured output budgeting, protocol endpoint/credentials, generation encoding, truncation-aware decoding, probe configuration, probe request encoding, HTTP-stage classification, and response/JSON validation. They remain in the same module: no artificial file splitting to improve file-level scoring.

Preserved: OpenAI/Anthropic request shape; server-only credentials; redirect:error; six generation adaptation attempts and two probe attempts; explicit effort protection; configured/default/probe output budget precedence; 180-second generation deadline; 20-second probe deadline; official DeepSeek-only thinking override; probe error privacy; truncation errors and actual adapted budget; settings and prompt constants.

ESLint function complexity: chatText33 ->12; testConnection51 ->11. All extracted functions <=14; ai.ts now has zero findings under unchanged quality rules. This is not a claim that overall Health passed90.

## Test evidence

11 new behavioral table/edge tests cover protocol endpoint and credential separation, protected bodies, budgets, HTTP error classes/privacy, both providers'180-second timer boundary/cleanup, bounded probes. Tests ran green on original behavior before refactoring. A temporary180000->179999 deadline mutation produced the expected two failing deadline assertions; mutation reverted. Four AI suites66tests pass after refactoring. Full suite111files/1008tests passes. Typecheck and ESLint pass. Full production src+server coverage gate passed without exclusions or threshold changes: statements96.84% (9283/9585), branches91.84% (7298/7946), functions97.31% (2536/2606), lines98.33% (7078/7198). ai.ts: statements98.18%, branches97.76%, functions96.96%, lines99.24%.

## Cross-platform health discrepancy

Tool: official npm jscpd5.4.3 MIT, defaults for all health weights/half-lives; no remote code transmission. Frozen ac86 source from git archive (src,server,package.json,index.html,tsconfig.json), same bytes in both runs.

Common options:

    src server --format typescript,tsx,css --min-lines 5 --min-tokens 50 --mode mild --max-size 10mb --max-lines 100000 --workers 2 --no-gitignore --health --entry src/main.tsx --entry server/index.ts --reporters json,console

Windows:104code files/15597lines, duplication0lines/96.8, dead-code28lines/95.4, complexity13236lines/34.1; total68.0/C.
Linux: same104code files/15597lines, duplication14lines/96.2, same dead-code/complexity; total67.9/C.

Thus this is not only display rounding. The platform difference changes the measured duplication input, although not the rounded integer badge. The core source uses exact membership of cleaned fragment source_id in summary paths; Windows path normalization is a likely cause, not yet a patched/proven exact line of failure. Use fixed Linux tool/runtime for reproducible comparison. Do not tune weights or claim>90.

Native formula: each dimension uses100*2^(-adjustedShare/halfLife); adjustedShare includes a2000-line typical-project prior. Overall score is exp(sum(weight*ln(max(subscore,1)))/sum(weight)), rounded to one decimal. Defaults weight1 each, half-lives8.5/7.5/50. Hence0duplicate lines still scores96.8, not100, due to the prior. CSS is filtered out of both health code denominator and duplicate numerator; it does not pollute the96.8 score.

## CSS audit without scope gaming

Complete duplication scan includes114TS/TSX/CSS files/18339lines;205clones/1635duplicate lines=8.915426%. Of203CSS clones,202are intra-file font-face subset patterns in theme/fonts/fonts.css. Only one is hand-written UI duplication: color-mode.css61-71 versus styles.css3-13,11lines. Keep these in raw results; do not delete local font subsets, unicode ranges or merge theme scopes to reduce numbers.

Native health excludes all10CSS files/2742lines. Other non-code assets are outside the selected formats. Dead-code graph identifies104files,0unparsed,103reachable,2entrypoints; only inlineReviewGeometry.ts28lines is unused by production (unit tests still reference it). Dynamic RichEditor/Copywriter imports remain reachable.

Official evidence:
- https://github.com/kucherenko/jscpd/blob/v5.4.3/rust/crates/cpd-core/src/health.rs
- https://github.com/kucherenko/jscpd/blob/v5.4.3/rust/crates/cpd/src/dashboard.rs
- https://github.com/kucherenko/jscpd/blob/v5.4.3/docs/rust.md#health-score

Raw cross-platform JSON retained in audit workspace jscpd-ac86-snapshot-linux and jscpd-ac86-snapshot-windows; not generated from a modified scoring formula.
