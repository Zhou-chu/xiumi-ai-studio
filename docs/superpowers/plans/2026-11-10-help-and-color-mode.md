# Help, color mode and small screens implementation plan

**Goal:** Keep explanatory prose out of the working UI until requested, add user-controlled day/night shell colors, and cover phone/iPad workflows.

**Architecture:** Explicit React Help call sites, not global CSS hiding `.hint`. A separate color-mode provider controls editor-shell tokens; document content remains unchanged. Responsive CSS adapts shell layout only.

**Tech stack:** Existing React/TypeScript, CSS, Vitest and Playwright, with no new dependencies.

**Requirements:** Sustained hover (650 ms); keyboard and touch alternatives; retain consent, errors, live status, costs and compatibility limitations. Auto defaults to the current device timezone 07:00–19:00 light, night dark, with persisted manual choices. Support 390×844 phone and 820×1180 iPad plus landscape.

## Tasks and verification
- [x] Verify latest source main is an ancestor of fork baseline (6db83fba in 9f95738f), use isolated branch/worktree.
- [x] Inspect supplied reference screenshot, audit explanatory versus critical copy.
- [x] Write failing Help tests, implement title trigger/annotation and explicit migrations across editor panels/dialogs.
- [x] Write color mode unit tests, implement persistence/time refresh and scoped shell palette.
- [x] Integrate responsive CSS and viewport E2E; full lint/typecheck/379 unit tests/build pass.
- [ ] Run browser tests in a permitted desktop test environment; cloud Chromium cannot start (socket EPERM).
- [ ] Review final changes, publish authorized branch and verify exact remote SHA/CI.

## Review focus
- Fleeting hover and timer cleanup never leak a stale annotation; Escape dismisses help before its parent modal.
- Touch click and keyboard focus are available without relying on hover.
- Local storage denial, DST/timezone changes and suspended tabs do not break rendering or keep a stale color mode.
- Document HTML, images and export colors do not change with the UI theme.
- Narrow dialogs, toolbar actions and panels remain reachable and do not create horizontal viewport overflow.
