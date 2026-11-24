# Upstream functional parity checklist

The comparison baseline is upstream `123huangcan250/xiumi-ai-studio@550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. A Git merge or a comparison showing zero commits behind is not feature acceptance. Before promoting a combined candidate, rerun this list on its exact commit and keep the candidate's existing safeguards.

| User journey | Required acceptance | Current implementation scope |
| --- | --- | --- |
| Whole-library backup | With an isolated library, download the archive and read projects, versions, templates, components, custom themes and indexed media with the upstream restore reader. Confirm credential redaction and no profile writes. | Download API has independent local roundtrip evidence. Browser entry, larger-library behavior and native Windows are not accepted here. |
| Restore and directory migration | Preview without writes, then confirm only once. Revalidate on confirm, preserve duplicates or corrupt local records, and surface unsupported entries. Restore all supported original categories with their references intact and prove the old source remains unchanged. | Partial only. The user-facing ZIP flow restores supported independent text projects and validated text and opted-in ordinary indexed PNG/JPEG snapshots only under a newly imported parent. Exact snapshot labels, dates, and document content have local HTTP and mounted UI coverage; the browser journey also exercises history restore and undo, with hosted execution pending. Simple templates and bounded custom document themes are now an opt-in same-library stage with local HTTP, editor rendering and dependent-write coverage; the focused browser case awaits hosted execution. The scope does not include template media, overrides, components, settings, or directory migration. |
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


### Component library ZIP recovery (bounded subset)

With **同时恢复简单原文组件及引用图片**, preview classifies compatible records as
add, identical, conflicting or unresolved when a matched indexed PNG/JPEG is
missing. Confirmation operates against ordinary collection locks: existing
records and name-conflicting image bytes are kept, and a conflicting component
does not cause its images to be added. File I/O failure after related bytes
are published is reported; unrelated local files are not rolled back. ZIP
inspection is limited to 128 component records and 8 MiB of expanded component
data; each component fragment is limited to 64 KiB and a narrow, inert HTML
and styling subset. Unsupported markup, remote media/links, complex SVG,
source URLs and archived authority/redistribution claims are not restored.
The source kind, label/account and acquisition method remain advisory local
metadata. Identity and revisions are retained; derived statistics and
fingerprints are recalculated rather than trusting the archive.

A genuine upstream synthetic library fixture exercises real read-only preview,
one-shot confirmation, normal component listing and exact indexed image bytes.
The browser gate separately inserts the archived component twice, verifies
distinct copied block IDs and actual decoded image pixels, saves/reloads, and
checks the library's retained advisory provenance.


### Local SVG replay with owned raster images

The original pinned Xiumi offline-import path explicitly refuses local images
inside SVG replay: the target cannot inline or manually replace them. Do not
treat a local file as a Xiumi upload or claim compatibility. Text-only Xiumi
replay remains unchanged, and WeChat/hosted Xiumi actions remain guarded.

For replay with actual PNG/JPEG in the local library, **本地 HTML（保留回放）**
keeps both item and background images bound to their selected asset generation.
The offline file uses same-origin inventory and raw asset bytes only, capped
at 64 references, 8 MiB each and 16 MiB total. A mismatched, missing, remote or
non-raster image aborts the download instead of producing a misleading partial
replay. The resulting HTML has a network-blocking content policy; SVG replay
animation keeps running and images remain visible without the Xiumi server.
Local HTTP tests exercise exact encoded PNG/JPEG bytes and owned generation,
and the browser gate additionally opens the download with networking disabled.


The bounded native template-media stage additionally accepts a top-level
two-slot `photos` pair with two verified indexed PNG/JPEG references, allowed
native ratios/layouts, and original role/block IDs. Both template and indexed
image options must be explicitly selected. Boxes containing pairs, wider
photo layouts, HTML and arbitrary media remain outside this slice. The native
fixture exercises ordered replacement and local embedded HTML; it does not
cover ordinary one-slot blocks mislabeled with a two-slot role.


Independent indexed asset restore is an explicit separate choice. It can add
verified PNG/JPEG from an asset-only fork download, without restoring a referring
project or template. Choosing both image options still imports each verified
asset at most once. Same-ID different bytes are not overwritten; other assets
can still be added. An unindexed file or unsupported referring record stays
unsupported, and re-previewing an exact no-op disables confirmation.

### Existing local manuscript: adding missing ZIP history

ZIP preview can plan unoccupied versions independently when the canonical local current manuscript matches the backup (all fields except its local revision). Confirming neither rewrites that manuscript nor overwrites existing history, and preserves the history-retention cap. For that retained manuscript, confirmation can add only history approved by the preview, and the original local revision and matching content must still hold inside the write queue. If the manuscript changed, the dependent version and a PNG used only there are not added. Divergence, occupied version, retention limit, unavailable destination, and unavailable asset are reported separately. The owner-local directory migration uses the same existing-manuscript check, in addition to binding reviewed source and destination folders. Neither method implies support for path-based merging into a divergent manuscript.

### Owner-local directory: images without a manuscript

The opt-in independent-image mode applies only to the owner-configured, same-origin directory migration. It reports the planned new, identical, and blocked indexed PNG/JPEG items and allows an explicit image-only confirmation even when the old directory has no manuscript. Like ZIP restore, it neither imports unindexed files nor overwrites existing IDs or filenames. Exact reviewed source index and eligible raster bytes must still match on confirmation.

### Owner-local directory: scoped themes, templates and components

The separate owner-local design option shares the ZIP validator and add-only dependency-aware stores for supported themes, templates and reusable components. Missing or differing themes prevent writing dependent templates, not unrelated components. Shared qualified indexed media is added once only when needed. Exact reviewed source records and eligible raster bytes must still match on confirmation; existing destination records are not overwritten. This does not imply support for arbitrary legacy layouts or their external resources, and never imports credentials or settings.

### Read-only cross-fragment SVG preview

The ZIP restore dialog has a separate unchecked opt-in for a local, read-only
cross-fragment SVG preview. For at most one manuscript that matches the small
native rectangle-pair pattern (optionally surrounded by the three reviewed
independent fragments), the browser receives only validated rectangle geometry,
colors, and opacity values. It reconstructs the interaction in an empty-sandbox document
with a default-deny resource policy. Incoming SVG names and markup are not
sent to the UI. Cancel releases the same loopback owner-and-token stage, and the
manuscript remains listed as unsupported for project restoration. This does not
enable cross-fragment SVG recovery, normal editor output, clipboard export, or
publishing.

### Opt-in local cross-fragment SVG recovery

A different ZIP option restores the same bounded adjacent rectangle pair as a
single editable linked scene. The surrounding reviewed independent SVG blocks
remain in order. The original cross-fragment names and SVG source are not
persisted in the scene; only bounded geometry, colors, and opacity actions are
stored. Restoration uses the existing add-only, same-origin owner-and-token
confirmation, and the project saves through ordinary editor persistence. The same
validation applies to its eligible archived versions, including the edited typed
scene when restoring a freshly exported full-library ZIP. The
inspector edits the two opacity values; the canvas runs only generated markup
in a no-permission sandbox. Export this interaction via the explicit local HTML
option: the file denies network resource loading and generates distinct names
for each scene. Generic compilation omits the link actions. WeChat clipboard and
draft workflows and Xiumi packaging are not enabled for these projects; no
full publishing or arbitrary archive parity is claimed.
