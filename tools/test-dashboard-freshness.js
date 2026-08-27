#!/usr/bin/env node
/**
 * test-dashboard-freshness.js — guard over the ONE defect that reached a designer.
 *
 * Why this exists. The dashboard's "Your designs" band is DERIVED: build-index.js scans the sibling
 * wireframes/ tree and bakes the result into dashboard.html. map.js only serves that tree as files.
 * So a round written after the last build is real on disk and absent from the page — and the
 * wireframe skill tells an AI to render previews and stop. An end-to-end run on a fresh clone
 * (2026-08-28) hit exactly that: three approaches on disk, band reading "No wireframes yet",
 * "wireframes 0 · rounds 0", and a hard reload unable to help. map.js now re-derives when the tree is
 * newer than the page.
 *
 * The failure shape is invisible from either side alone: build-index is correct (its scan finds the
 * round), the server is correct (it serves the file it has), and only the SEAM is wrong. Nothing short
 * of driving the real server against a real library catches it — which is why this test spawns one.
 *
 * It also pins the half that was wrong on the first attempt: the freshness walk stated every child of
 * wireframes/ but never the directory ITSELF, so deleting a whole round bumped only the parent's mtime
 * and went unnoticed. Additions worked; removals did not. Both directions are asserted here.
 *
 * WORKSPACE ARGUMENT, and why it is required rather than fabricated: the check only engages over a
 * REAL built library (no dashboard.html → nothing to be stale), and a synthetic one would drift from
 * what capture actually writes. So this test is skipped by default — the same posture as
 * test-port-select.js — and runs when you point it at a workspace. It spawns THAT workspace's own
 * tools/map.js, so an out-of-date copy there fails the test rather than being silently excused.
 *
 * It creates and always removes one probe round named `__freshness-probe__`. It never touches
 * design-context/, and it restores the dashboard by rebuilding on the way out.
 *
 * Usage: node tools/test-dashboard-freshness.js <workspace>
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail !== undefined ? ` — ${detail}` : ''}`); } };

const WS = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node tools/test-dashboard-freshness.js <workspace>'); process.exit(1); }
const LIB = path.join(WS, 'design-context');
const MAP = path.join(WS, 'tools', 'map.js');
const WF = path.join(WS, 'wireframes');
const PROBE = path.join(WF, '__freshness-probe__');

for (const [p, what] of [[LIB, 'design-context/'], [path.join(LIB, 'dashboard.html'), 'design-context/dashboard.html'], [MAP, 'tools/map.js']]) {
  if (!fs.existsSync(p)) { console.error(`test-dashboard-freshness: ${WS} has no ${what} — point this at a captured kit workspace`); process.exit(1); }
}

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const get = (port, p) => new Promise((res, rej) => {
  const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 60000 }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d }));
  });
  req.on('error', rej);
  req.on('timeout', () => { req.destroy(); rej(new Error('request timed out')); });
});
// The band's data, read the way a browser would get it: out of the served HTML.
const servedCount = async (port) => {
  const { body } = await get(port, '/dashboard.html');
  const line = body.split('\n').find((l) => l.startsWith('const DASH = {'));
  if (!line) throw new Error('served dashboard.html carries no DASH payload');
  const json = JSON.parse(line.slice('const DASH = '.length).replace(/;$/, '').replace(/\\u003c/g, '<'));
  return (json.wireframes || []).length;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = await freePort();
  let out = '';
  const child = spawn(process.execPath, [MAP, '--port', String(port)], { cwd: WS, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const refreshes = () => (out.match(/designs changed since the last build/g) || []).length;

  try {
    for (let i = 0; i < 60; i++) { try { await get(port, '/api/ping'); break; } catch (_) { await sleep(100); } }

    console.log('\ntest-dashboard-freshness — the band tracks the filesystem, in both directions');
    const baseline = await servedCount(port);
    ok(true, `baseline: the served band holds ${baseline} wireframe(s)`);
    const refreshesAtStart = refreshes();

    // ADD — the case the designer hit
    fs.mkdirSync(path.join(PROBE, 'round-1'), { recursive: true });
    fs.writeFileSync(path.join(PROBE, 'round-1', '01-probe.html'), '<html><head><title>probe</title></head><body><div>probe</div></body></html>');
    fs.writeFileSync(path.join(PROBE, 'round-1', 'notes.md'), '# Probe — round 1 · intent: assert a new round reaches the served dashboard\n\n- **01-probe** — a stub written after the last build.\n');
    const afterAdd = await servedCount(port);
    ok(afterAdd === baseline + 1, 'a round written AFTER the last build reaches the served dashboard', `expected ${baseline + 1}, got ${afterAdd}`);
    ok(refreshes() > refreshesAtStart, 'the server said so, rather than refreshing silently');

    // CONVERGE — a stale check that never settles would rebuild on every page load
    const refreshesAfterAdd = refreshes();
    await servedCount(port); await servedCount(port);
    ok(refreshes() === refreshesAfterAdd, 'two further loads rebuild nothing — the check converges');

    // BOUNDED — an asset request must not pay for a tree walk or a rebuild
    await get(port, '/registry.json');
    ok(refreshes() === refreshesAfterAdd, 'a non-dashboard request triggers no rebuild');

    // REMOVE — the direction the first implementation missed entirely
    fs.rmSync(PROBE, { recursive: true, force: true });
    const afterDelete = await servedCount(port);
    ok(afterDelete === baseline, 'a DELETED round leaves the served dashboard too', `expected ${baseline}, got ${afterDelete}`);
  } catch (e) {
    fail++; console.log(`  ✗ threw — ${e.message}`);
  } finally {
    fs.rmSync(PROBE, { recursive: true, force: true });
    try { child.kill('SIGTERM'); } catch (_) {}
    await sleep(300);
    // leave the workspace's dashboard consistent with its tree, however we exited
    try { execFileSync(process.execPath, [path.join(WS, 'tools', 'build-index.js'), LIB], { stdio: 'ignore' }); } catch (_) {}
  }

  console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
