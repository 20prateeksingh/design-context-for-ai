#!/usr/bin/env node
/**
 * map.js — the local server behind the dashboard, and the dashboard's onboarding brain.
 *
 * Serves <workspace>/design-context/ on localhost (dashboard.html as the home page — or the
 * onboarding wizard, served from the template, when the library is still empty) and exposes the
 * actions the static page can't do on its own.
 *
 * Static + legacy map actions:
 *   GET  /api/ping                        → liveness
 *   POST /api/capture {urls:[…]}          → runs capture.js --urls (selective frontier pull)
 *   POST /api/state {slug,name,url}       → records the state in annotations.json + captures it
 *
 * Dashboard-first onboarding (dashboard-first-onboarding PRD):
 *   GET  /api/status                      → {firstRun, product, capture:{running,mode,done}, login}
 *   POST /api/onboard {url,loggedIn,productType}
 *                                         → writes design-context/product.json (url+presets+…)
 *   POST /api/login/start {url}           → spawns login.js --url (headed window; tracks the child)
 *   GET  /api/login/status                → {running, done, started}
 *   POST /api/capture/start {mode}        → spawns capture.js detached; streams via a ring buffer
 *                                           mode:"login-page" = ephemeral signed-out capture (PRD 4a)
 *                                           mode:"full"       = the main crawl (reads product.json)
 *   GET  /api/capture/events              → SSE: one "line" event per capture stdout line + "done"
 *   GET  /api/capture/log?since=n         → polling fallback for /api/capture/events
 *
 * Guided capture (guided-capture-integration PRD, F5):
 *   POST /api/guided/start {startUrl?}    → spawns capture.js --guided --url (headed, human drives);
 *                                           409 if a capture/guided/login already holds the profile
 *   POST /api/guided/stop                 → ends a running guided session (SIGTERM → graceful close)
 *   GET  /api/guided/status               → {running, startedAt, captures:N, lastCapture, capturing}
 *                                           (also folded into /api/status as `guided`)
 *   (SSE) reuses /api/capture/events with namespaced "guided" / "guided-done" events
 *
 * Copy for Figma (figma-exit-copy-paste PRD, F3):
 *   POST /api/figma-copy {slug, state?}   → records the exit in figma-copies.json (additive) +
 *                                           rebuilds so the "Sent ‹page› to Figma" ledger event shows.
 *                                           The copy itself is 100% client-side; this only logs it.
 *
 * Capture is spawned so it OUTLIVES any one HTTP request (kill-resilience: closing the browser
 * tab must not kill the capture). Job state (line ring buffer, running/exit) lives in this process;
 * the dashboard streams from here and can re-attach after a reload. One capture job at a time.
 *
 * No dependencies (bare node:http). Local only (127.0.0.1). Usage: node map.js [--port 4173]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { normalizeWizardUrl } = require('./wizard-url.js'); // F5: same bare-domain acceptance as the client wizard

const args = process.argv.slice(2);
const PORT = parseInt((args[args.indexOf('--port') + 1] || ''), 10) || 4173;
const KIT = path.join(__dirname, '..');
const LIB = path.join(KIT, 'design-context');
const TEMPLATE = path.join(__dirname, 'dashboard-template.html');

const MIME = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

// Product-type → capture presets + login default (PRD §4).
const PRESETS = {
  saas:      { depth: 1, cap: 25, loginSuggested: true },
  ecommerce: { depth: 2, cap: 25, loginSuggested: false },
  content:   { depth: 2, cap: 25, loginSuggested: false },
  docs:      { depth: 2, cap: 20, loginSuggested: false },
  marketing: { depth: 2, cap: 25, loginSuggested: false },
  notsure:   { depth: 2, cap: 25, loginSuggested: false },
};

let busy = false;              // one capture job at a time (shared by streaming + legacy + guided runs)
let capJob = null;             // { lines:[], _partial, running, code, mode, startedAt }
let loginJob = null;           // { running, code, startedAt }
let guidedJob = null;          // { running, code, startedAt, startUrl, captures:[], lastCapture, _partial }
const sseClients = new Set();  // open SSE responses for /api/capture/events

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => { let d = null; try { d = body ? JSON.parse(body) : {}; } catch { return cb(new Error('bad JSON')); } cb(null, d); });
}

function isFirstRun() {
  const p = path.join(LIB, 'pages');
  try { return !fs.existsSync(p) || fs.readdirSync(p).filter(f => !f.startsWith('.')).length === 0; }
  catch { return true; }
}
function readProduct() {
  try { return JSON.parse(fs.readFileSync(path.join(LIB, 'product.json'), 'utf8')); } catch { return null; }
}

// ── SSE fan-out ────────────────────────────────────────────────────────────────
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of sseClients) { try { res.write(frame); } catch (_) {} }
}
function pushCaptureOutput(text) {
  if (!capJob) return;
  capJob._partial += String(text).replace(/\r/g, '');
  const parts = capJob._partial.split('\n');
  capJob._partial = parts.pop();
  for (const ln of parts) { capJob.lines.push(ln); if (capJob.lines.length > 5000) capJob.lines.shift(); broadcast('line', ln); }
}

// ── Streaming capture (detached from the request lifetime) ──────────────────────
function startCapture(mode, res) {
  if (busy) return json(res, 409, { ok: false, error: 'a capture is already running — wait for it to finish' });
  if (loginJob && loginJob.running) return json(res, 409, { ok: false, error: 'finish logging in first (close the login window)' });
  const cfgPath = path.join(LIB, 'product.json');
  if (!fs.existsSync(cfgPath)) return json(res, 400, { ok: false, error: 'no product.json — answer onboarding first' });
  const cliArgs = mode === 'login-page' ? ['--login-page', '--config', cfgPath] : ['--config', cfgPath];
  busy = true;
  capJob = { lines: [], _partial: '', running: true, code: null, mode, startedAt: new Date().toISOString() };
  console.log(`▶ capture (${mode}) ${cliArgs.join(' ')}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'capture.js'), ...cliArgs], { cwd: __dirname });
  child.stdout.on('data', pushCaptureOutput);
  child.stderr.on('data', pushCaptureOutput);
  child.on('error', (e) => { pushCaptureOutput(`\n✗ ${e.message}\n`); });
  child.on('exit', (code) => {
    if (capJob && capJob._partial) { capJob.lines.push(capJob._partial); broadcast('line', capJob._partial); capJob._partial = ''; }
    busy = false;
    if (capJob) { capJob.running = false; capJob.code = code; }
    console.log(`■ capture (${mode}) exited ${code}`);
    broadcast('done', JSON.stringify({ code, mode }));
  });
  json(res, 200, { ok: true, mode });
}

// ── Guided capture (F5) — headed, human-driven; spawned detached, streamed like a capture ─────────
// Symmetric with startCapture: holds the same `busy` lock (guided uses the persistent profile, so it
// conflicts with capture AND login — the shared lock is what makes all three mutually exclusive).
function guidedStatePayload() {
  return {
    running: !!(guidedJob && guidedJob.running),
    startedAt: guidedJob ? guidedJob.startedAt : null,
    startUrl: guidedJob ? guidedJob.startUrl : null,
    captures: guidedJob ? guidedJob.captures.length : 0,
    lastCapture: guidedJob ? guidedJob.lastCapture : null,
    capturing: !!(guidedJob && guidedJob.capturing),   // a page snapshot is in flight right now
    code: guidedJob ? guidedJob.code : null,
  };
}
// Parse capture.js's stdout for the stable `GUIDED_JSON:` line → live status + SSE. Two shapes:
// {phase:'capturing',url} (a snapshot started) and {slug,state,url,at,...} (one finished).
function pushGuidedOutput(text) {
  if (!guidedJob) return;
  guidedJob._partial += String(text).replace(/\r/g, '');
  const parts = guidedJob._partial.split('\n');
  guidedJob._partial = parts.pop();
  for (const ln of parts) {
    if (ln.indexOf('GUIDED_JSON:') === 0) {
      try { const c = JSON.parse(ln.slice('GUIDED_JSON:'.length));
        if (c.phase === 'capturing') { guidedJob.capturing = true; }
        else { guidedJob.captures.push(c); guidedJob.lastCapture = c; guidedJob.capturing = false; }
        broadcast('guided', JSON.stringify(guidedStatePayload()));
      } catch (_) {}
    } else {
      // keep a short tail of plain output so a fast failure (e.g. profile locked) can be surfaced
      const t = ln.trim();
      if (t) { guidedJob.errTail.push(t); if (guidedJob.errTail.length > 12) guidedJob.errTail.shift(); }
    }
  }
}
function startGuided(startUrl, res) {
  // 409 covers ALL profile users: capture (busy), another guided (busy while running), and login.
  if (busy || (guidedJob && guidedJob.running)) return json(res, 409, { ok: false, error: 'Another capture is running — finish or stop it first.' });
  if (loginJob && loginJob.running) return json(res, 409, { ok: false, error: 'finish logging in first (close the login window)' });
  const product = readProduct();
  const s = (startUrl || '').trim();
  const url = /^https?:\/\//.test(s) ? s : (product && product.url) || null;
  if (!url) return json(res, 400, { ok: false, error: 'no start URL and no product.json — answer onboarding first' });
  busy = true;
  const startedAt = new Date().toISOString();
  guidedJob = { running: true, code: null, startedAt, startUrl: url, captures: [], lastCapture: null, capturing: false, child: null, errTail: [], _partial: '' };
  console.log(`▶ guided ${url}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'capture.js'), '--guided', '--url', url], { cwd: __dirname });
  guidedJob.child = child;   // held so /api/guided/stop (and server shutdown) can end the session cleanly
  child.stdout.on('data', pushGuidedOutput);
  child.stderr.on('data', pushGuidedOutput);
  child.on('error', (e) => { console.log(`✗ guided ${e.message}`); if (guidedJob) guidedJob.errTail.push(e.message); });
  child.on('exit', (code) => {
    const captured = guidedJob ? guidedJob.captures.length : 0;
    const fast = (Date.now() - Date.parse(startedAt)) < 8000;   // errored almost immediately
    // Fast, non-zero exit with nothing captured = launch never really started — almost always the
    // profile is locked by another capture/login window. Surface WHY instead of a silent reload.
    let error = null;
    if (code && code !== 0 && captured === 0 && fast) {
      const tail = (guidedJob ? guidedJob.errTail : []).filter(l => /profile|another window|locked|in use|login|❌/i.test(l));
      error = (tail[tail.length - 1] || 'Guided capture couldn’t start — the browser profile may be open in another window. Close any capture/login window and try again.').replace(/^❌\s*/, '');
    }
    busy = false;
    if (guidedJob) { guidedJob.running = false; guidedJob.code = code; }
    // capture.js --guided already rebuilds at its own exit; rebuild here too so the dashboard's reload
    // sees the fresh registry/dashboard.html even if the child's own build-index was interrupted.
    try { require('./build-index.js').buildIndex(LIB); } catch (e) { console.log(`⚠ guided post-build: ${e.message.split('\n')[0]}`); }
    console.log(`■ guided exited ${code} (${captured} captured)${error ? ' — ' + error : ''}`);
    broadcast('guided-done', JSON.stringify({ code, captures: captured, error }));
  });
  json(res, 200, { ok: true, startUrl: url });
}

// ── Legacy blocking capture (map frontier unlock + state add) ───────────────────
function runCapture(cliArgs, res) {
  if (busy) return json(res, 409, { ok: false, error: 'a capture is already running — wait for it to finish' });
  busy = true;
  console.log(`▶ capture ${cliArgs.join(' ')}`);
  execFile(process.execPath, [path.join(__dirname, 'capture.js'), ...cliArgs], { cwd: __dirname, timeout: 15 * 60 * 1000 },
    (err, stdout, stderr) => {
      busy = false;
      const tail = (stdout || '').split('\n').filter(Boolean).slice(-8).join('\n');
      console.log(tail || stderr);
      if (err) return json(res, 500, { ok: false, error: (stderr || err.message).split('\n')[0], output: tail });
      json(res, 200, { ok: true, output: tail });
    });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));

  // ── GET api ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (url === '/api/ping') return json(res, 200, { ok: true });
    if (url === '/api/status') return json(res, 200, {
      ok: true, firstRun: isFirstRun(), product: readProduct(),
      workspacePath: KIT,  // absolute path of THIS workspace root — served live only, never baked into dashboard.html
      capture: { running: !!(capJob && capJob.running), mode: capJob ? capJob.mode : null, done: !!(capJob && !capJob.running) },
      login: { running: !!(loginJob && loginJob.running), done: !!(loginJob && !loginJob.running), started: !!loginJob },
      guided: guidedStatePayload(),
    });
    if (url === '/api/guided/status') return json(res, 200, { ok: true, ...guidedStatePayload() });
    if (url === '/api/login/status') return json(res, 200, {
      ok: true, running: !!(loginJob && loginJob.running), done: !!(loginJob && !loginJob.running), started: !!loginJob, code: loginJob ? loginJob.code : null,
    });
    if (url === '/api/capture/log') {
      const since = parseInt(query.since || '0', 10) || 0;
      const lines = capJob ? capJob.lines.slice(since) : [];
      return json(res, 200, { ok: true, lines, next: capJob ? capJob.lines.length : 0, running: !!(capJob && capJob.running), code: capJob ? capJob.code : null, mode: capJob ? capJob.mode : null });
    }
    if (url === '/api/capture/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': connected\n\n');
      if (capJob) {
        for (const ln of capJob.lines) res.write(`event: line\ndata: ${ln}\n\n`);
        if (!capJob.running) res.write(`event: done\ndata: ${JSON.stringify({ code: capJob.code, mode: capJob.mode })}\n\n`);
      }
      // Guided events are namespaced ("guided"/"guided-done") so the onboarding client (line/done only)
      // never receives them. Replay current guided state so a reconnecting dashboard catches up.
      if (guidedJob) {
        res.write(`event: guided\ndata: ${JSON.stringify(guidedStatePayload())}\n\n`);
        if (!guidedJob.running) res.write(`event: guided-done\ndata: ${JSON.stringify({ code: guidedJob.code, captures: guidedJob.captures.length })}\n\n`);
      }
      sseClients.add(res);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 15000);
      req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }
  }

  // ── POST api ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.startsWith('/api/')) {
    return readBody(req, (err, data) => {
      if (err) return json(res, 400, { ok: false, error: 'bad JSON' });

      if (url === '/api/onboard') {
        const u = normalizeWizardUrl(data.url);
        if (!u) return json(res, 400, { ok: false, error: 'need a URL starting with http:// or https://' });
        const type = PRESETS[data.productType] ? data.productType : 'notsure';
        const p = PRESETS[type];
        const product = {
          url: u, loggedIn: !!data.loggedIn, productType: type,
          presets: { depth: p.depth, cap: p.cap }, answeredAt: new Date().toISOString(),
        };
        try { fs.mkdirSync(LIB, { recursive: true }); fs.writeFileSync(path.join(LIB, 'product.json'), JSON.stringify(product, null, 2), 'utf8'); }
        catch (e) { return json(res, 500, { ok: false, error: e.message.split('\n')[0] }); }
        return json(res, 200, { ok: true, product });
      }

      if (url === '/api/login/start') {
        const u = normalizeWizardUrl(data.url);
        if (!u) return json(res, 400, { ok: false, error: 'need a valid URL' });
        if (busy) return json(res, 409, { ok: false, error: 'a capture is running — wait for it to finish' });
        if (loginJob && loginJob.running) return json(res, 200, { ok: true, already: true });
        loginJob = { running: true, code: null, startedAt: new Date().toISOString() };
        console.log(`▶ login window ${u}`);
        const child = spawn(process.execPath, [path.join(__dirname, 'login.js'), '--url', u], { cwd: __dirname });
        child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
        child.on('error', () => { if (loginJob) { loginJob.running = false; loginJob.code = -1; } });
        child.on('exit', (code) => { if (loginJob) { loginJob.running = false; loginJob.code = code; } console.log(`■ login window closed (${code})`); });
        return json(res, 200, { ok: true });
      }

      if (url === '/api/capture/start') {
        const mode = data.mode === 'login-page' ? 'login-page' : 'full';
        return startCapture(mode, res);
      }

      if (url === '/api/guided/start') return startGuided(data.startUrl, res);

      if (url === '/api/guided/stop') {
        if (!(guidedJob && guidedJob.running)) return json(res, 200, { ok: true, alreadyStopped: true });
        // SIGTERM → capture.js closes its browser context → 'close' fires → it writes the session +
        // hygiene artifacts and rebuilds, then exits (the same clean path as quitting the window).
        try { if (guidedJob.child) guidedJob.child.kill('SIGTERM'); } catch (_) {}
        console.log('▶ guided stop requested');
        return json(res, 200, { ok: true, stopping: true });
      }

      if (url === '/api/figma-copy') {
        // The Copy-for-Figma exit already ran client-side (the DOM→Figma conversion + clipboard write
        // happen entirely in the dashboard). This only RECORDS the exit in the ledger — append to the
        // additive figma-copies.json, then rebuild so the event renders. file:// mode never reaches
        // here (no server); the copy still works there, the event is just skipped — no error.
        const slug = String(data.slug || '').trim();
        const state = data.state == null ? null : String(data.state).trim().slice(0, 80) || null;
        if (!/^[A-Za-z0-9._-]+$/.test(slug)) return json(res, 400, { ok: false, error: 'need a valid slug' });
        if (!fs.existsSync(path.join(LIB, 'pages', slug))) return json(res, 404, { ok: false, error: 'unknown page slug' });
        const fcPath = path.join(LIB, 'figma-copies.json');
        let fc = { copies: [] };
        try { const parsed = JSON.parse(fs.readFileSync(fcPath, 'utf8')); if (parsed && Array.isArray(parsed.copies)) fc = parsed; } catch (_) {}
        fc.copies.push({ slug, state, at: new Date().toISOString() });
        try { fs.writeFileSync(fcPath, JSON.stringify(fc, null, 2), 'utf8'); }
        catch (e) { return json(res, 500, { ok: false, error: e.message.split('\n')[0] }); }
        // Rebuild so the ledger updates — but not while a capture holds the build (its own exit rebuilds
        // and would race). If busy, the record is safely on disk; the next build derives the event.
        if (!busy) { try { require('./build-index.js').buildIndex(LIB); } catch (e) { console.log(`⚠ figma-copy post-build: ${e.message.split('\n')[0]}`); } }
        console.log(`⧉ figma-copy ${slug}${state ? ' › ' + state : ''}`);
        return json(res, 200, { ok: true });
      }

      if (url === '/api/capture' || url === '/api/state') {
        if (url === '/api/capture') {
          const urls = (data.urls || []).filter(u => /^https?:\/\//.test(u)).slice(0, 15);
          if (!urls.length) return json(res, 400, { ok: false, error: 'no valid URLs' });
          return runCapture(['--urls', urls.join(',')], res);
        }
        const { slug, name, url: stateUrl } = data;
        if (!slug || !name || !/^https?:\/\//.test(stateUrl || '')) return json(res, 400, { ok: false, error: 'need slug, name, url' });
        if (!fs.existsSync(path.join(LIB, 'pages', slug))) return json(res, 404, { ok: false, error: 'unknown page slug' });
        const annPath = path.join(LIB, 'annotations.json');
        const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
        ann.pages = ann.pages || {}; ann.pages[slug] = ann.pages[slug] || {};
        const states = ann.pages[slug].states = ann.pages[slug].states || [];
        if (!states.some(s => s.name === name)) states.push({ name, url: stateUrl, addedAt: new Date().toISOString() });
        fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), 'utf8');
        return runCapture(['--state', `${slug}:${name}`, '--url', stateUrl], res);
      }

      return json(res, 404, { ok: false, error: 'unknown endpoint' });
    });
  }

  // ── static: serve design-context/, dashboard.html as home — no path traversal ──
  const rel = decodeURIComponent(url === '/' ? '/dashboard.html' : url);
  const file = path.normalize(path.join(LIB, rel));
  if (!file.startsWith(LIB)) return json(res, 403, { ok: false });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // First run (or pre-build): the library has no dashboard.html yet — serve the raw template
      // so the onboarding wizard can render. The template's DASHDATA stays null; the script boots
      // via /api/status and shows the wizard.
      if (path.basename(file) === 'dashboard.html' && fs.existsSync(TEMPLATE)) {
        return fs.readFile(TEMPLATE, (e2, tpl) => {
          if (e2) return json(res, 404, { ok: false, error: 'not found' });
          res.writeHead(200, { 'content-type': 'text/html' }); res.end(tpl);
        });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🗺  Design context: http://localhost:${PORT}`);
  console.log(`   Empty library → the dashboard runs onboarding (URL, sign-in, capture — no terminal).`);
  console.log(`   (Local only — nothing is exposed beyond this machine. Ctrl+C to stop.)\n`);
});

// On shutdown (Ctrl+C / restart), take a running guided session down WITH us — otherwise its headed
// Chrome outlives the server, keeps the profile lock, and every future launch fails on the lock
// (the "opens about:blank" symptom). SIGTERM lets capture.js close the browser + write its artifacts.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  try { if (guidedJob && guidedJob.running && guidedJob.child) { console.log('■ shutting down — ending guided session'); guidedJob.child.kill('SIGTERM'); } } catch (_) {}
  setTimeout(() => process.exit(0), 600);   // give capture.js a moment to close Chrome, then exit
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
