#!/usr/bin/env node
/**
 * test-prompts.js — every shipped PROMPTS.* string references a file the build actually produces (E13).
 *
 * F1 was exactly this class of bug: a prompt named `design-context/product.json`, a file only the
 * dashboard wizard writes, and it shipped undetected until an AI-readability experiment stumbled into
 * it. This makes "does every shipped prompt reference a file that exists?" a testable assertion.
 *
 * Method: extract the PROMPTS object literal out of dashboard-template.html (materialize it with
 * `new Function` — plain data + arrow functions returning strings, no external I/O), invoke every
 * entry with a representative fixture slug, then resolve every `tools/…`/`skills/…`/`design-context/…`
 * reference in the resolved text:
 *   - tools/*, skills/*  → must exist as a real file in this package (they ship with the kit).
 *   - design-context/*   → must be on the canonical shape a build always produces, or on the explicit
 *                          ALLOWLIST below with a documented reason.
 *
 * Usage: node tools/test-prompts.js      (exit 0 = pass, 1 = fail)
 */
const fs = require('fs');
const path = require('path');
const { extractPathRefs } = require('./path-refs.js');

const KIT_DIR = path.join(__dirname, '..');
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'dashboard-template.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };
const finish = () => { console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); };

console.log('\ntest-prompts — extract PROMPTS object literal');
const objStart = TEMPLATE.indexOf('const PROMPTS = {');
ok(objStart !== -1, 'PROMPTS object found in dashboard-template.html');
if (objStart === -1) finish();

// Balanced-brace scan from the opening `{` to its matching `}`. Safe here because no PROMPTS entry
// contains a literal `{`/`}` character (verified) — a real parser isn't needed for this shape.
const braceStart = TEMPLATE.indexOf('{', objStart);
let depth = 0, braceEnd = -1;
for (let i = braceStart; i < TEMPLATE.length; i++) {
  if (TEMPLATE[i] === '{') depth++;
  else if (TEMPLATE[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
}
ok(braceEnd !== -1, 'PROMPTS object literal is balanced (matching close brace found)');
if (braceEnd === -1) finish();

let PROMPTS;
try {
  PROMPTS = new Function('return ' + TEMPLATE.slice(braceStart, braceEnd + 1))();
  ok(true, 'PROMPTS object evaluates without error');
} catch (e) {
  ok(false, 'PROMPTS object evaluates without error', e.message);
  finish();
}

console.log('\ntest-prompts — every entry resolves to a string with a fixture slug');
const FIXTURE_SLUG = 'home';
const resolved = {};
for (const [name, entry] of Object.entries(PROMPTS)) {
  try { resolved[name] = String(entry(FIXTURE_SLUG)); ok(true, `PROMPTS.${name}() resolves to a string`); }
  catch (e) { ok(false, `PROMPTS.${name}() resolves to a string`, e.message); }
}

// ── Canonical shape: what a build always produces, regardless of product ──────────────────────────
// Root-level files build-index.js/capture.js always write once ANY capture has run. Anything under
// pages/ is accepted broadly (per-page filenames are already covered by build-index.js's own contract;
// the F1 bug class lived at the workspace root, not inside a page folder).
const ALWAYS_PATTERNS = [
  /^design-context\/?$/,
  /^design-context\/registry\.json$/,
  /^design-context\/INDEX\.md$/,
  /^design-context\/tokens\.json$/,
  /^design-context\/manifest\.json$/,
  /^design-context\/ia\/sitemap\.json$/,
  /^design-context\/annotations\.json$/,
  /^design-context\/pages\/.*$/,
];
// Files that exist ONLY under a documented condition — must be referenced with wording that guards it.
const ALLOWLIST = {
  'design-context/product.json': 'optional — written by the wizard only; PROMPTS.recaptureCheck (E1) and capture-product/SKILL.md §0 guard every reference with "if it exists"',
};

function classify(ref) {
  if (ref.startsWith('tools/') || ref.startsWith('skills/')) {
    return fs.existsSync(path.join(KIT_DIR, ref)) ? 'ok' : 'missing-on-disk';
  }
  if (ALLOWLIST[ref]) return 'ok-allowlisted';
  if (ALWAYS_PATTERNS.some((re) => re.test(ref))) return 'ok';
  return 'not-canonical';
}

console.log('\ntest-prompts — every design-context/·tools/·skills/ reference resolves or is allowlisted');
for (const [name, text] of Object.entries(resolved)) {
  const refs = extractPathRefs(text);
  for (const ref of refs) {
    const verdict = classify(ref);
    ok(verdict === 'ok' || verdict === 'ok-allowlisted',
      `PROMPTS.${name} → \`${ref}\``,
      verdict === 'ok-allowlisted' ? `allowlisted: ${ALLOWLIST[ref]}` : verdict);
  }
}

finish();
