#!/usr/bin/env node
/**
 * test-prompts.js — every shipped PROMPTS.* string references a file the build actually produces (E13),
 * AND holds the shared human-readable shape without drifting a single instruction (prompt-readability).
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
 * Second half (prds/prompt-readability.md, 2026-07-30). The 11 prompts were single run-on paragraphs
 * graded only on "can a model follow this" — never on "can the designer read it in their own chat
 * window before hitting send", which is the only way they are ever used. They were reshaped to a
 * shared shape. Two things are guarded here, because the failure mode of a RESHAPE is a builder who
 * quietly "improves" an instruction while moving it:
 *   1. STRUCTURE — line 1 the ask · blank line · 2–5 plain `-` body lines · no markdown emphasis ·
 *      any prompt with a ‹placeholder› ends on the `FILL THIS IN: ` line.
 *   2. TOKEN-SET PARITY — every backticked span, § reference and `--flag` that shipped BEFORE the
 *      reshape (frozen in LOCKED_TOKENS below, generated off commit 779ffbb) is still present, and
 *      nothing new was introduced. A set assertion, not a string compare: layout is free to move,
 *      the paths/commands/§/flags are not.
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

// ── The shared human-readable shape (prds/prompt-readability.md) ───────────────────────────────────
// The marker is one fixed string across every prompt that has a ‹placeholder›. Change it here and in
// ux-copy.md together, never in one place only.
const MARKER = '- FILL THIS IN: ';

console.log('\ntest-prompts — every prompt holds the shared shape (line 1 · blank · 2–5 `-` lines)');
for (const [name, text] of Object.entries(resolved)) {
  const lines = text.split('\n');
  const body = lines.slice(2).filter((l) => l.trim());
  ok(lines.length >= 2, `PROMPTS.${name} is multi-line`, `${lines.length} line(s) — still a paragraph`);
  ok(!lines[0].startsWith('- ') && lines[0].trim().length > 0, `PROMPTS.${name} line 1 is the ask, not a bullet`);
  ok(lines[1] === '', `PROMPTS.${name} line 2 is blank`, JSON.stringify(lines[1]));
  ok(body.length >= 2 && body.length <= 5, `PROMPTS.${name} body is 2–5 lines`, `${body.length} lines`);
  ok(body.every((l) => l.startsWith('- ')), `PROMPTS.${name} body is plain \`-\` bullets`,
    body.filter((l) => !l.startsWith('- ')).join(' / '));
  ok(!body.some((l) => l.startsWith('- - ') || /^-\s{2,}/.test(l)), `PROMPTS.${name} has no nested list`);
}

// Chat inputs render `**bold**`/`_em_` as literal characters — A.8 shipped `**…**` for months.
console.log('\ntest-prompts — no markdown emphasis anywhere (chat inputs render it literally)');
for (const [name, text] of Object.entries(resolved)) {
  ok(!text.includes('**'), `PROMPTS.${name} has no \`**\``);
  // `_` only counts as emphasis outside backticks — file/flag names legitimately carry underscores.
  ok(!/(^|\s)_[^_`]+_(\s|[.,;:]|$)/.test(text.replace(/`[^`]+`/g, '`')), `PROMPTS.${name} has no \`_em_\``);
}

console.log('\ntest-prompts — every ‹placeholder› is findable: the marker line, last in the body');
for (const [name, text] of Object.entries(resolved)) {
  if (!text.includes('‹')) continue;
  const body = text.split('\n').slice(2).filter((l) => l.trim());
  ok(text.includes(MARKER.trimStart()), `PROMPTS.${name} carries the "${MARKER.trim()}" marker`);
  ok(body[body.length - 1].startsWith(MARKER), `PROMPTS.${name} ends on the marker line`, body[body.length - 1]);
}

// ── Token-set parity: the reshape may not move a path, command, § or flag ──────────────────────────
// Frozen off commit 779ffbb — the last build BEFORE the reshape. A prompt may be re-laid-out freely;
// the moment its path/command/§/flag set differs from this table the reshape stopped being a reshape.
// Fixture slug is FIXTURE_SLUG ('home'), so `wireframes/home/round-1/` is the resolved form.
// `ph` (the ‹placeholder› set) is locked too — without it, DELETING a placeholder outright would
// skip the marker assertions above and pass silently. Found by mutation-testing this file.
const LOCKED_TOKENS = {
  describeLibrary: { code: ['`content.md`', '`design-context/registry.json`', '`meta.json`', '`node tools/build-index.js`', '`page.md`', '`screenshot.png`', '`skills/capture-product/SKILL.md`'], sec: ['§5'] },
  wireframe: { code: ['`design-context/`', '`design-context/pages/home/page.md`', '`design-context/registry.json`', '`node tools/shot.js`', '`screenshot.png`', '`skills/wireframe-on-snapshot/SKILL.md`', '`wireframes/home/round-1/`'], ph: ['‹describe your change›'] },
  whatsMissing: { code: ['`design-context/registry.json`', '`frontier`', '`states`'] },
  addState: { code: ['`design-context/pages/<slug>/states/`', '`node tools/capture.js --state <slug>:<state-name> --url "<the url>"`'], flag: ['--state', '--url'] },
  guided: { code: ['`design-context/pages/…`', '`method: guided`', '`node tools/build-index.js`', '`node tools/capture.js --guided --url ‹where to start›`'], flag: ['--guided', '--url'], ph: ['‹where to start›'] },
  auditTokens: { code: ['`design-context/tokens.json`'] },
  recaptureCheck: { code: ['`contentHash`', '`design-context/manifest.json`', '`design-context/product.json`', '`design-context/registry.json`'] },
  bootstrap: { code: ['`AGENTS.md`', '`design-context/registry.json`'] },
  designNew: { code: ['`ASSUMED: …`', '`design-context/`', '`design-context/registry.json`', '`node tools/shot.js`', '`notes.md`', '`skills/wireframe-on-snapshot/SKILL.md`', '`tokens.json`', '`wireframes/new/<kebab-case name for this concept, your choice>/round-1/`'], sec: ['§7'], ph: ['‹describe it›'] },
  askQuestion: { code: ['`INDEX.md`', '`design-context/registry.json`'], ph: ['‹your question›'] },
  figma: { code: [] },
};
const CLASSES = { code: /`[^`]+`/g, sec: /§\s*\d+/g, flag: /--[a-z][a-z-]*/g, ph: /‹[^›]+›/g };
const uniq = (s, re) => [...new Set(s.match(re) || [])].sort();

// A path-and-command guard cannot see a PROSE prohibition being softened — "never invent house style"
// → "avoid inventing house style" moves no token and passes everything above. Found by mutation-testing
// this file, and it is precisely the failure mode the reshape had to be protected from. So the negation
// MULTISET is locked per prompt: soften, drop or add a "never"/"don't"/"not" and this fails. Counts are
// the pre-reshape ones (779ffbb) and matched the reshaped strings exactly, with no exceptions.
const NEGATION = /\b(never|don't|do not|cannot|can't|not|no)\b/gi;
const LOCKED_NEG = {
  describeLibrary: { not: 1, never: 2 },
  wireframe: { never: 1 },
  whatsMissing: { not: 1, "don't": 1 },
  addState: {},
  guided: {},
  auditTokens: { not: 1 },
  recaptureCheck: {},
  bootstrap: {},
  designNew: { never: 2 },
  askQuestion: {},
  figma: {},
};
const negMultiset = (s) => (s.match(NEGATION) || []).reduce((m, x) => { const k = x.toLowerCase(); m[k] = (m[k] || 0) + 1; return m; }, {});

console.log('\ntest-prompts — token-set parity with the pre-reshape strings (paths · commands · § · flags)');
ok(Object.keys(LOCKED_TOKENS).length === Object.keys(resolved).length,
  'LOCKED_TOKENS covers every shipped prompt',
  `${Object.keys(LOCKED_TOKENS).length} locked vs ${Object.keys(resolved).length} shipped`);
for (const [name, text] of Object.entries(resolved)) {
  const locked = LOCKED_TOKENS[name];
  if (!locked) { ok(false, `PROMPTS.${name} has a LOCKED_TOKENS entry`, 'new prompt — add its pre-reshape token set'); continue; }
  for (const cls of Object.keys(CLASSES)) {
    const want = locked[cls] || [], got = uniq(text, CLASSES[cls]);
    const dropped = want.filter((t) => !got.includes(t));
    const added = got.filter((t) => !want.includes(t));
    ok(dropped.length === 0 && added.length === 0, `PROMPTS.${name} ${cls} set unchanged (${want.length})`,
      [dropped.length ? `dropped: ${dropped.join(' ')}` : '', added.length ? `added: ${added.join(' ')}` : ''].filter(Boolean).join(' · '));
  }
}

console.log('\ntest-prompts — no prohibition was softened (locked negation multiset)');
for (const [name, text] of Object.entries(resolved)) {
  const want = LOCKED_NEG[name], got = negMultiset(text);
  if (!want) { ok(false, `PROMPTS.${name} has a LOCKED_NEG entry`, 'new prompt — add its pre-reshape negation counts'); continue; }
  const w = JSON.stringify(Object.entries(want).sort()), g = JSON.stringify(Object.entries(got).sort());
  ok(w === g, `PROMPTS.${name} negations unchanged (${JSON.stringify(want)})`, `now ${JSON.stringify(got)}`);
}

finish();
