#!/usr/bin/env node
/**
 * wizard-url.js — the wizard's URL-field normalizer (F5, UAT #14).
 *
 * Designers routinely type a bare domain ("pinterest.com") instead of a full URL. Prepend https://
 * when no scheme is present so the wizard accepts it, without silently rewriting a scheme the designer
 * DID type (never touch an explicit http://). Returns null when the result still doesn't parse as a
 * URL, so the caller can show its existing error copy unchanged.
 *
 * Canonical copy of this logic; dashboard-template.html's inline onboarding script mirrors it by hand
 * (the dashboard must stay a single self-contained file — see F7 / the file:// invariant) — kept in
 * sync the same way routeKey is (test-routekey.js), guarded here by test-wizard-url.js.
 *
 * Pure function only — no browser, no network.
 */
function normalizeWizardUrl(raw) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { new URL(withScheme); } catch { return null; }
  return withScheme;
}

module.exports = { normalizeWizardUrl };
