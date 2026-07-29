---
name: wireframe-on-snapshot
description: Wireframe a design change directly on top of a captured page snapshot from design-context/. Use when the designer says "wireframe on <page>", "redesign <page>", "explore a change to <page>", or wants to sketch ideas on their real product.
---

# Wireframe on Snapshot

**Read `skills/wireframe-on-snapshot/SKILL.md` (from this workspace's root) and follow it in full,
including §7 for a new page or flow that has no existing slug.** That file is the skill; this one
exists only so Claude Code discovers it.

Why the indirection: the procedure is referenced by path from `CLAUDE.md`, `AGENTS.md`, the dashboard's
copied prompts, and at runtime by `tools/lofi-check.js` (which reads its canonical lo-fi style blocks
out of that file) and `tools/lofi-bake.js`. Moving it would break those; duplicating it would let the
two copies drift. So `skills/` stays canonical.

Don't skip the guard it ends with: `node tools/lofi-check.js` on every round before you show it.
