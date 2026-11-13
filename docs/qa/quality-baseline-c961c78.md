# Full-source unit coverage and code-smell baseline

Baseline: `c961c78604f4c1135438d54e1a08a7ba29bc1861`. This is the committed integration base, not the still-changing red/green review/font/resize/multiselect candidate.

## Measurement contract

- Windows desktop; Node 24.19.0, pnpm 11.23.0, Vitest and @vitest/coverage-v8 5.0.5.
- Unit command includes every `src/**/*.{ts,tsx}` and `server/**/*.ts`, excluding only declaration files. All 94 tracked source files are represented, including unimported files.
- 55 test files / 468 tests passed. This is unit-suite coverage, not browser/E2E coverage.
- No production source was changed by this audit. No API calls or deployment performed.
- Coverage thresholds are independently set to 90% for statements, branches, functions and lines. A baseline below those thresholds must fail the new gate.

## Result

|Metric|Covered / total|Percent|Additional covered items to reach 90% at this fixed baseline|
|---|---:|---:|---:|
|statements|5440 / 9048|60.12%|2704|
|branches|4148 / 7452|55.66%|2559|
|functions|1260 / 2464|51.13%|958|
|lines|4250 / 6841|62.12%|1907|

The 90% gate is **not satisfied**. Browser pass counts do not change this result. New features will change the denominator, so measure again at the final candidate.

## Largest line-coverage gaps

|File|Covered / total lines|Line percent|Uncovered lines|
|---|---:|---:|---:|
|`src/editor/Canvas.tsx`|8 / 265|3.01%|257|
|`src/editor/ImportWizard.tsx`|0 / 244|0%|244|
|`server/index.ts`|0 / 224|0%|224|
|`src/App.tsx`|0 / 161|0%|161|
|`src/editor/InlineReview.tsx`|0 / 157|0%|157|
|`src/editor/RightPanel.tsx`|0 / 123|0%|123|
|`src/editor/ArticleImport.tsx`|0 / 119|0%|119|
|`src/editor/PropsForm.tsx`|56 / 161|34.78%|105|
|`src/editor/Toolbar.tsx`|58 / 158|36.7%|100|
|`src/editor/ComponentLibrary.tsx`|1 / 82|1.21%|81|
|`src/editor/KitPicker.tsx`|0 / 73|0%|73|
|`src/editor/wechatOutput.ts`|22 / 93|23.65%|71|
|`src/core/assemble.ts`|189 / 259|72.97%|70|
|`src/editor/LeftPanel.tsx`|42 / 105|40%|63|
|`src/editor/CollectModal.tsx`|0 / 63|0%|63|
|`src/editor/api.ts`|20 / 64|31.25%|44|
|`src/editor/Copywriter.tsx`|0 / 44|0%|44|
|`src/editor/AiSettingsModal.tsx`|126 / 166|75.9%|40|
|`server/wechat.ts`|15 / 53|28.3%|38|
|`src/editor/store.ts`|127 / 162|78.39%|35|

## Code-smell diagnostic

Default lint does not enable these additional complexity/size rules. This audit found **84 warnings, 0 errors** across 94 source files: 61 complexity >15; 16 functions >100 nonblank/noncomment lines; 2 depth >4; 3 functions >5 parameters; 1 callback nesting >3; 1 TODO/FIXME/XXX marker. These are review signals, not 84 proven bugs.

Priority hotspots: ImportWizard complexity 57; assemble.slotValues 56; server.testConnection 51; AiSettingsModal 49; sanitizer traversal 43. Do not bulk-refactor the active UI while feature branches are unmerged. Secure parsing and state-transition paths require regression tests before decomposition.

## Next actions

1. Add frontend unit/component harnesses for App, Canvas, InlineReview, RightPanel, ImportWizard and ArticleImport, currently mostly covered only by E2E. Test cancellation, repeat actions, stale proposals, selection changes, and error/empty states.
2. Test HTTP route handlers through an app factory rather than importing a listener side effect from server/index.ts. Preserve real filesystem/network boundaries using temporary directories and mocks at the boundary.
3. Cover branch-heavy parser/export/sanitizer/configuration logic and store transitions; branch coverage is 55.66%, not 90%.
4. Add tests for new font/resize/multiselect paths before final measurement; do not exclude UI modules, expand ignore comments, or merge E2E coverage into the unit percentage.
5. Re-run the exact final candidate with `pnpm test:coverage`; run `pnpm quality:smells` and triage remaining hotspots.

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm test:coverage
pnpm quality:smells
```

The coverage command now exits nonzero until all four configured 90% gates pass. The smell command is diagnostic (warnings); use `--max-warnings=0` only if a separate zero-warning policy is intentionally adopted. Full machine-readable per-file metrics and findings are in `quality-baseline-c961c78.json`.
