# Integrated red-team fixes (RT-001 through RT-004)

The integration branch combines failed-save navigation guards, revision-protected project persistence and conflict copies, complete cover-title rendering and render-completion guards, and preservation of quotations, multiple tables, and timeline description clauses.

## Evidence and verification scope

- RT-002 before-fix failure transcripts and storage/compatibility details are in `rt002-concurrent-editing.md` and adjacent text files.
- The prior integration (`dd0bc9c`) passed 397 unit tests, typecheck, lint and production build. Its independent review found no blocking issue.
- Final RT-001–004 code passed all 403 unit tests (43 files), typecheck, lint and production build.
- RT-004 adds five content-completeness tests across rule-based parsing, all offline variants, existing-outline AI-design layouts, and serialized/Markdown/compiled HTML output. The additional cancelled-background-image regression tests the preceding cover fix.
- Desktop validation and CI must target the final integration commit, not a prior passing branch. The deployment worker retains exact-SHA browser results separately.

## Remaining limitations

- Content preservation checks do not exercise a real AI model. The model-facing outline prompt still describes a single table per section; this change does not prove that a model preserves multiple tables in its response.
- Existing layout recipes group content by type. Tests establish that both tables and intervening prose survive, and table order survives, but do not establish the original interleaved prose/table order.
- Conflict recovery preserves the current draft as a separate project, not the original undo history. Do not describe it as preserving all editing history.
- File-based optimistic concurrency assumes one API process owns a DATA_DIR; multiple processes writing one directory are not supported.
- Production-build large-chunk warnings remain advisory and pre-existing.
