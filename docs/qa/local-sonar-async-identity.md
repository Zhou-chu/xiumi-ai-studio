# Local Sonar: asynchronous calls and selection identity

Baseline: local Sonar analysis of 4f807b298f8199019189ce66e59d3b64c0108dc5.

## Six ignored-promise findings (S9383)

App keyboard save and repaired-document save already delegate to saveNow/persistCurrent, which catches request errors, publishes the save error/conflict state, and resolves a boolean. Templates/components/model status/version refresh helpers already terminate in rejection handlers. Their six caller sites now explicitly use void; no catch was removed and no previously unhandled rejection is being hidden. This is an intent declaration, not six newly fixed runtime failures. Existing save rejection/conflict/late-response tests remain required.

## Stable selection identity (three S2871 findings)

The AI scope and late-response guard now share selectionIdentity. Its explicit code-unit comparator preserves the previous default-sort ordering and cannot change with browser locale. It does not mutate the caller array. A regression checks numeric-looking IDs, case differences, duplicates, reversed input, and an empty selection. No locale-dependent display collation is used for a persisted/request safety identity.

## Explicit map arguments (S7727)

ImportWizard variant maps explicitly pass both variant and index to card. A/B/C labels and choose actions keep the original index; the third array callback argument is not forwarded accidentally.

## Verification

Before changes: 76 targeted tests passed. After changes: 77 targeted tests passed (selection scope, save safety/concurrency, App, ImportWizard, KitPicker, RightPanel and Toolbar). Full lint and typecheck passed. Final aggregate coverage/browser/Sonar rerun is still required after all current follow-ups are integrated.
