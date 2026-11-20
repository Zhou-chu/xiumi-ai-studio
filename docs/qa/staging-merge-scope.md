# Staging branch reconciliation

The historical staging tip `1a70ee2` is included as a parent of this review merge. The first parent includes the narrower, independently tested ports; do not use the presence of the second parent to infer feature equivalence.

| Historical path | Resolution in this merge |
| --- | --- |
| Scoped image collection and consent | Keep the existing one-image, no-manuscript-edit flow and current document/selection guards, including the per-transfer recheck. The AI panel invalidates transient selection epochs and aborts automatic suggestions while local collection is open. Retain the historical collection design notes, explicitly not as hosted acceptance. |
| Editorial styling, imported layout, typography and proposal review | Keep the integrated editorial baseline and later field/selection guards; font-family and size show independent mixed states. Retain the historical imported-layout design notes. Visual snapshots and previous exploratory assertions stay in their original commits, not active gates. |
| History and document ownership | Keep the current saved-document revision checks, ownership epochs and list/action retries. Do not restore historical persistence or shell paths behind the active store. |
| Local editorial replay | Keep tappable/automatic canvas behavior, SVG text and animated local HTML. Restore two live browser regressions from staging: zero-hold loops produce a visible frozen canvas in both trigger modes; preview and saved settings retain the loop. No external actions or screenshot dependency. |
| Windows package and data | Keep the exact sealed portable EXE, default/explicit data-root proof, project-and-asset browser backup and non-overwriting offline v0.2.0 subset. The historical package/verification/bootstrap workflows and separate runtime modules are superseded; do not reactivate pinned smoke or old archive handlers. |
| Coverage workflows and fixtures | Keep the repository's current dependency gate and built same-origin/software package proof. The staging-only strict-unit checkpoint, duplicate Windows matrix, historical fixtures and screenshots remain traceable through the staging parent, not copied into current CI. |

## Not equivalent

- The current local-only replay does not enable the old WeChat/Xiumi replay egress or raster/glyph strategy.
- The portable offline recovery covers only new/v0.2.0 projects and indexed images and stages to a fresh root. It is not the old in-app backup manager, whole-library migration, data/log folder opener, or save-gated quit workflow. Its default data root is unchanged.
- Historical experiment fixtures and old security tests were not executed as part of this resolution. Current production safety rules were not widened.

This branch is a candidate for normal hosted acceptance, not a passing result for `main` and not branch-deletion permission.
