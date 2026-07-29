---
name: capture-product
description: Point the kit at the designer's product and capture its navigation map + editable page snapshots into design-context/. Use when the designer says "capture my product", "set up my design context", "snapshot my app", or wants to start wireframing on a product that has no library yet.
---

# Capture Product

**Read `skills/capture-product/SKILL.md` (from this workspace's root) and follow it.** That file is the
skill; this one exists only so Claude Code discovers it.

Why the indirection: the procedure is referenced by path from `CLAUDE.md`, `AGENTS.md`, the dashboard's
copied prompts, and at runtime by `tools/lofi-check.js` and `tools/capture.js`. Moving it would break
those; duplicating it would let the two copies drift. So `skills/` stays canonical.

Before you start, note the first move it will tell you: don't hold this conversation at all if the
library is empty — start the dashboard (`node tools/map.js --port 4173`, **backgrounded**) and let the
designer follow its onboarding.
