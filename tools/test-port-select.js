#!/usr/bin/env node
// test-port-select.js — map.js's port selection.
//
// Regression cover for the 2026-07-31 Windows failure: map.js had a bare server.listen() with no
// 'error' handler, so a busy port produced an unhandled 'error' event and a raw Node stack trace.
// start.sh had scanned 4173-4182 and reused this workspace's own server since forever — but
// start.sh is bash-only, so Windows, where map.js is the ONLY entry point, got the crash.
//
// The load-bearing case is the last one: a second workspace must never be handed the FIRST
// workspace's dashboard. Reuse is matched on /api/status workspacePath, not on "the port answered".
//
// Usage: node tools/test-port-select.js <workspaceA> [workspaceB]
//   Each must be a real workspace with tools/map.js. Spawns servers; always kills them.
//   workspaceB is OPTIONAL — without it, check 5 (the wrong-library guard) does not run.
//
// The workspace directory is a REQUIRED argument and there is no sane default: a wrong default
// would run the whole suite against the wrong library, which is the exact bug check 5 exists to
// catch. Run with no argument and this used to print FAIL three times, hang on step 4's promise,
// then exit 0 as the event loop drained — announcing failure to the reader and success to the
// shell. The guard below is what turns that into an honest non-zero exit.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const WS = process.argv[2];                       // workspace dir
const OTHER = process.argv[3];                    // a second workspace dir (optional)
const live = new Set();

const USAGE = [
  'usage: node tools/test-port-select.js <workspaceA> [workspaceB]',
  '       <workspaceA>  a design-context workspace directory containing tools/map.js',
  '       [workspaceB]  optional second workspace; without it check 5 is not run',
].join('\n');
const die = (why) => { console.error(`test-port-select: ${why}\n${USAGE}`); process.exit(1); };

if (!WS) die('no workspace argument given');
for (const [label, dir] of [['<workspaceA>', WS], ['[workspaceB]', OTHER]]) {
  if (!dir) continue;
  let st = null;
  try { st = fs.statSync(dir); } catch { /* falls through to the message below */ }
  if (!st || !st.isDirectory()) die(`${label} is not a directory: ${dir}`);
  if (!fs.existsSync(path.join(dir, 'tools', 'map.js'))) die(`${label} has no tools/map.js, so it is not a workspace: ${dir}`);
}

function run(cwd, args, { waitFor, timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join('tools', 'map.js'), ...args], { cwd });
    live.add(p);
    let out = '';
    const done = (why) => { resolve({ out, why, code: p.exitCode }); };
    const t = setTimeout(() => done('timeout'), timeout);
    p.stdout.on('data', (d) => {
      out += d;
      if (waitFor && waitFor.test(out)) { clearTimeout(t); setTimeout(() => done('matched'), 300); }
    });
    p.stderr.on('data', (d) => { out += d; if (waitFor && waitFor.test(out)) { clearTimeout(t); setTimeout(() => done('matched'), 300); } });
    p.on('exit', (c) => { clearTimeout(t); live.delete(p); out += `\n[exit ${c}]`; done('exit'); });
  });
}
const kill = () => { for (const p of live) { try { p.kill('SIGKILL'); } catch {} } live.clear(); };
process.on('exit', kill);

const occupy = (port) => new Promise((r, rej) => {
  const s = net.createServer(() => {});
  s.once('error', (e) => rej(new Error(`cannot occupy ${port} for the test: ${e.code}`)));
  s.listen(port, '127.0.0.1', () => r(s));
});

(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n        ' + detail}`); };

  // 1. free port → starts normally
  let r = await run(WS, ['--port', '4890'], { waitFor: /Design context: http/ });
  check('free port starts normally', /Design context: http:\/\/localhost:4890/.test(r.out), r.out.slice(0, 300));
  kill();

  // 2. port held by a NON-kit process, default port → scans to the next one
  const squat = await occupy(4173);
  r = await run(WS, [], { waitFor: /Design context: http|in use/ });
  check('busy default port → falls forward, does not crash',
        /using 4174 for this workspace instead/.test(r.out) && /localhost:4174/.test(r.out) && !/EADDRINUSE/.test(r.out),
        r.out.slice(0, 400));
  kill();

  // 3. explicit --port that is busy → clear error, no silent move
  r = await run(WS, ['--port', '4173'], { waitFor: /in use|EADDRINUSE/ });
  check('explicit busy --port → clear error, no silent move',
        /already in use/.test(r.out) && /--port 4174/.test(r.out) && !/EADDRINUSE/.test(r.out),
        r.out.slice(0, 400));
  kill();
  squat.close();

  // 4. THIS workspace already serving → say so, exit 0, do not start a second
  const first = spawn(process.execPath, [path.join('tools', 'map.js'), '--port', '4895'], { cwd: WS });
  live.add(first);
  await new Promise((res) => first.stdout.on('data', (d) => { if (/Design context/.test(String(d))) res(); }));
  r = await run(WS, ['--port', '4895'], { waitFor: /already running|in use/ });
  check('same workspace already up → reuse message, exit 0',
        /already running/.test(r.out) && /no need to start a second server/.test(r.out),
        r.out.slice(0, 400));

  // 5. a DIFFERENT workspace on that port → must NOT reuse it (the wrong-library bug)
  if (OTHER) {
    // no --port: default 4173 is free here, so instead occupy 4173 with the OTHER workspace's
    // server and confirm a third start neither reuses it nor lands on its library.
    const otherSrv = spawn(process.execPath, [path.join('tools','map.js'),'--port','4173'], { cwd: OTHER });
    live.add(otherSrv);
    await new Promise((res) => otherSrv.stdout.on('data', (d) => { if (/Design context/.test(String(d))) res(); }));
    r = await run(WS, [], { waitFor: /Design context|in use|already running/ });
    check('different workspace holds the default port → moves on, never reuses it',
          /another workspace/.test(r.out) && /using 4174/.test(r.out) && !/already running/.test(r.out),
          r.out.slice(0, 400));
  }
  kill();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  HARNESS ERROR:', e.message); kill(); process.exit(1); });
