# Visible block review design

User correction supersedes numbered markers: show the complete removed/replaced module in red and the complete suggested module directly below in green. A small chat bubble at its upper right holds green Accept and red Reject buttons. The suggested surface is subtly frosted, but text is never blurred.

Implementation decision: use Canvas-only review wrappers in normal document flow, with readonly compiled suggestion frames. This avoids overlays hiding following content. Stored document JSON and compile/export remain untouched until acceptance. The existing proposal safety layer is authoritative. No numbered-marker discovery step.

Each operation has an always-present review item. Replacements show current original plus proposed result; deletions show red original and explicit deletion; insertion shows the new green module at its insertion boundary; metadata/theme changes are explicitly labeled rather than masquerading as deleted article modules. Missing/stale targets remain explainable and cannot apply. Multiple changes remain independently actionable; overlapping edits are protected by existing stale rules.

No new integration PR, no production5174 changes. Preserve article-image import and its modal interaction. All visual evidence uses synthetic provider output. External CDN and real phone hardware remain unverified.