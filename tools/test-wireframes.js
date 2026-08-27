#!/usr/bin/env node
/**
 * test-wireframes.js — guard over scanWireframes(), the reader behind the dashboard's "Your designs"
 * band and the journal's wireframe events.
 *
 * Why this exists. The band's whole claim is that it shows every generated wireframe honestly, and the
 * scan that backs it reads a tree nobody controls: `wireframes/<page>/round-N/` is written by an AI
 * following skills/wireframe-on-snapshot/SKILL.md, and rounds on disk vary more than the skill implies
 * — preview PNGs under three different names, notes.md in four different prose shapes, hard-wrapped
 * paragraphs, extra frames, `.baked.html` derivatives, and folders whose page a re-capture has since
 * retired. Every one of those was found in a real round while building the band. This file pins them.
 *
 * The failures it is built for are OMISSIONS and MISREADINGS, which no build error surfaces:
 *   · an approach silently dropped (wrong preview name, unhandled dir shape) → band understates the work
 *   · a `.baked.html` counted as its own design → every baked approach doubles
 *   · a caption read off a render-output line → cards captioned with their own filenames
 *   · a hard-wrapped intent cut at the wrap → "…reduce visual" as the round's stated purpose
 *   · an orphan folder labeled a new-page concept → the dashboard claims the product lacks a page it has
 *   · non-total sort order → two rounds written in the same second swap places between builds, which
 *     would break build-index's run-twice-identical property
 *
 * Fixtures are BUILT HERE in a temp dir rather than pointed at a sibling workspace: the shapes under
 * test have to be present and stable, and none of them ship inside this repo.
 *
 * Usage: node tools/test-wireframes.js      (exit 0 = pass, 1 = fail)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanWireframes } = require('./build-index.js');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`); } };
const eq = (got, want, what) => ok(got === want, what, got);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dck-wf-'));
const LIB = path.join(ROOT, 'design-context');
const WF = path.join(ROOT, 'wireframes');
const w = (rel, body) => { const p = path.join(WF, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
fs.mkdirSync(LIB, { recursive: true });

// ── the fixture tree ───────────────────────────────────────────────────────────────────────────────
// orders/ — a captured page. Bullet-shape notes, canonical .preview.png, plus a .baked.html that must
// NOT become a card of its own and a .mobile.png that must be a VIEW of 01, not a card.
w('orders/round-1/01-timeline-months.html', '<html><title>a</title>');
w('orders/round-1/01-timeline-months.preview.png', 'x');
w('orders/round-1/01-timeline-months.mobile.png', 'x');
w('orders/round-1/01-timeline-months.baked.html', '<html>');
w('orders/round-1/02-attention-first.html', '<html>');
w('orders/round-1/02-attention-first.png', 'x');            // bare .png — the accepted alias
w('orders/round-1/notes.md', [
  '# Orders — round 1',
  'Baseline: design-context/pages/orders/page.html (untouched). Intent: make order status',
  'scannable at a glance; reduce visual noise from promotional modules.',
  '',
  '- **01-timeline-months** — month headers + one-line rows + status chips. Scan by WHEN.',
  '- **02-attention-first** — actionable items first, done items collapse into a dense list.',
].join('\n'));

// orders/round-2 — heading-shape notes that name the file, and a file with NO preview at all
w('orders/round-2/01-timeline-refined.html', '<html>');
w('orders/round-2/notes.md', [
  '# Orders, round 2',
  '',
  '**Brief:** take round-1 01 and fix the density, keeping the same familiar table so merchants',
  'do not have to relearn the page.',
  '',
  '## 01 — Timeline refined (`01-timeline-refined.html`)',
  '**Model: ranking inside the one familiar table.** Same columns, same chips, tighter rows.',
].join('\n'));

// orders/round-3 — the intent on the heading line itself, which is where a SHORT one lives
w('orders/round-3/01-status-first.html', '<html>');
w('orders/round-3/notes.md', '# Orders — round 3 · intent: status first, everything else second\n');

// new/order-tracking — a page the product does not have (§7)
w('new/order-tracking/round-1/01-timeline-spine.html', '<html>');
w('new/order-tracking/round-1/01-timeline-spine.preview.png', 'x');
w('new/order-tracking/round-1/notes.md', [
  '# Order tracking — a new page, round 1',
  '',
  'Goal: a live shipment timeline the product has no page for.',
  '',
  '| file | model |',
  '|---|---|',
  '| `01-timeline-spine.html` | shipment-first, one vertical timeline |',
].join('\n'));

// retired-page/ — a folder matching NO captured page and not under new/: design work whose page a
// re-capture removed. Must be neither a concept nor linked to a page.
w('retired-page/round-1/01-orphan.html', '<html>');

// index-heading/ — notes whose sections head with the INDEX only, and mention the filename solely in a
// render-output line. The trap: that line mentions the file but says nothing about the design.
w('index-heading/round-1/01-single-column.html', '<html>');
w('index-heading/round-1/01-single-column.preview.png', 'x');
w('index-heading/round-1/notes.md', [
  '# Receiving Accounts — minimal layout explorations (round 1)',
  '',
  'Goal: explore minimal layouts for the product page.',
  '',
  '## 01 — Single column, linear narrative',
  'One centered 680px column, everything stacked. No side-by-side grids at all.',
  '',
  '## Renders',
  '- `01-single-column.html` → `01-single-column.preview.png`',
].join('\n'));

// noise that must be ignored entirely
fs.mkdirSync(path.join(WF, 'orders/notes-scratch'), { recursive: true });   // not a round-*
w('orders/round-1/.DS_Store', 'junk');
w('.DS_Store', 'junk');

const PAGES = new Set(['orders', 'index-heading']);
const labels = { orders: 'Orders', 'index-heading': 'Receiving Accounts' };
const run = () => scanWireframes(LIB, (s) => labels[s] || s, (s) => PAGES.has(s));
const r = run();
const byId = {}; r.items.forEach(i => { byId[i.id] = i; });
const one = (frag) => r.items.find(i => i.id.includes(frag));

console.log('\ntest-wireframes — discovery: every round, every approach, nothing extra');
eq(r.rounds.length, 6, 'six rounds found (orders×3, new/order-tracking, retired-page, index-heading)');
eq(r.items.length, 7, 'seven wireframes found');
ok(!r.items.some(i => /\.baked/.test(i.approach) || /baked/.test(i.file)),
  'a .baked.html (lofi-bake\'s Figma-bound derivative) is NOT a design of its own');
ok(!r.items.some(i => /notes-scratch|\.DS_Store/.test(i.id)), 'non-round dirs and dotfiles ignored');

console.log('\ntest-wireframes — previews: canonical name, accepted alias, and extra frames');
eq(one('01-timeline-months').preview, '../wireframes/orders/round-1/01-timeline-months.preview.png', 'canonical .preview.png is the preview');
eq(one('02-attention-first').preview, '../wireframes/orders/round-1/02-attention-first.png', 'a bare .png is accepted as the alias');
eq(one('01-timeline-refined').preview, null, 'an approach with no PNG reports null (map.js renders it on demand)');
eq(one('01-timeline-months').views.length, 1, 'a .mobile.png is one extra VIEW…');
eq(one('01-timeline-months').views[0].label, 'mobile', '…labeled from its own suffix');
ok(!r.items.some(i => /mobile/.test(i.approach)), '…and never a second card');

console.log('\ntest-wireframes — the three kinds of folder, told apart');
const orders1 = one('orders/round-1/01');
eq(orders1.page, 'orders', 'a folder matching a captured page carries that page');
eq(orders1.pageLabel, 'Orders', '…and its display label, not the raw slug');
const concept = one('new/order-tracking');
eq(concept.page, null, 'a new/ concept has no page');
eq(concept.concept, 'order-tracking', '…it has a concept');
eq(concept.pageLabel, 'Order tracking', '…and a prettified label');
const orphan = one('retired-page');
eq(orphan.page, null, 'an orphan (page retired by a re-capture) has no page…');
eq(orphan.concept, null, '…and is NOT reported as a new-page concept');
eq(orphan.key, 'retired-page', '…but still carries its own key, so it groups and filters');

console.log('\ntest-wireframes — notes.md, read across every shape found on real rounds');
ok(/^make order status scannable at a glance; reduce visual noise from promotional modules\.$/.test(orders1.intent),
  'a hard-wrapped intent is unwrapped to the whole sentence, not cut at the wrap', orders1.intent);
ok(/^make order status/.test(orders1.intent),
  '…and the `Intent:` label is found mid-line, after the baseline sentence that precedes it', orders1.intent);
eq(one('orders/round-3').intent, 'status first, everything else second',
  'an intent riding on the heading line is read from there');
ok(/^month headers/.test(orders1.desc), 'bullet shape: `- **01-name** — …`', orders1.desc);
ok(/^Model: ranking inside/.test(one('01-timeline-refined').desc), 'heading shape naming the file', one('01-timeline-refined').desc);
ok(/^take round-1 01/.test(one('01-timeline-refined').intent), '`**Brief:**` reads as the round intent', one('01-timeline-refined').intent);
ok(/shipment-first/.test(concept.desc), 'table-row shape', concept.desc);
const ih = one('index-heading');
ok(/^One centered 680px column/.test(ih.desc),
  'heading shape naming only the INDEX, with the filename appearing solely in a render-output line', ih.desc);
ok(!/\.png/.test(String(ih.desc)), '…and that render-output line is never taken as the rationale');
eq(one('retired-page').intent, null, 'a round with no notes.md reports null intent, not a guess');
eq(one('retired-page').desc, null, '…and null desc');
eq(one('retired-page').name, 'Orphan', '…while the name still comes from the filename');

console.log('\ntest-wireframes — ordering is newest-first AND total (build-twice stability)');
const at = r.rounds.map(x => x.at || '');
ok(at.every((v, i) => i === 0 || at[i - 1] >= v), 'rounds are newest-first');
// force a tie: identical mtimes on two rounds must still produce one fixed order
const tie = new Date('2026-01-02T03:04:05Z');
for (const d of [path.join(WF, 'orders/round-1'), path.join(WF, 'orders/round-2'), path.join(WF, 'retired-page/round-1')]) fs.utimesSync(d, tie, tie);
const a = run(), b = run();
eq(JSON.stringify(a.items.map(i => i.id)), JSON.stringify(b.items.map(i => i.id)),
  'same tree scanned twice → identical order, even with tied mtimes');
ok(a.rounds.filter(x => (x.at || '') === tie.toISOString()).length === 3, 'the tie really was tied (the check above means something)');

console.log('\ntest-wireframes — byPage, the atlas panel\'s round badge');
eq(r.byPage.orders.rounds, 3, 'orders has three rounds');
eq(r.byPage.orders.items, 4, '…and four wireframes');
ok(!('retired-page' in r.byPage) && !('order-tracking' in r.byPage),
  'byPage holds only real captured pages — never an orphan or a concept');

console.log('\ntest-wireframes — an absent wireframes/ dir is not an error');
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dck-wf-bare-'));
fs.mkdirSync(path.join(bare, 'design-context'), { recursive: true });
const empty = scanWireframes(path.join(bare, 'design-context'), (s) => s, () => true);
eq(empty.items.length, 0, 'no wireframes/ dir → empty items');
eq(empty.rounds.length, 0, '…empty rounds');
eq(Object.keys(empty.byPage).length, 0, '…empty byPage');
fs.rmSync(bare, { recursive: true, force: true });
fs.rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
