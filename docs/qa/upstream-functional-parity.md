# Upstream functional parity checklist

The comparison baseline is upstream `123huangcan250/xiumi-ai-studio@550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. A Git merge or a comparison showing zero commits behind is not feature acceptance. Before promoting a combined candidate, rerun this list on its exact commit and keep the candidate's existing safeguards.

| User journey | Required acceptance | Current implementation scope |
| --- | --- | --- |
| Whole-library backup | With an isolated library, download the archive and read projects, versions, templates, components, custom themes and indexed media with the upstream restore reader. Confirm credential redaction and no profile writes. | Download API has independent local roundtrip evidence. Browser entry, larger-library behavior and native Windows are not accepted here. |
| Restore and directory migration | Preview without writes, then confirm only once. Revalidate on confirm, preserve duplicates or corrupt local records, and surface unsupported entries. Restore all supported original categories with their references intact and prove the old source remains unchanged. | Partial only. The user-facing ZIP flow restores supported independent text projects and validated text snapshots only under a newly imported parent. Exact snapshot labels, dates, and document content have local HTTP and mounted UI coverage; the browser journey also exercises history restore and undo, with hosted execution pending. Simple templates and bounded custom document themes are now an opt-in same-library stage with local HTTP, editor rendering and dependent-write coverage; the focused browser case awaits hosted execution. The scope does not include template media, overrides, components, settings, or directory migration. |
| Windows lifecycle | Start the sealed launcher from a fresh isolated root, verify existing synthetic data survives the upgrade and two launches, open owned data and log locations, and save-or-cancel before quit. Verify the actual running version and clean only test-created resources. | Not accepted. Hosted packaging alone cannot establish this. |
| Replay outputs | Verify local replay HTML remains intact. Exercise Xiumi and WeChat output separately, including glyph and image behavior. Use inert fixtures for upload destinations; never publish or contact a real service for this test. | Offline SVG text Xiumi download is covered locally; the image-bearing and external replay paths are still unaccepted. |
| Ordinary Xiumi export | Mock hosted image URLs that change package size; show the final split count, let the user decline downloads, and explain images already uploaded cannot be recalled. | Covered by mounted tests; production browser run pending. |
| Imported article and styling | Paste typical fixed-width source at desktop and 390 px, preserve fixed media and source color roles, edit/undo presets, and verify shared SVG definitions across fragments. | Clear single-column paste normalization covered locally. Broader pasted formats, swatches and SVG behavior need separate cases. |
| Models, scoped AI edits and theme | Use controlled endpoints and no live credentials. Verify model status, ignored options and scoped valid edits without weakening selection guards. Preserve an upstream user's theme preference; editor exports must not change with app theme. | Existing capabilities are present in both builds, but known UX and policy differences remain. |
| Existing fork workflows | Fresh native Windows project: create, edit, save, reopen and export. Preserve the current single-project backup and offline portable recovery. Rerun static checks, existing Playwright, hosted packaging, Sonar and separately measured strict unit gates. | Re-run on exact combined commit. No deletion or upstream PR based on this document alone. |

### Indexed image ZIP recovery (bounded subset)

Choose **同时恢复项目引用的已索引图片** before previewing the original backup in the local UI.
This mode accepts ordinary image blocks that reference matching indexed PNG or JPEG bytes
included in the archive. Preview never writes. Confirmation skips the dependent project
on an asset conflict, preserves non-conflicting text projects, and reports assets it added,
reused, skipped, or could not write. Dependency writes share both the normal asset and
project queues. A later filesystem I/O failure or intervention outside the running process
can still leave already added images; the result reports these rather than rolling them
back after another user action could reference them. It does not restore unused library assets, arbitrary
HTML/media references, or complex layouts. A separate 32 MiB expanded asset-index/binary
budget applies to this mode. Images use a content-qualified URL, including derived sizes;
the matched bytes are pinned in the existing removable cache before a qualified response
can be marked immutable. Unqualified filenames revalidate. The existing cache cleanup
removes snapshots; this change does not implement an automatic global cache quota.

Evidence: the test fixture was produced by the pinned original writer, not a mocked API.
Mounted HTTP tests check the read-only preview, late image conflicts, saved project/asset
identity, and image bytes through a URL emitted by the real compiler. Browser acceptance
is a separate Playwright journey (prefetch the missing name, restore, open, render pixels)
and is not satisfied by the mounted HTTP tests alone.
