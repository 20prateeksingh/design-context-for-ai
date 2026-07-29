#!/usr/bin/env node
/**
 * route-pattern.js — canonical id-like-segment detection (segment → :id).
 *
 * hygiene.js, capture.js, and build-index.js each carried an independent copy of this heuristic
 * (a known, named drift class in this codebase — see wizard-url.js / test-routekey.js for the same
 * "hand-synced mirror" problem). hygiene.js's copy was the narrowest: its `length >= 12` clause
 * couldn't see Amazon's 10-character mixed-case ASIN (`B0CTFD7GZL`), so same-template and
 * duplicate-content detection went blind on exactly the product genre where template noise is
 * worst. This module is the one canonical copy, adopting build-index.js's broader rule wholesale
 * (prds/small-open-items-round.md, S1 — a real decision, not a merge of all three variants).
 *
 * hygiene.js requires this module and its own mirror is deleted. capture.js and build-index.js
 * keep their own inline copies for now — a capture-time change would move registry.json and blow
 * determinism, out of scope for this round; this is a hygiene-read-path change only.
 *
 * Pure functions only — no filesystem, no network.
 */

// A route segment that looks like a database id/slug rather than a static route piece.
function isIdSegment(seg) {
  return /^\d+$/.test(seg) ||
    /^[0-9a-f]{12,}$/i.test(seg) ||
    (/\d/.test(seg) && seg.length >= 8 && /^[A-Za-z0-9_-]+$/.test(seg));
}

// route (path, optionally with a query string) → pattern with id-like segments replaced by :id.
// Non-id segments are lowercased so two casings of the same static route collapse to one pattern.
function patternize(route) {
  try {
    const segs = (route || '/').split('?')[0].split('/').filter(Boolean).map(s => isIdSegment(s) ? ':id' : s.toLowerCase());
    return '/' + segs.join('/');
  } catch { return route || '/'; }
}

module.exports = { isIdSegment, patternize };
