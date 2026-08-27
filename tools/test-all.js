#!/usr/bin/env node
/**
 * test-all.js — run every tools/test-*.js and report THREE outcomes, never two.
 *
 * Why this exists (prds/test-suite-health.md §3). Until now nothing ran the suite: `tools/package.json`
 * had `login` and `capture` and no `test`, so running the tests meant knowing every filename and each
 * one's argument convention. The cost was measurable — test-prompts.js was red for 25 days
 * (2026-08-02 → 2026-08-27) and test-port-select.js had been announcing FAIL while exiting 0 for
 * longer than that. Neither was noticed, because nobody was looking at all ten at once.
 *
 *   PASS     exit 0.
 *   FAIL     non-zero exit. The runner exits non-zero and names the file.
 *   SKIPPED  a stated precondition is absent. Does NOT fail the run, but is printed loudly, named
 *            individually with its reason, and counted in the summary line.
 *
 * A SKIPPED test is never counted as a pass. A runner that prints "all green" while two tests never
 * executed is the same defect as a test that prints FAIL and exits 0 — one level up.
 *
 * Preconditions are DETECTED from each file, not hard-coded as a blocklist, so a test that gains or
 * loses one is classified correctly without editing this runner:
 *
 *   1. Needs `tools/node_modules`. The file's module-scope require graph is walked (relative requires
 *      followed, indented/lazy requires ignored). Any bare, non-builtin package that is not present in
 *      `tools/node_modules/` is a missing precondition — today that is `playwright`, reached through
 *      `capture.js` by test-dismiss-order.js and test-routekey.js. `tools/node_modules/` is gitignored,
 *      so it is absent on a fresh clone until `setup.sh` runs, and absent in every git worktree.
 *      A safety net after the run catches lazily-required packages the static walk skips.
 *   2. Needs positional arguments. The file's own `Usage:` header line is parsed: `<angle>` tokens are
 *      required, `[square]` ones optional. Supply them on the command line and the test runs; supply
 *      nothing and it is skipped with the usage line as the reason — never read as a failure.
 *
 * Usage: node tools/test-all.js [workspaceA] [workspaceB]
 *        npm test                            (from tools/)
 *        npm test -- <workspaceA> [workspaceB]   — also runs test-port-select.js
 *
 * Exit 0 = every test that ran passed. Exit 1 = at least one failed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { builtinModules } = require('module');

const TOOLS = __dirname;
const SELF = path.basename(__filename);
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 300000);

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('usage: node tools/test-all.js [workspaceA] [workspaceB]\n' +
    '  Runs every tools/test-*.js. Positional arguments are forwarded to the tests that declare\n' +
    '  required arguments in their own Usage: line; tests that need arguments you did not supply\n' +
    '  are SKIPPED with the reason stated, not failed and not counted as passing.');
  process.exit(0);
}
const ARGS = argv.filter((a) => !a.startsWith('-'));

// ── precondition 1: the module-scope require graph ────────────────────────────────────────────────
// Only requires at module scope count. `capture.js` requires playwright at column 0 (it cannot load
// without it) but js-beautify inside a function; both are missing together when node_modules is,
// so the distinction costs nothing today and stops a lazily-required optional package from
// wrongly skipping a test that would have passed.
function bareDeps(file, seen = new Set()) {
  const abs = path.resolve(TOOLS, file);
  if (seen.has(abs) || !fs.existsSync(abs)) return new Set();
  seen.add(abs);
  const out = new Set();
  for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
    if (/^\s/.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;      // indented ⇒ lazy; comment ⇒ prose
    for (const m of line.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const dep = path.resolve(path.dirname(abs), spec);
        for (const d of bareDeps(dep, seen)) out.add(d);
      } else if (!BUILTIN.has(spec)) {
        out.add(spec.split('/')[0].replace(/^(@[^/]+)$/, '$1'));
      }
    }
  }
  return out;
}
const installed = (pkg) => fs.existsSync(path.join(TOOLS, 'node_modules', pkg));

// ── precondition 2: the file's own Usage: line ────────────────────────────────────────────────────
function usageArgs(file) {
  const head = fs.readFileSync(path.join(TOOLS, file), 'utf8').split('\n').slice(0, 60);
  const line = head.find((l) => /Usage:\s*node .*\.js/.test(l));
  if (!line) return null;
  const after = line.slice(line.indexOf('.js') + 3);
  const required = [...after.matchAll(/<[^>]+>/g)].map((m) => m[0]);
  const optional = [...after.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]);
  return { line: line.replace(/^[\s*/]*/, '').trim(), required, optional };
}

// ── discover ──────────────────────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(TOOLS).filter((f) => /^test-.+\.js$/.test(f) && f !== SELF).sort();
if (!files.length) { console.error('test-all: no tools/test-*.js files found'); process.exit(1); }

console.log(`\ntest-all — ${files.length} test files in tools/\n`);

const results = [];
for (const file of files) {
  const missing = [...bareDeps(file)].filter((p) => !installed(p));
  if (missing.length) {
    results.push({ file, status: 'SKIPPED', bucket: 'node_modules',
      reason: `needs tools/node_modules — ${missing.map((m) => `'${m}'`).join(', ')} not installed (run tools/setup.sh)` });
    continue;
  }
  const usage = usageArgs(file);
  if (usage && usage.required.length && ARGS.length < usage.required.length) {
    results.push({ file, status: 'SKIPPED', bucket: 'arguments',
      reason: `needs ${usage.required.length} argument(s) this run did not supply — ${usage.line}` });
    continue;
  }
  const pass = usage ? ARGS.slice(0, usage.required.length + usage.optional.length) : [];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(TOOLS, file), ...pass],
    { cwd: TOOLS, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${r.stdout || ''}${r.stderr || ''}`;

  if (r.error && r.error.code === 'ETIMEDOUT') {
    results.push({ file, status: 'FAIL', secs, out, reason: `timed out after ${TIMEOUT_MS / 1000}s` });
  } else if (r.status === 0) {
    results.push({ file, status: 'PASS', secs, out });
  } else {
    // Safety net for a package the static walk did not see (a lazy require that turns out to be
    // load-bearing). Only reclassifies when the package is a declared dependency AND genuinely absent
    // — never when a test simply failed.
    const m = out.match(/Cannot find module '([^'./][^']*)'/);
    const pkg = m && m[1].split('/')[0];
    const declared = (() => {
      try { return Object.keys(JSON.parse(fs.readFileSync(path.join(TOOLS, 'package.json'), 'utf8')).dependencies || {}); }
      catch { return []; }
    })();
    if (pkg && declared.includes(pkg) && !installed(pkg)) {
      results.push({ file, status: 'SKIPPED', bucket: 'node_modules', secs,
        reason: `needs tools/node_modules — '${pkg}' not installed (run tools/setup.sh)` });
    } else {
      results.push({ file, status: 'FAIL', secs, out, reason: `exit ${r.status}` });
    }
  }
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────
const MARK = { PASS: '  ✓ PASS   ', FAIL: '  ✗ FAIL   ', SKIPPED: '  ⃠ SKIP   ' };
for (const r of results) {
  const tail = r.status === 'SKIPPED' ? r.reason : `${r.secs}s${r.reason ? ` — ${r.reason}` : ''}`;
  console.log(`${MARK[r.status]}${r.file.padEnd(26)} ${tail}`);
}

const failed = results.filter((r) => r.status === 'FAIL');
const skipped = results.filter((r) => r.status === 'SKIPPED');
const passed = results.filter((r) => r.status === 'PASS');

for (const r of failed) {
  console.log(`\n──── output of ${r.file} (${r.reason}) ────`);
  console.log((r.out || '(no output)').trimEnd());
}

// Every skip is named again with its reason, so no reader can mistake this run for a full one.
if (skipped.length) {
  console.log(`\n──── SKIPPED (${skipped.length}) — these did NOT run and are NOT passes ────`);
  for (const r of skipped) console.log(`  ${r.file.padEnd(26)} ${r.reason}`);
}

const buckets = [...new Set(skipped.map((r) => r.bucket))].map((b) =>
  b === 'node_modules' ? 'Playwright absent' : 'workspace argument absent');
console.log(`\n${failed.length ? '❌' : '✅'}  ${passed.length} passed · ${failed.length} failed · ` +
  `${skipped.length} skipped${buckets.length ? ` (${buckets.join('; ')})` : ''}`);
if (failed.length) console.log(`   failed: ${failed.map((r) => r.file).join(', ')}`);
console.log('');
process.exit(failed.length ? 1 : 0);
