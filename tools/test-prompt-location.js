#!/usr/bin/env node
/**
 * test-prompt-location.js — a copied prompt must carry the ABSOLUTE folder it belongs to.
 *
 * The 12 shipped prompts are written in relative paths (`design-context/registry.json`,
 * `node tools/build-index.js`). A designer pastes one into a chat that was opened somewhere else and
 * every path fails, because nothing in the pasted text says where the toolkit is. The fix appends one
 * line naming the workspace, at copy time, in `copyPrompt`'s single funnel — see
 * dashboard-template.html above `function copyPrompt`.
 *
 * Method: the two pure functions are extracted out of dashboard-template.html and materialized with
 * `new Function`, exactly the way test-prompts.js materializes the PROMPTS object literal. Nothing here
 * reads PROMPTS or touches it: PROMPTS stays frozen, so every LOCKED_TOKENS / shape / negation
 * assertion in test-prompts.js keeps whatever verdict it already had, unmodified. (Measured 2026-08-27:
 * that file is 181 passed / 3 failed on `main` — PROMPTS.figma closes over IS_MAC, declared outside the
 * object literal, so `new Function` extraction throws for that one entry and the 12-entry count falls
 * over with it. Pre-existing since 90c0f6f, 2026-08-02, and deliberately not fixed here.)
 *
 * The canon string is asserted as a LITERAL below, once. That is deliberate: this line is the only
 * thing standing between a pasted prompt and an agent guessing at paths, and its wording mirrors
 * AGENTS.md's own closing sentence so the two surfaces agree. A future reword has to change it here
 * too, on purpose, rather than drifting.
 *
 * Usage: node tools/test-prompt-location.js      (exit 0 = pass, 1 = fail)
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'dashboard-template.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };
const finish = () => { console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); };

// ── Extract the two functions ─────────────────────────────────────────────────────────────────────
// Balanced-brace scan from `function NAME(` to the matching `}` of its body. Safe for these two
// because neither carries a `{`/`}` inside a string or regex literal — the same assumption, and the
// same technique, test-prompts.js uses on the PROMPTS literal.
function extractFn(name) {
  const at = TEMPLATE.indexOf(`function ${name}(`);
  if (at === -1) return null;
  const braceStart = TEMPLATE.indexOf('{', at);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < TEMPLATE.length; i++) {
    if (TEMPLATE[i] === '{') depth++;
    else if (TEMPLATE[i] === '}') { depth--; if (depth === 0) return TEMPLATE.slice(at, i + 1); }
  }
  return null;
}

console.log('\ntest-prompt-location — extract the copy-time workspace functions');
const srcWith = extractFn('withWorkspaceLine');
const srcFrom = extractFn('workspaceFromFileUrl');
ok(srcWith !== null, 'withWorkspaceLine() found in dashboard-template.html');
ok(srcFrom !== null, 'workspaceFromFileUrl() found in dashboard-template.html');
if (!srcWith || !srcFrom) finish();

let withWorkspaceLine, workspaceFromFileUrl;
try {
  ({ withWorkspaceLine, workspaceFromFileUrl } =
    new Function(`${srcWith}\n${srcFrom}\nreturn { withWorkspaceLine, workspaceFromFileUrl };`)());
  ok(typeof withWorkspaceLine === 'function' && typeof workspaceFromFileUrl === 'function',
    'both functions evaluate without error');
} catch (e) {
  ok(false, 'both functions evaluate without error', e.message);
  finish();
}

// ── The canon line, asserted as a literal ─────────────────────────────────────────────────────────
// Change this and dashboard-template.html together, never one without the other.
const CANON = (abs) =>
  'The toolkit is at `' + abs + '` — resolve every path above against that folder, not against where you\'re running.';

console.log('\ntest-prompt-location — withWorkspaceLine appends the canon line, or nothing at all');
// No workspace resolved → the prompt is returned untouched. Not a placeholder, not "your workspace
// folder", not a trailing blank line: if it was not measured, the surface says nothing.
ok(withWorkspaceLine('x', null) === 'x', 'withWorkspaceLine("x", null) is "x" exactly',
  JSON.stringify(withWorkspaceLine('x', null)));
ok(withWorkspaceLine('x', '') === 'x', 'withWorkspaceLine("x", "") is "x" exactly (empty string is falsy)',
  JSON.stringify(withWorkspaceLine('x', '')));
ok(withWorkspaceLine('x', undefined) === 'x', 'withWorkspaceLine("x", undefined) is "x" exactly',
  JSON.stringify(withWorkspaceLine('x', undefined)));

const got = withWorkspaceLine('x', '/a/b');
ok(got === 'x\n\n' + CANON('/a/b'), 'withWorkspaceLine("x", "/a/b") is "x" + blank line + the canon line',
  JSON.stringify(got));
ok(got.split('\n').length === 3, 'exactly one blank line between the prompt and the line',
  `${got.split('\n').length} lines`);
ok(!/\s$/.test(got), 'no trailing whitespace', JSON.stringify(got.slice(-4)));

// A Windows path goes through verbatim — backslashes are not escapes here.
const win = withWorkspaceLine('x', 'C:\\Users\\p\\acme');
ok(win === 'x\n\n' + CANON('C:\\Users\\p\\acme'), 'a Windows path is carried verbatim', JSON.stringify(win));

// The prompt body itself is never touched.
ok(withWorkspaceLine('line 1\n\n- a\n- b', '/a/b').startsWith('line 1\n\n- a\n- b\n\n'),
  'the prompt text above the line is unchanged');

// ── workspaceFromFileUrl: every row of the brief's table ──────────────────────────────────────────
console.log('\ntest-prompt-location — workspaceFromFileUrl derives the root off a file:// dashboard URL');
const CASES = [
  ['macOS/Linux',      'file:///Users/p/acme/design-context/dashboard.html',                       '/Users/p/acme'],
  ['spaces in path',   'file:///Users/p/Design%20Context/acme/design-context/dashboard.html',      '/Users/p/Design Context/acme'],
  ['Windows',          'file:///C:/Users/p/acme/design-context/dashboard.html',                    'C:\\Users\\p\\acme'],
  ['not that shape',   'file:///Users/p/something-else.html',                                       null],
  ['hash present',     'file:///Users/p/acme/design-context/dashboard.html#map',                   '/Users/p/acme'],
  ['query present',    'file:///Users/p/acme/design-context/dashboard.html?x=1',                   '/Users/p/acme'],
  // Extra shapes the table doesn't name but the browser really produces:
  ['localhost authority', 'file://localhost/Users/p/acme/design-context/dashboard.html',           '/Users/p/acme'],
  ['served, not file://', 'http://localhost:4173/design-context/dashboard.html',                    null],
  ['a sibling page',   'file:///Users/p/acme/design-context/pages/home/page.html',                  null],
  ['dashboard at /',   'file:///design-context/dashboard.html',                                     null],
  ['not a string',     null,                                                                        null],
];
for (const [label, input, want] of CASES) {
  const out = workspaceFromFileUrl(input);
  ok(out === want, `${label}: ${JSON.stringify(input)} → ${JSON.stringify(want)}`, `got ${JSON.stringify(out)}`);
}

// ── The two together, as copyPrompt uses them ────────────────────────────────────────────────────
console.log('\ntest-prompt-location — end to end, the way copyPrompt composes them');
const prompt = 'Describe this design-context library.\n\n- Read `design-context/registry.json`.\n- Say what it covers.';
const e2e = withWorkspaceLine(prompt, workspaceFromFileUrl('file:///Users/p/Design%20Context/acme/design-context/dashboard.html'));
ok(e2e === prompt + '\n\n' + CANON('/Users/p/Design Context/acme'),
  'a file:// copy ends on the canon line carrying the decoded absolute path', JSON.stringify(e2e));
ok(withWorkspaceLine(prompt, workspaceFromFileUrl('file:///Users/p/something-else.html')) === prompt,
  'an unresolvable URL leaves the prompt exactly as shipped');

// ── copyPrompt actually calls it (the funnel is wired) ───────────────────────────────────────────
// Everything above tests the pure functions. This asserts they are not dead code: the single funnel
// every prompt copy passes through runs withWorkspaceLine before the clipboard write.
console.log('\ntest-prompt-location — copyPrompt is wired to the funnel');
const copySrc = extractFn('copyPrompt') || '';
ok(/withWorkspaceLine\s*\(/.test(copySrc), 'copyPrompt calls withWorkspaceLine', copySrc.slice(0, 120));
ok(copySrc.indexOf('withWorkspaceLine') < copySrc.indexOf('clipboard'),
  'it appends BEFORE the clipboard write, so the manual copyFallback path carries the line too');
const currentSrc = extractFn('currentWorkspacePath') || '';
ok(/serverMode\s*&&\s*STATUS\s*&&\s*STATUS\.workspacePath/.test(currentSrc),
  'the served path reuses the existing STATUS.workspacePath guard, not a second expression');
ok(/workspaceFromFileUrl\s*\(\s*location\.href\s*\)/.test(currentSrc),
  'the file:// path falls back to workspaceFromFileUrl(location.href)');

// The path must never be written to disk — build-index.js bakes dashboard.html as a derived artifact
// that can be moved or committed, so the resolution has to stay in the browser at copy time.
ok(!/workspacePath/.test(fs.readFileSync(path.join(__dirname, 'build-index.js'), 'utf8')),
  'build-index.js never bakes a workspace path into dashboard.html');

finish();
