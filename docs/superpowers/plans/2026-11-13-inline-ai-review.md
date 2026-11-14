# Inline AI Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Review AI changes beside the corresponding article instead of a sidebar diff list.
**Architecture:** Existing proposal store remains the mutation boundary; a canvas-shell overlay measures real block/slot nodes and renders markers plus a single bubble. UI never mutates authored HTML to decorate it.
**Tech Stack:** Existing React, TypeScript, Zustand, CSS, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-13-inline-ai-review-design.md

## Global Constraints
- Preserve production 5174, owner data, other themes and export content.
- No PR creation; use existing authorized feature branch only after verification.
- No additional real model requests; synthetic providers are labeled fixtures.

## Review Focus
- Repeated acceptance and stale click handlers must not duplicate inserts.
- Manual edits and shifted HTML slot IDs must not be overwritten.
- Multiple same-block operations must not silently overwrite each other.
- Scroll/zoom/phone clipping must not detach the bubble from its target.
- Undo/export must not retain misleading review state or overlay markup.

### Task 1: Safe proposal resolution
Files: store.ts, new proposalSafety.ts, unit tests.
- [x] Add failing tests for duplicate/invalid indices, manual edits, independent fields, overlapping fields, shifted HTML slots, batch undo.
- [x] Implement getProposalItemIssue(proposal,doc,index), pending/idempotent resolution, stale status and explicit undo/redo invalidation.
- [x] Run focused tests and static checks.

### Task 2: Inline review overlay
Files: new InlineReview.tsx and inline-review.css, Canvas.tsx, RightPanel.tsx, Workspace.tsx, slots.ts read-only map.
- [x] Add failing geometry/anchor tests and browser expectations for removal of the sidebar list and visible in-document markers.
- [x] Implement block/slot measurement, collision-aware marker grouping, one bubble, keyboard controls and compact review navigation.
- [x] Remove sidebar diff list while preserving proposal generation and preview/batch behavior.
- [x] Verify authored HTML and export are byte-equivalent until acceptance.

### Task 3: Integration and delivery
Files: E2E tests, DESIGN.md, QA report and screenshots.
- [x] Exercise real route with synthetic multi-change response at 1440x900,1024x768,390x844 in light/dark, zoom/scroll, stale edit, accept/reject/undo, refresh/export.
- [x] Run check, build, full fixed-snapshot E2E and independent review.
- [ ] Commit/push authorized branch; check exact-commit CI; refresh only isolated preview and deliver evidence.
