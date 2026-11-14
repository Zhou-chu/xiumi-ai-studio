# Connection probe and soft-overlay refinement

## Connection behavior

The former test treated completion of a JSON generation task as proof of connectivity and allocated only 100 tokens when reasoning effort was blank. DeepSeek's default thinking could exhaust this budget even after a successful connection.

The new independent probe caps output at 128 tokens, uses one 20-second deadline, and allows at most one parameter-compatibility retry. Only the verified official HTTPS DeepSeek endpoint temporarily disables thinking for this probe. Saved configuration and normal generation behavior are unchanged. Authentication, model/path, request, transport, response-envelope, format and budget outcomes are distinct. Truncation or format mismatch remains a warning, never a claim that full generation passed. Private reasoning and upstream error bodies are not returned to the browser. Repeated test clicks are guarded; dismissing the dialog invalidates UI results but does not promise to cancel an already-sent upstream request.

Two real DeepSeek probes were made using the existing credential resolution path, without copying or displaying credentials. Both connected. The second returned HTTP 200 in a bounded request, used 39 prompt + 7 completion = 46 tokens, and returned a finished response whose minimal JSON check did not pass. This remains an explicit format warning. Public settings were identical before and after both calls. Full business generation is not certified by these probes.

## Visual behavior

Dark overlays now have 16px corners, a restrained 6px blurred backdrop, subtle neutral edge/shadow, and fully opaque text/form surfaces. Ordinary controls retain small corners. Phone dialogs use a bottom sheet with a visible heading/close control and independently scrollable contents. Reduced-transparency and forced-colors fallbacks disable blur. Resource/property panels remain high-frequency editing surfaces; model settings, history and export remain on-demand dialogs rather than new disconnected routes.

Production CSS initially dropped the standard backdrop-filter due to prefixed-declaration ordering. That was reproduced in the built preview, corrected, and rechecked: standard blur(6px), 16px corners, opaque content, and reduced-transparency fallback all behaved correctly in Chromium.

## Evidence

- Matched original editor fixture: `visual-evidence/soft-overlays/before/settings-desktop.png` versus regenerated `visual-evidence/after/settings.png`.
- Additional populated form screenshots: `visual-evidence/soft-overlays/after/settings-{desktop,tablet,mobile}.png`.
- Real production build: `visual-evidence/soft-overlays/after/built-preview.png` and `built-style-verification.json`.
- The independent preview is http://127.0.0.1:5176/ with synthetic data and no copied credentials. Production 5174 and earlier preview 5175 were not replaced.

## Validation status

Final source-static `pnpm e2e --update-snapshots=none` passed 67/67. Static validation passed 428 tests in 48 files, lint and TypeScript; production build passed with the existing main-bundle size warning. No PR was created, no merge performed, and no production deployment performed.
