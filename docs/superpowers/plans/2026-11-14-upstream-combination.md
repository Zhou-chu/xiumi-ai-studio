# Upstream PR 7–10 Integration Plan

**Goal:** Verify the reviewed upstream contribution batches together without replacing upstream workflows.
**Architecture:** Isolated integration of save ownership, editorial shell, parser/portable runtime, and test-only loopback configuration. No production deployment or upstream merge.
**Tech stack:** Existing React/Vite/Express/TypeScript and Windows Playwright matrix.

## Constraints
- Preserve upstream portable, 8 GiB backup, selected-edit filter/strict, color and replay contracts.
- Retain revision conflicts, late-result guards and ApiError status.
- Mixed coverage is not strict unit; refreshed Windows EXE remains a separate unverified gate.
- No production data, desktop state, credentials or existing PR branches are overwritten.

## Tasks
- [x] Independently inspect branch overlap and resolve save/UI imports and ownership conflicts.
- [x] Reproduce mismatched test storage origin; use one baseURL for dev/packaged browser storage.
- [x] Run aggregate lint/types/mixed tests/build on combined source.
- [ ] Publish isolated combination candidate only after static and aggregate checks; verify Windows CI independently.
- [ ] Validate refreshed Windows package when an appropriate environment is available.

## Review focus
- Slow startup cannot replace a document changed while loading.
- HTTP 409 retains conflict-copy behavior; unreadable successful JSON cannot create a draft.
- Toolbars keep save/navigation safety while moving actions into menus.
- Test origin remains deterministic in dev and packaged modes; shell's independent port is unchanged.
- HTML runtime dependency closure and downstream upload/image budgets remain present together.
