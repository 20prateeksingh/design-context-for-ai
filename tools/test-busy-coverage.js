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
 *   3. REDUCED-MOTION (§R rider, map-legibility-round) — every looping indicator in the stylesheet
 *      resolves to a RUNNING animation under `prefers-reduced-motion`, asserted as a CLASS rather than
 *      one instance at a time. Checks 1 and 2 guard the JS side of "the kit shows it is working"; this
 *      one guards the CSS side, and it is the check that would have caught `.spin` and `.livedot` on its
 *      own. The bug it exists for: the stylesheet opens with a blanket `*{animation:none!important}`, so
 *      ANY indicator that loops at rest is silently frozen by reduced motion unless it carries its own
 *      higher-specificity `!important` override. `.ring` got one in `17cb7e6`; its two siblings did not,
 *      and nothing noticed for a round. So instead of naming the indicators, this check DERIVES them —
 *      every selector in the sheet that declares an infinite animation — and requires each one to be
 *      either overridden or listed in FROZEN_BY_DESIGN with a reason.
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
// 'auto-loop' — exempt from setBusy because there is NO control to ring: the call is made by an
//               automatic loop on first paint (missing wireframe previews), not by a click. Its
//               affordance is the card's own pending face plus a sticky toast, and BOTH are asserted
//               below — an auto-loop that goes silent is the same invisible-omission shape as the
//               ringless button this file exists for.
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
  { endpoint: '/api/wireframe-shot', mech: 'auto-loop', of: 'renderMissingPreviews — the designs band rendering a preview no round had on disk' },
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
  } else if (reg.mech === 'auto-loop') {
    const before = TEMPLATE.slice(Math.max(0, call.index - LOOKBACK * 3), call.index);
    ok(/toast\(/.test(before), `${label} — announces itself with a toast before the loop runs`);
    ok(TEMPLATE.includes('class="shot pend"') && /\.pg\.wf \.shot\.pend/.test(TEMPLATE),
      `${label} — the per-card pending face it updates exists in markup and stylesheet`);
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

// ── 3. REDUCED-MOTION — every looping indicator still runs under prefers-reduced-motion ─────────────
// Selectors that are ALLOWED to be frozen by the blanket rule. Each needs a reason, so freezing a new
// indicator is a conscious act recorded here rather than an omission nobody sees.
const FROZEN_BY_DESIGN = {
  '.skel::after': "a skeleton's SHAPE already conveys loading, and it is not a discrete action — the one exception the motion-pass comment names",
};

// Strip CSS comments, pull the stylesheet, and lift out the reduced-motion blocks (balanced braces).
function balancedFrom(src, openIdx) { // openIdx = index OF the '{'
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return { inner: src.slice(openIdx + 1, i), end: i + 1 }; }
  }
  return { inner: src.slice(openIdx + 1), end: src.length };
}
const STYLE = (TEMPLATE.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');

// The reduced-motion blocks come out; what is left is the "normal" cascade the blanket rule kills.
const RM_RE = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
let normal = '', rmText = '', cursor = 0, mm2;
while ((mm2 = RM_RE.exec(STYLE))) {
  const brace = STYLE.indexOf('{', mm2.index + '@media'.length);
  const { inner, end } = balancedFrom(STYLE, brace);
  normal += STYLE.slice(cursor, mm2.index);
  rmText += inner + '\n';
  cursor = end; RM_RE.lastIndex = end;
}
normal += STYLE.slice(cursor);

// Walk back from an `animation:` declaration to the selector that owns it. @keyframes bodies need no
// special handling: the walk stops at the FIRST brace behind the rule's own `{`, and a keyframes block's
// outer `}` is exactly that — so a rule following one still reads its own selector, not the keyframes'.
function selectorFor(src, declIdx) {
  const open = src.lastIndexOf('{', declIdx);
  if (open === -1) return null;
  let start = 0;
  for (let i = open - 1; i >= 0; i--) if (src[i] === '}' || src[i] === '{') { start = i + 1; break; }
  return src.slice(start, open).replace(/\s+/g, ' ').trim();
}
const ANIM_RE = /animation\s*:\s*([^;}]+)/g;
const looping = [];
let a1;
while ((a1 = ANIM_RE.exec(normal))) {
  if (!/\binfinite\b/.test(a1[1])) continue;
  const sel = selectorFor(normal, a1.index);
  if (sel && !looping.some(l => l.sel === sel)) looping.push({ sel, value: a1[1].trim() });
}

// The reduced-motion overrides, one entry per individual selector in each rule's selector list.
const overrides = {};
const ANIM_RE2 = /animation\s*:\s*([^;}]+)/g;
let a2;
while ((a2 = ANIM_RE2.exec(rmText))) {
  const sel = selectorFor(rmText, a2.index);
  if (!sel) continue;
  sel.split(',').forEach(s => { overrides[s.trim()] = a2[1].trim(); });
}

console.log('\ntest-busy-coverage — reduced motion: every looping indicator still animates (class-level guard)');
ok(looping.length > 0, 'found at least one looping animation in the stylesheet', `found ${looping.length}`);
ok(/^none\s*!important/.test(overrides['*'] || ''),
  'the blanket `*{animation:none!important}` reduced-motion rule is still present (this guard is only meaningful while it is)',
  `\`*\` resolves to \`${overrides['*'] || '(absent)'}\``);
for (const { sel } of looping) {
  if (FROZEN_BY_DESIGN[sel]) { ok(true, `${sel} — frozen by design: ${FROZEN_BY_DESIGN[sel]}`); continue; }
  const ov = overrides[sel];
  ok(!!ov, `${sel} — has a prefers-reduced-motion override`,
    'no reduced-motion rule targets this selector, so the blanket `*{animation:none!important}` freezes it');
  if (!ov) continue;
  ok(!/^\s*none\b/.test(ov), `${sel} — its reduced-motion animation is not \`none\``, `resolves to \`${ov}\``);
  ok(/\binfinite\b/.test(ov), `${sel} — its reduced-motion animation still loops`, `resolves to \`${ov}\``);
  ok(/!important/.test(ov), `${sel} — carries !important, so it outranks the blanket rule`, `resolves to \`${ov}\``);
  ok(!/\btransform\b|\brotate\b/.test(ov) && sel !== '*',
    `${sel} — the substitute is a class-selector rule (beats \`*\` on specificity), not another transform`);
}

finish();
