# Provider error credential reflection boundary

Candidate based on a67372fa8aea1c636a387cd69bffba65c2b421b7. No portable logging dependency or deployed service changes.

## Behavior

Generation, direct/draft model discovery, and effort probe failures redact the active credential before leaving the provider boundary. Raw, JSON-string-escaped, and encodeURIComponent representations are replaced, including credentials without an sk prefix. Fresh errors retain only sanitized name/message, finite numeric or sanitized string code, and integer HTTP error status 400–599. Provider stack, cause, and arbitrary properties are not retained. Caller cancellation keeps its original reason identity; provider AbortError keeps the established 504 timeout. Null/undefined/string throws are normalized without a secondary TypeError.

This is exact active-credential reflection protection, not a universal secret detector: unknown secrets, arbitrary obfuscation/base64/double encoding, hostile getters/toString, and successful provider content are outside this change. No real credentials were read or sent.

## Evidence

- Initial 11 cross-function boundary cases: 8 red / 3 green before implementation, then 11 green.
- Added null/undefined rejection regression: 2 red before optional access, then green.
- Final focused run: 106/106 tests in seven files; TypeScript and changed-file ESLint exit 0; diff whitespace check clean.
- `providerError.test.ts`: 17 pure helper unit cases.
- `providerErrorBoundary.test.ts`: 14 mocked-provider/component integration cases, including real draft resolution through discovery. Its location under tests/unit does not make it strict unit coverage.
- Related protocol/network/budget/discovery tests remain green. No full suite, coverage, live API, Pester, deploy script, package build, CI or Sonar claim is made for this patch. Full CI/gates remain the coordinator's next step.

## Coverage scope

The new production helper server/providerError.ts must be included in the complete source denominator: historical 120 files becomes candidate 121. Historical reports are deliberately unchanged; no historical percentage is claimed for this candidate. Both pure and cross-function tests must be classified by behavior when strict unit coverage is measured.
