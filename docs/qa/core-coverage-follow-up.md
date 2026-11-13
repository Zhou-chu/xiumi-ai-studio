# Core assembly and article import quality follow-up

Base: `0588b1b` (isolated quality branch, based on application baseline `c961c78`).

## Added behavioral coverage

- 26 assembly tests cover builtin text/image modules, capacity and placement limits, missing templates, overflow handling, quotes, container nesting, theme metadata, HTML counters, credits, caption grouping and source preservation.
- 37 article import tests cover metadata/source detection, layout splitting, margin behavior, inherited formatting, Markdown conversion, safe numeric list starts and malformed attributes.
- No compiler or assembly implementation changes.

## Regressions found and repaired

Two explicit regression tests failed before implementation, then passed:

1. A unique top-level section/div bypassed `shellOk` during `contentLayer` descent. This could drop a fixed height or duplicate shadows/non-repeating backgrounds after splitting. Top-level descent now uses the same safety check as nested cards.
2. Markdown conversion flattened `ul`/`ol` content and lost list markers/nesting. It now preserves ordered/unordered list structure, indentation based on marker width, and numeric ordered-list starts. Sanitization permits only integer `start` attributes on `ol`; invalid values and the attribute on unrelated elements are removed.

Compatibility: some previously splittable but visually unsafe wrappers intentionally remain one block. Markdown lists now retain their list structure rather than concatenated plain text. Existing scripts and unsafe URLs remain filtered. This is not a browser/live-gate claim; the integrator must rerun import UI workflows.

## Verification scope

Full-source V8 coverage includes every `src/**/*.{ts,tsx}` and `server/**/*.ts` file, including unimported business code. Only declaration files are excluded. Target-file results do not represent whole-repository coverage. See `core-coverage-audit.json` for exact counts and remaining whole-repository gap.

Verified locally: unit suite, lint, typecheck and production build. Diagnostic code-smell scan: 85 warnings, zero errors (unchanged from backend extraction; warnings are not a clean-code claim).
