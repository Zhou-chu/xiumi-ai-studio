# Local Sonar candidate follow-up

The private, local-only analysis of revision 4f807b298f8199019189ce66e59d3b64c0108dc5 completed successfully but its independent Overall gate was ERROR, not passed. Native coverage was 95.3% (line 98.5%, branch 92.1%); Maintainability A; Reliability D with 38 issues; Security C with one issue. No hotspots were reported. These counts must not be compared directly with the older Cloud analysis because profiles/language support differ. PowerShell/shell are not supported by this local analyzer; Pester remains separate.

Six core reliability findings addressed in this patch:
- articleImages S8786: real image collection with an unclosed CSS URL and 400,000 spaces exceeded a bounded child deadline before the fix. Monotone delimiter indexes preserve the legacy quoted/unquoted fallback, whitespace and line-break behavior, including 4,000 deterministic comparisons. This is capture logic, not a sanitizer.
- outline S8786: the prior 6–39-character guard already bounded execution. Quantity matching is now explicitly linear while retaining that guard and exact units/punctuation. This is a static-analysis clarity improvement, not a new observed unbounded runtime flaw.
- ops S7727: pass exactly the document and operation to the reducer. Sequential output and nonmutation are characterized.
- wxImport S7773, three findings: Number.NaN is an equivalent namespace clarification, not a behavior fix.

Verification before connection interruption: 84 focused tests, TypeScript and focused ESLint passed. No full-suite or new Sonar resolution claimed. Added production cssImageUrls.ts belongs in the complete denominator.

Security S5693 remains pending in this patch. Its native recommended upload limit is 8,000,000 bytes; the product intentionally accepts 30 MiB per file and 64 MiB cumulative request data. The user-approved follow-up preserves those capabilities while adding disk streaming, a two-request admission budget and a 120-second upload deadline. It must remain explicit that Sharp decoding and other processing memory are outside the file-buffer budget. No rule threshold/profile/issue state has been changed.
