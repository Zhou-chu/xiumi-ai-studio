# Output token budget investigation

## Root cause

Saved DeepSeek profile in the isolated preview had maxOutputTokens=393216 and contextWindow=1048576. Persistence was intact. Generation routes supplied fixed maxTokens budgets and chatText took min(task budget, configured maximum), so configuring a larger limit could never increase the actual request.

Previous limits: outline/enrich 8000, design/copywrite/edit 6000, photo placement 3000, instruction suggestions 2000. These are now defaultMaxTokens fallbacks ONLY when the model has no configured output budget. Explicit maxTokens remains a hard budget for capability probes. Connection test remains independently capped at 128; reasoning probes remain 64. User reasoning settings are not silently changed.

The error now reports the actual wire budget (including an adaptive provider reduction), configured budget, and numeric completion/reasoning usage when provided. It does not log generated text, reasoning content, or credentials. No partial JSON is applied.

## Real service verification

2026-11-13, existing authorized official DeepSeek/deepseek-flash profile, identical synthetic JSON task requesting 1600 objects:

| Path | Sent max_tokens | HTTP | finish_reason | completion_tokens | reasoning_tokens | Result |
|---|---:|---:|---|---:|---:|---|
| Legacy edit budget | 6000 | 200 | length | 6000 | 658 | Truncated, rejected |
| Configured generation budget | 393216 | 200 | stop | 16200 | 1193 | Valid JSON, all 1600 items |

Elapsed: approximately 17s and 43s. Saved settings SHA256 remained unchanged. Only numeric request/usage evidence was retained; no key or model reasoning was exposed. This verifies budget propagation and a >6000-token completion, not the full 393216-token maximum. The provider maximum is also documented at https://api-docs.deepseek.com/quick_start/pricing/ (384K, thinking enabled by default).

## Functional contract

- Configured positive maxOutputTokens governs ordinary generation, across all seven routes and both provider adapters.
- Unconfigured models use documented per-task defaults; explicit small capability probes stay bounded.
- Service rejection can still adapt to an explicitly reported smaller supported limit. Truncation includes that actual limit in its error.
- Context-window metadata remains informational; no tokenizer or input-budget reservation has been added. Existing input-character clipping and the 180-second timeout are separate limits, unchanged here.
- A larger maximum is an allowance, not a requirement to generate that many tokens; actual usage remains task-dependent.

## Checks and integration

8 dedicated regression cases cover configured, fallback, explicit probe, provider-adapted caps, reasoning settings, and all route call sites. Full baseline unit suite: 476 passed. TypeScript, targeted ESLint and production build passed; existing >500kB bundle warning remains.

This isolated patch is based on c961c78. Integration now has server/app.ts rather than server/index.ts: migrate the seven defaultMaxTokens call-site edits and route-source regression there, preserving multi-selection changes. No shared preview/prod service was replaced and no existing user document was submitted to the provider.
