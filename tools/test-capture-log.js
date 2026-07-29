#!/usr/bin/env node
/**
 * test-capture-log.js — unit tests for M1's registry.skips derivation (v1-fix-manifest-record).
 *
 * The bug: manifest.json only ever describes the latest run, so a later run silently destroys an
 * earlier run's skipped[]/failed[] record (real damage: espncricinfo's two blocked URL families
 * became unevidencable once a later crawl overwrote manifest.json). The fix appends one entry per
 * run to design-context/capture-log.json (capture.js's appendCaptureLog); build-index.js's
 * deriveSkips() then unions every run's skip/fail reasons into registry.skips, deduped by url/slug
 * with the latest run winning per key.
 *
 * Fixtures write a real capture-log.json/manifest.json into a scratch temp dir (deriveSkips reads
 * from disk, same as the real build), then assert the derived registry.skips shape.
 *
 * Run: node tools/test-capture-log.js   (exits 1 on any failure)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveSkips } = require('./build-index.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function scratchDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dck-test-capture-log-')); }
function writeCaptureLog(dir, runs) { fs.writeFileSync(path.join(dir, 'capture-log.json'), JSON.stringify({ runs })); }

console.log('\ntest-capture-log — registry.skips derivation from capture-log.json');

// 1. Multi-run union: a crawl's discovered-by-slug skip AND a later --urls pull's literal-url skip
//    both survive into registry.skips (this is the espncricinfo scenario the PRD names).
{
  const dir = scratchDir();
  writeCaptureLog(dir, [
    { at: '2026-07-01T00:00:00.000Z', mode: 'crawl', captured: 20, skipped: [{ slug: 'cricketers-id', reason: 'blocked' }], failed: [] },
    { at: '2026-07-02T00:00:00.000Z', mode: 'urls', captured: 3, skipped: [{ slug: 'records', url: 'https://espncricinfo.com/records/x', reason: 'blocked' }], failed: [] },
  ]);
  const skips = deriveSkips(dir, { skipped: [], failed: [] });
  check('both runs\' skips present', skips.length === 2, JSON.stringify(skips));
  check('crawl-mode skip keyed by slug (no literal url recorded)', skips.some(s => s.url === 'cricketers-id' && s.reason === 'blocked'));
  check('urls-mode skip keyed by its literal url', skips.some(s => s.url === 'https://espncricinfo.com/records/x' && s.reason === 'blocked'));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 2. Dedup on the same key: a later run for the same url overwrites the earlier entry, keeping its
//    (more recent) reason/at — not a growing duplicate list.
{
  const dir = scratchDir();
  writeCaptureLog(dir, [
    { at: '2026-07-01T00:00:00.000Z', mode: 'urls', captured: 0, skipped: [{ url: 'https://x.com/p', reason: 'auth-redirect' }], failed: [] },
    { at: '2026-07-05T00:00:00.000Z', mode: 'urls', captured: 0, skipped: [{ url: 'https://x.com/p', reason: 'blocked' }], failed: [] },
  ]);
  const skips = deriveSkips(dir, { skipped: [], failed: [] });
  check('same url across two runs collapses to one entry', skips.length === 1, JSON.stringify(skips));
  check('the later run\'s reason wins', skips[0] && skips[0].reason === 'blocked', JSON.stringify(skips));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 3. Failed entries carry through with their error as the reason.
{
  const dir = scratchDir();
  writeCaptureLog(dir, [{ at: '2026-07-01T00:00:00.000Z', mode: 'crawl', captured: 5, skipped: [], failed: [{ slug: 'checkout', url: 'https://x.com/checkout', error: 'net::ERR_TIMED_OUT' }] }]);
  const skips = deriveSkips(dir, { skipped: [], failed: [] });
  check('failed entry present with its error as reason', skips.some(s => s.url === 'https://x.com/checkout' && s.reason === 'net::ERR_TIMED_OUT'), JSON.stringify(skips));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 4. Manifest fallback: no capture-log.json yet (a workspace mid-upgrade) → seed from the latest
//    manifest so registry.skips isn't empty before the next real capture run.
{
  const dir = scratchDir(); // no capture-log.json written
  const manifest = { capturedAt: '2026-06-01T00:00:00.000Z', skipped: [{ slug: 'blocked-page', reason: 'blocked' }], failed: [] };
  const skips = deriveSkips(dir, manifest);
  check('falls back to manifest.skipped when capture-log.json is absent', skips.length === 1 && skips[0].url === 'blocked-page' && skips[0].reason === 'blocked', JSON.stringify(skips));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 5. No skips anywhere (clean capture) → empty array, not an error.
{
  const dir = scratchDir();
  writeCaptureLog(dir, [{ at: '2026-07-01T00:00:00.000Z', mode: 'crawl', captured: 20, skipped: [], failed: [] }]);
  const skips = deriveSkips(dir, { skipped: [], failed: [] });
  check('a clean run yields an empty skips array', Array.isArray(skips) && skips.length === 0, JSON.stringify(skips));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${failures ? '❌' : '✅'}  ${failures ? failures + ' failed' : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
