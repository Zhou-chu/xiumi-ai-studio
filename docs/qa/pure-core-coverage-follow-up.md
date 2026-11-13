# Pure-core branch coverage follow-up

Base: `74654b4` on the isolated audit branch. This change adds tests only, with no business-source or coverage-scope changes.

Added 37 unit tests across five suites:

- Role inference: builtin roles, layout width rules, label hints, browser parser fallback, cover/heading promotion, trailing metadata and explicit-label preservation.
- Outline parsing: malformed AI structures, nested tables/people/timeline/quotes, missing title/sections, plain numbering and tables, Markdown lists/images/quotes and additional tables.
- Slot handling: loose/raw whitespace, comments, decoration thresholds, declared image ratios, browser defaults, frame extraction, background replacements and logical alignment.
- Rich text and kit rendering: marks, missing nodes, list serialization, empty/photo placeholders, every box/frame variant, photo grids and carousel states.
- Photo plans: readiness blockers, crowd decisions, fixed/free groups, AI placement validation, malformed/omitted results and duplicate-photo protection.

Measurements in `pure-core-coverage-audit.json` use all production TypeScript under `src` and `server`, not only the six target files. A high target-file result must not be represented as whole-repository success. Integration contains concurrent UI/feature changes and must remeasure its own candidate.
