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

module.exports = { extractPathRefs };
