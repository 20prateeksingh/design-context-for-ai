#!/usr/bin/env node
/**
 * test-busy-coverage.js — drift guard over the busy-ring inventory (busy-states-everywhere B1).
 *
 * F2 (ux-busy-states) wired every control that awaits an /api/* call through the shared `.ring` +
 * `setBusy()`. That round found two silent gaps (`#getone`/`#dlall` never passed a button reference
 * to `runCapture` at all) — a shape that degrades COMPLETELY SILENTLY: `runCapture`/`launchGuided`
 * both guard the busy call with `btn ? setBusy(btn) : ()=>{}`, so a call site that forgets the
 * second argument still captures correctly, just with no ring and no error. Nothing short of a
 * dedicated guard catches a regression like that — it does not throw, does not fail a build, and is
 * invisible in a diff that only touches call sites (the bug is an OMISSION, not a wrong value).
 *
 * Two independent checks, mirroring test-routekey.js / test-wizard-url.js / test-prompts.js's
 * static-analysis-over-the-template-source style (no jsdom — dashboard-template.html's script isn't
 * a module):
 *
 *   1. REGISTRY — every `api('/api/...')` call site in the template is enumerated here, in source
 *      order, with its busy mechanism. Locked COUNT (like test-prompts.js's LOCKED_TOKENS coverage
 *      check): a new call site that isn't added to REGISTRY fails the count assertion, forcing
 *      whoever adds it to consciously classify it as busy-wired or exempt (with a reason) instead of
 *      shipping silently uncovered.
 *   2. ARG-COUNT — every CALL SITE (not the definition) of `runCapture(` / `launchGuided(` passes a
 *      truthy second argument. This is the exact shape of the historical bug and the cheapest possible
 *      guard against its recurrence: a call site with a missing/falsy button argument fails here even
 *      though it would run the capture just fine.
 *
 * Usage: node tools/test-busy-coverage.js      (exit 0 = pass, 1 = fail)
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'dashboard-template.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };
const finish = () => { console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); };

// ── 1. REGISTRY — every api('/api/...') call site, in source order, with its busy mechanism ────────
// 'setBusy'   — must find a `setBusy(` call within LOOKBACK chars immediately before the api() call.
// 'onboarding'— exempt: the ONBOARDING → BOOT block shows its own full-screen phase view instead
//               (design-context-kit's onboarding gate requires this block to stay byte-identical —
//               a ring here would be a second, competing busy affordance, not a fix).
// 'fire-and-forget' — exempt, documented reason inline.
// 'render-ring'— exempt from the setBusy scan, but the ring markup it renders instead is asserted.
const REGISTRY = [
  { endpoint: '/api/onboard', mech: 'onboarding' },
  { endpoint: '/api/capture/start', mech: 'onboarding' },
  { endpoint: '/api/login/start', mech: 'onboarding' },
  { endpoint: '/api/capture/start', mech: 'onboarding' },
  { endpoint: '/api/capture', mech: 'setBusy', of: 'runCapture — the shared #getone/#dlall/#cov-*/#pdcov-*/#capbtn/hygiene-recapture entry point' },
  { endpoint: '/api/state', mech: 'setBusy', of: '#st-add (add & download state)' },
  { endpoint: '/api/guided/start', mech: 'setBusy', of: 'launchGuided — every "guided capture" trigger' },
  { endpoint: '/api/guided/stop', mech: 'render-ring', of: 'endGuided — "End session & save" (ring baked into the re-rendered label while `ending`, not a runtime setBusy call)' },
  { endpoint: '/api/figma-copy', mech: 'fire-and-forget', reason: 'not awaited by the button — a ledger record fired after the (already-busy) conversion already succeeded; has its own Converting…/Ready affordance' },
  { endpoint: '/api/hygiene/ack', mech: 'setBusy', of: 'hygiene card — "Keep" (ack-confirm)' },
  { endpoint: '/api/reached-by', mech: 'setBusy', of: 'hygiene card — "Done" (reached-by-confirm)' },
  { endpoint: '/api/hygiene/fold', mech: 'setBusy', of: 'hygiene card — "Fold into one"' },
];

console.log('\ntest-busy-coverage — every api(\'/api/...\') call site is enumerated in REGISTRY');
const CALL_RE = /\bapi\(\s*(['"])(\/api\/[^'"]+)\1/g;
const calls = [];
let m;
while ((m = CALL_RE.exec(TEMPLATE))) calls.push({ endpoint: m[2], index: m.index });
ok(calls.length === REGISTRY.length, `REGISTRY has one entry per call site (source order)`,
  `found ${calls.length} call site(s) in the template, ${REGISTRY.length} in REGISTRY`);

const ONBOARD_START = TEMPLATE.indexOf('// ═════════════════════════ ONBOARDING');
const DASHBOARD_START = TEMPLATE.indexOf('// ═════════════════════════ DASHBOARD');
ok(ONBOARD_START !== -1 && DASHBOARD_START !== -1 && ONBOARD_START < DASHBOARD_START,
  'ONBOARDING → BOOT protected block boundaries found');

const LOOKBACK = 260; // chars scanned backward from an api() call for a `setBusy(` in the same handler

console.log('\ntest-busy-coverage — every registered call site matches its declared busy mechanism');
for (let i = 0; i < Math.min(calls.length, REGISTRY.length); i++) {
  const call = calls[i], reg = REGISTRY[i];
  const label = `[${i}] ${reg.endpoint}${reg.of ? ` (${reg.of})` : ''}`;
  ok(call.endpoint === reg.endpoint, `${label} — endpoint matches`, `template has \`${call.endpoint}\``);
  if (reg.mech === 'setBusy') {
    const before = TEMPLATE.slice(Math.max(0, call.index - LOOKBACK), call.index);
    ok(before.includes('setBusy('), `${label} — preceded by setBusy(...) within ${LOOKBACK} chars`);
  } else if (reg.mech === 'onboarding') {
    ok(call.index > ONBOARD_START && call.index < DASHBOARD_START, `${label} — inside the ONBOARDING → BOOT block (exempt, has its own full-screen phase view)`);
  } else if (reg.mech === 'fire-and-forget') {
    ok(!!reg.reason, `${label} — exemption reason on file`, reg.reason);
  } else if (reg.mech === 'render-ring') {
    ok(true, `${label} — exempt from the setBusy scan (ring is baked into its re-rendered label; checked separately below)`);
  }
}

console.log('\ntest-busy-coverage — endGuided (guided/stop) still renders its ring in the re-rendered label');
ok(TEMPLATE.includes('const endBtnLabel = ending ? `<span class="ring" aria-hidden="true"></span>'),
  'endBtnLabel carries the ring while `ending`');
ok(/data-guided-end \$\{\(cap\|\|ending\)\?'disabled':''\}/.test(TEMPLATE),
  '"End session & save" is `disabled` for the same span it carries the ring');

// ── 2. ARG-COUNT — every CALL SITE of runCapture(/launchGuided( passes a truthy 2nd argument ────────
// Excludes the function DEFINITION line itself (`async function runCapture(urls, btn){` /
// `async function launchGuided(startUrl, btn){`) — only real call sites are checked.
function findCalls(name, src) {
  const out = [];
  const defRe = new RegExp(`function\\s+${name}\\s*\\(`);
  const re = new RegExp(`\\b${name}\\(`, 'g');
  let mm;
  while ((mm = re.exec(src))) {
    const isDef = defRe.test(src.slice(Math.max(0, mm.index - 20), mm.index + name.length + 1));
    if (isDef) continue;
    // balanced-paren scan for the argument list
    const start = mm.index + name.length + 1; // just after the opening (
    let depth = 1, i = start;
    for (; i < src.length && depth > 0; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; }
    out.push({ index: mm.index, args: src.slice(start, i - 1) });
  }
  return out;
}
// Split top-level commas only (ignore commas nested inside (), [], {}, or a ternary's own calls).
function splitTopLevel(argStr) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of argStr) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '' || parts.length) parts.push(cur);
  return parts.map((s) => s.trim()).filter((s, idx, arr) => !(idx === arr.length - 1 && s === ''));
}

console.log('\ntest-busy-coverage — every runCapture()/launchGuided() call site passes a truthy button argument');
for (const name of ['runCapture', 'launchGuided']) {
  const sites = findCalls(name, TEMPLATE);
  ok(sites.length > 0, `${name}() has at least one call site`, `found ${sites.length}`);
  sites.forEach((site, idx) => {
    const parts = splitTopLevel(site.args);
    const line = TEMPLATE.slice(0, site.index).split('\n').length;
    ok(parts.length >= 2 && parts[1].length > 0, `${name}() call #${idx + 1} (line ${line}) passes a 2nd argument`,
      `args: (${site.args})`);
  });
}

// ── Both covered-shape instances, distinct id prefixes (the brief's own callout) ────────────────────
console.log('\ntest-busy-coverage — both covered-shape instances are wired');
ok(TEMPLATE.includes("wireCoveredShape(el, covered, 'cov')"), "rail panel instance wired: wireCoveredShape(el, covered, 'cov')");
ok(TEMPLATE.includes("wireCoveredShape(el, pdCovered, 'pdcov')"), "page-doc instance wired: wireCoveredShape(el, pdCovered, 'pdcov')");

finish();
