# Editorial dark theme design and acceptance

## Scope and observed problems

Reference: the four owner-supplied editorial layouts, viewed before implementation.
Baseline: running release 5018a4e, isolated worktree based on the same commit.

1. Blue/purple accents and gradients competed with the document.
2. Undifferentiated small typography obscured navigation, fields and metadata.
3. Too many persistent toolbar actions reduced the canvas height.
4. Narrow screens stacked all panels rather than exposing a primary workspace.
5. Default system fonts lacked a deliberate Chinese title/body hierarchy.

## Design and implementation

Warm graphite shell, warm-white primary actions, restrained 1px rules and 3px corners.
Shared color, typography and spacing tokens live in editorial-dark.css. Native controls,
menus, forms, dialogs, save/error feedback and editing chrome use the same language.
The desktop toolbar is 56px. Secondary controls live under More. Tablet/phone switch
between resources, canvas and properties without unmounting the editor or its panels.
Light mode retains its styling and action order.

UI text uses locally hosted Noto Sans SC Variable; display headings use Noto Serif SC
Variable; short numbers/keyboard metadata use the platform monospace stack. WOFF2
unicode-range subsets load on demand. Fonts are from official Fontsource 5.3.1 npm
packages with OFL licenses and source checksums included in src/theme/fonts.
Browser CDP evidence records actual custom-font glyph rendering, not just font-family.

All new chrome selectors exclude authored HTML, rich content and document previews.
The authored canvas keeps its original white background and typography; there are no
filters or changes to compiler/export output. The root --radius variable is unchanged.

## Visual evidence

visual-evidence/before and after contain the same route (/), deterministic long fixture
and viewports: desktop 1440x900, tablet 1024x768, mobile 390x844, AI settings and save
failure. The save-failure comparison uses an explicitly injected HTTP 503 to reproduce
feedback. model-discovery-real-failure.png additionally exercises the real backend
against unreachable local http://127.0.0.1:9/v1, without fabricated model lists/success.
rendered-fonts.json records Chromium's actual loaded Chinese fonts.

## Validation and limitations

See final handoff for exact command results. Browser automation uses disposable data-e2e
and ports 5273/5274, never the owner's production data or running service at 5174.

Validation covers browser rendering and existing app import/edit/undo/save-refresh/
export behavior. No claim is made for publication into a live WeChat/Xiumi account,
paid model completion, hardware mobile devices, VoiceOver/NVDA, Firefox or Safari.
The unchanged bundler emits a >500kB main-JS chunk warning; no runtime font CDN is used.

Final verification (2026-11-13): pnpm check passed (38 files / 386 tests), production build passed, full Playwright suite 58/58 passed on a static source tree. Independent built preview at 127.0.0.1:5175 verified in real Chrome. Existing 5174 service untouched. PR #10/#11 save-safety changes are not included; integration validation remains required.
