#!/usr/bin/env node
/**
 * path-refs.js — shared backtick-quoted path-reference extractor.
 *
 * Pulls every `tools/…`, `skills/…`, `design-context/…` reference out of a chunk of prose (a shipped
 * prompt, a CLAUDE.md/AGENTS.md file) so callers can check each one resolves somewhere real. Shared by
 * tools/test-prompts.js (canonical build-shape check over the shipped prompts, E13) and tools/hygiene.js
 * (live workspace check over that workspace's own CLAUDE.md/AGENTS.md, E14) — kept in one place so the
 * two never drift on what counts as a path reference.
 *
 * Usage: const { extractPathRefs } = require('./path-refs.js');
 */
function extractPathRefs(text) {
  const re = /`((?:tools|skills|design-context)\/[^`]+)`/g;
  const out = new Set();
  let m;
  while ((m = re.exec(String(text || '')))) out.add(m[1].trim());
  return [...out];
}

// F4: files a build never creates eagerly — all three are designer-owned and written lazily (or by
// hand), never by capture.js/build-index.js — so a fresh workspace's CLAUDE.md/AGENTS.md referencing
// them "if it exists" is correct, not a broken link. Matched by basename (any directory prefix), reason
// kept alongside each entry for whoever's reading the allowlist later. No other allowlisting.
const EXPECTED_ABSENT = {
  'annotations.json': 'designer-owned — written lazily by the dashboard (notes/states/hygiene acks & folds), not by capture or build-index',
  'product.json': 'designer-owned — written by the onboarding wizard only, once answered',
  'ux-copy.md': 'designer-owned — created by hand when the designer starts tracking copy decisions',
};
function expectedAbsentReason(ref) {
  const base = String(ref || '').split('/').pop();
  return EXPECTED_ABSENT[base] || null;
}

module.exports = { extractPathRefs, expectedAbsentReason };
