# HTML rendering security boundary

Based on679bc90. Production change is limited to core/sanitize.ts plus exact dependencies/lockfile. Existing article-import sanitizeTree remains unchanged; guardHtml now uses DOMPurify's real HTML/SVG namespace parser instead of string replacement.

## Reproduction and correction

Before: guardHtml retained href="java&#x73;cript:alert(1)". Parsing its output produced anchor.protocol="javascript:". No payload was executed. The original boundary also retained URL-changing SVG animation and forms. New29-case regression suite covers entities, mixed case, ASCII controls, dangerous schemes, real compileBlock output, nested namespace transitions, and safe links/layout/SVG.

The initial18-case suite had11failures before the fix. After DOMPurify integration it passed. Four additional assertions require removing an invalid SMIL node entirely rather than leaving an inert node with its dangerous value already stripped; these failed before the strict value policy and now pass. These four are policy-hardening tests, not four additional demonstrated executable bypasses.

## Preservation and restrictions

- Preserve HTML text, safe HTTP/HTTPS/mailto/fragment/relative links, inline styles, SVG shapes/text/viewBox and foreignObject HTML.
- Keep original class/id removal policy; this change does not newly strip them.
- Drop scripts, forms, frames and the existing DROP list. DOMPurify handles parsed URL attributes and event attributes, including entity-decoded and namespace-qualified forms.
- foreignObject is explicitly added with the documented HTML_INTEGRATION_POINTS configuration; its descendants are sanitized as HTML, including nested SVG/MathML. They are never copied without inspection.
- Preserve SMIL only for geometry/opacity/transform targets. href/xlink:href/style/event target attributes are not permitted, regardless of values/from/to/by.
- All animation values/from/to/by must be numeric sequences with optional standard units; animateMotion path additionally accepts SVG path command letters. Invalid animation nodes are removed. All animation href/xlink:href targets are removed (including namespace-specific href), restricting animation to its parent.
- This intentionally does not support arbitrary SMIL fill/style/URL mutation or expression-valued geometry. Do not expand the allowlist solely to preserve unsafe effects. Safe opacity and translation animations are tested in Chromium.
- DOMPurify is not a general CSS sanitizer. Existing inline publication styles are preserved; no claim is made that it removes all remote-resource CSS or performs content privacy filtering.

## Dependencies and runtime

Exact isomorphic-dompurify3.0.0 (MIT) uses compatible Node/browser conditional exports; exact dompurify3.4.17 (MPL2.0 OR Apache2.0) provides current sanitizer fixes. Locked wrapper runtime jsdom28.1 supports Node^20.19/^22.12/>=24, so this change does not raise the project's declared>=22.19 minimum. The repository already had dev jsdom30.1.3 with a stricter upstream engine requirement; this patch does not introduce that discrepancy.

pnpm audit --prod reported0vulnerabilities for the resolved production dependency graph. This is not a guarantee against undiscovered vulnerabilities. Lockfile adds dependencies without upgrading existing locked packages.

## Validation

-29new security/preservation cases pass.
-119tests in guardHtmlSecurity/import/components/kit suites pass.
-Typecheck and focused ESLint pass.
-Vite production build passes; pre-existing large-chunk warning remains.
-Real headless Chromium on an isolated ephemeral Vite port verifies browser conditional export: encoded dangerous href absent, foreignObject Chinese text retained, safe opacity animation retained. No shared preview/API server used.
-Node sanitizer exercised by unit and real compiler tests; browser production assets do not bundle jsdom.
-Full source suite/coverage and full browser regression intentionally left to integrator's serial final gate; not claimed rerun here.

Official references:
- https://github.com/cure53/DOMPurify
- https://github.com/kkomelin/isomorphic-dompurify
