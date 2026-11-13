# Visible Block Review Implementation Plan

> For agentic workers: use subagent-driven-development. Check each outcome before delivery.

Goal: directly visible red original / green proposed modules, not hidden numbered bubbles.
Architecture: Canvas-only normal-flow wrappers plus readonly compiled suggestion frames and per-item accept/reject chat controls; reuse unchanged proposal safety.
Tech Stack: existing React, TypeScript, Vite, Playwright.
Spec: docs/superpowers/specs/2026-11-14-visible-block-review-design.md

## Constraints
- Content/export isolation; no real paid AI requests; preserve stale/idempotence/undo safeguards and素材 import.
- Text remains sharp; green/red each also have explicit text and keyboard accessible controls.
- Existing feature branch and preview5176 only; no new PR or production change.

## Review focus
Long HTML, multiple overlapping operations, inserted/deleted/missing targets, narrow screens/zoom, keyboard shortcuts while suggestion focused.

### Task1 UI and rendering
- [ ] Pure helper tests fail for full block update/insert/delete rendering, then implement safe render model.
- [ ] Replace markers and popup-diff UX with normal-flow original/suggestion pairs and top-right action bubble.
- [ ] Preserve batch preview, honest stale status, modal and keyboard safeguards.

### Task2 browser acceptance
- [ ] Rewrite only UX assertions that latest user direction supersedes; retain persisted/export/undo/stale/shortcut safety assertions.
- [ ] Add always-visible full-module, insert/delete, green/red control, layout nonoverlap and readable frame tests.
- [ ] Capture actual desktop/tablet/phone light/dark and long-content views.

### Task3 delivery
- [ ] Independent review, lint/types/unit/build and full fixed-baseline E2E.
- [ ] Refresh isolated preview, commit/push authorized branch, track exact CI, deliver screenshots and honest gaps.