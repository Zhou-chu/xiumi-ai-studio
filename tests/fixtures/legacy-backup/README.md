# Upstream library backup fixture

`upstream-library.zip` is the unmodified output of `server/dataTools.ts:writeBackup`
from upstream commit `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. It contains
three synthetic projects (one references the 1×1 PNG, one has sparse legacy metadata and a heading, structured paragraph and card, and one has explicit author, summary and dates), one synthetic empty
template, that PNG and its index, and a redacted test provider profile. It contains no user data,
real credentials, or .env. This is not the fork's single-project export.

To reproduce, write the entries listed by unzip -l (excluding the generated manifest) to
a fresh temporary directory, put any non-secret marker in the fixture
profile's source `apiKey`, and run a small ESM script in the pinned upstream
checkout. Use `XIUMI_DATA_DIR=<tmp> XIUMI_SKIP_ENV_FILES=1 node --import tsx
<script>`. The script calls `writeBackup(createWriteStream(out), '0.1.0')`
and awaits the stream's finish. Output timestamps differ, and the profile's
source key is always redacted by the upstream writer.

`upstream-template-only.zip` is another unchanged output of the same exact writer.
Seed a disposable data root with only both template JSON records, the indexed 7×5
teal PNG and its asset index, then call the writer as above. Validate the extracted
PNG digest `ee4467ea86fba01e26dbf35145b490663e0f85e9799e88ae2fde5d4874dcaf1b`
and RGBA (19, 124, 115, 255). Only the image template refers to that asset; there
are no projects, versions, components, settings, or credentials. The independent
heading-only template uses builtin `tech-blue`, font size 17, primary #27506A.

`upstream-template-box.zip` is unchanged output of the same upstream writer.
It has one native top-level text box with ordered heading, image and quote
children, and the directly indexed 11×9 PNG referenced only by the image child.
The SHA-256 of the extracted PNG is
`cfe2fa9eb3c9be7dab3ed1ae3b8a4e1b074d8216c7f6cf3e113d70ca2f16dd12`;
all pixels are RGBA (33, 122, 118, 255). There is no project/version/component,
configuration or other media in the archive.

`upstream-native-data-blocks.zip` was written by the same upstream writer,
then restored with upstream's `extractBackup`, `planMerge`, and `applyMerge`.
It contains four synthetic projects (normal divider control, space divider,
timeline, and table). All four restored with identical project data except for
fresh revisions; no settings, files, media, or original user inputs were used.
Archive SHA-256:
`ac894629f031cfcad749fbab97f3270500ce843471c1edddb3e56e4b2cb3a3b1`.

`upstream-native-photo-slots.zip` was produced and independently restored by
the same pinned upstream writer/reader. It has an ordered two-photo control,
three- and four-slot mixed layouts with deliberately absent image fields, and
an all-empty four-slot layout. It contains four tiny, independently colored
synthetic PNG assets, no projects or credentials. Each new mixed layout uses
one exclusive image dependency. SHA-256:
`7dc1d1c7a594cf8d7a582887483aa6d3d2e71ee7a512822b3db544ea4c0a8946`.

- `upstream-two-scene-replay.zip`: synthetic text-only replay saved via the
  project API and downloaded through `/api/data/backup` on upstream
  `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. It contains the starter and a
  second scene constructed via the upstream editor's native scene and item
  factories. The regression checks the exact ZIP, unchanged restored scene
  data, and the upstream compiled HTML digest. Native auto playback emits
  the two SVGs in scene order; each plays on its own clock, not as a timed
  handoff. There are no external resources, accounts, or credentials.

- `upstream-filled-gallery.zip`: generated with upstream `550c0ef`'s
  actual upload, project, version and whole-library backup HTTP handlers using
  three synthetic solid-color PNG inputs, stored by upstream as JPEGs. The
  current gallery contains the first two assets in reversed order; the prior
  version has one different image available only in history. SHA-256:
  `137705a3b642503b5384496b80ff37b9016e1c68105934ea2afb8ed40f65ddf6`.

- `upstream-filled-carousel.zip`: generated on upstream `550c0ef` by its
  actual upload, project, version and whole-library backup HTTP handlers with
  three synthetic solid-color inputs. Includes current and historical native
  carousels with different ratios and empty slots, and one history-only JPEG.
  SHA-256: `4f3df6a733d2de0e54ea5b182f80ac14419ff413d82ba86507e168d6b9d46bee`.


- `upstream-three-scene-replay.zip`: upstream `550c0ef` project/backup HTTP
  writer output, using only the stock editor replay factories, eight native
  text-only items across three ordered automatic scenes, default 80/400 KiB
  budgets and no credentials, network resources, media or custom timing.
  The tested compiled HTML digest is
  `bc7a4dd8c49916c7f2c33fb86efd681d0054ed2c460a26185fc460dc118040dc`.
  The archive digest is
  `cf3a84108c0c9ba367fa15e32cbdf9cb6643780ef775b13aa43363c6f397e763`.

- `upstream-heading-box.zip`: saved with stock box, heading, paragraph and
  editor insertion helpers, then written by the project/backup HTTP routes
  at upstream `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`. One synthetic
  project has two headings surrounding a paragraph, including literal HTML
  punctuation. It contains no media, settings, or credentials. Archive
  SHA-256: `553b317880c9ef8dee41a8249c38b17c8e2e0ce0026b68204c51430b72cfc5d0`;
  compiled HTML SHA-256: `b29f601db8314e587af7428ae1c9513a79a1fb4abc1a765d3d316b877009cb57`.

`upstream-timed-text-replay.zip` is a 1,293-byte synthetic archive produced by the
pinned upstream `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe` HTTP writer
(`PUT /api/projects/upstream-timed-text-replay`, then `GET /api/data/backup`).
The native three-scene starter uses the editor's delay field at -5, 1.25, 10
and -0.45 seconds. Its original project is the only project in the archive;
there are no media, credentials or external network requests. SHA-256:
`3e7cb004dc2f096ed72f97ac801ceda7a16c6555189a164086894b445104723b`.
Upstream offline HTML SHA-256:
`e0d80a05ab639726742a8ca53a2af183fd0f89b1987b2afcbd2ef18a9870af10`.

`upstream-linked-component.zip` is an unmodified 842-byte ZIP generated by
the pinned upstream commit `550c0ef2e99e4d493bb0e9d017178aa7fbdc7fbe`.
A temporary loopback instance saved a synthetic HTML component using
`POST /api/components`, then wrote the backup using `GET /api/data/backup`.
It contains no accounts, private material, or remote resources; the two
ordinary URLs point at the reserved `example.invalid` host. SHA-256:
`4b21daff8447ed984efc6278e6713be36f392cba0838b78395cbb35104a5c0e6`.
