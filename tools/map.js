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
// (ux-busy-states F1) the guided end sequence — SIGTERM through the post-session hygiene check — reports
// itself as a run of these phases, oldest-named-thing-first. Kept here (not just in the dashboard) so the
// mid-end-kill error message below can name the stage a killed child was actually in.
const END_PHASES = ['ending', 'browser-closed', 'session-saved', 'indexing', 'hygiene', 'ended'];
const END_STAGE_LABEL = { ending: 'closing the browser', 'browser-closed': 'closing the browser',
  'session-saved': 'saving the session', indexing: 'rebuilding the index', hygiene: 'running the library check' };
function guidedStatePayload() {
  return {
    running: !!(guidedJob && guidedJob.running),
    startedAt: guidedJob ? guidedJob.startedAt : null,
    startUrl: guidedJob ? guidedJob.startUrl : null,
    captures: guidedJob ? guidedJob.captures.length : 0,
    lastCapture: guidedJob ? guidedJob.lastCapture : null,
    capturing: !!(guidedJob && guidedJob.capturing),   // a page snapshot is in flight right now
    code: guidedJob ? guidedJob.code : null,
    // (F1) the end sequence's own live stage — null until SIGTERM/window-close starts it.
    endPhase: guidedJob ? (guidedJob.endPhase || null) : null,
    endCaptures: guidedJob ? (guidedJob.endCaptures == null ? null : guidedJob.endCaptures) : null,
    endMs: guidedJob ? (guidedJob.endMs || null) : null,
  };
}
// Parse capture.js's stdout for the stable `GUIDED_JSON:` line → live status + SSE. Three shapes:
// {phase:'capturing',url} (a snapshot started), {slug,state,url,at,...} (one finished), and the F1 end
// sequence ({phase:'ending'|'browser-closed'|'session-saved'|'indexing'|'hygiene'|'ended', ...}).
function pushGuidedOutput(text) {
  if (!guidedJob) return;
  guidedJob._partial += String(text).replace(/\r/g, '');
  const parts = guidedJob._partial.split('\n');
  guidedJob._partial = parts.pop();
  for (const ln of parts) {
    if (ln.indexOf('GUIDED_JSON:') === 0) {
      try { const c = JSON.parse(ln.slice('GUIDED_JSON:'.length));
        if (c.phase === 'capturing') { guidedJob.capturing = true; }
        else if (c.phase && END_PHASES.includes(c.phase)) {
          guidedJob.endPhase = c.phase;
          if (c.phase === 'session-saved') guidedJob.endCaptures = c.captures;
          if (c.phase === 'ended') guidedJob.endMs = c.ms;
        }
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
  guidedJob = { running: true, code: null, error: null, startedAt, startUrl: url, captures: [], lastCapture: null, capturing: false, child: null, errTail: [], _partial: '', endPhase: null, endCaptures: null, endMs: null };
  // F3: pass the product's logged-in signal through via --config — the same product.json path
  // startCapture already reads. Without it, the guided child's CFG.loggedIn is always unset, so it can
  // neither take the ephemeral public-fallback path (F3, capture.js) nor correctly surface "this product
  // is marked as logged-in" when a profile really is required — it only ever saw the old hard "you need
  // to log in" exit, regardless of what the designer answered in onboarding.
  const cfgPath = path.join(LIB, 'product.json');
  const cliArgs = ['--guided', '--url', url, ...(fs.existsSync(cfgPath) ? ['--config', cfgPath] : [])];
  console.log(`▶ guided ${url}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'capture.js'), ...cliArgs], { cwd: __dirname });
  guidedJob.child = child;   // held so /api/guided/stop (and server shutdown) can end the session cleanly
  child.stdout.on('data', pushGuidedOutput);
  child.stderr.on('data', pushGuidedOutput);
  child.on('error', (e) => { console.log(`✗ guided ${e.message}`); if (guidedJob) guidedJob.errTail.push(e.message); });
  child.on('exit', (code, signal) => {
    const captured = guidedJob ? guidedJob.captures.length : 0;
    const fast = (Date.now() - Date.parse(startedAt)) < 8000;   // errored almost immediately
    // Fast, non-zero exit with nothing captured = launch never really started — almost always the
    // profile is locked by another capture/login window. Surface WHY instead of a silent reload.
    let error = null;
    if (code && code !== 0 && captured === 0 && fast) {
      // F3: profile-ABSENT (product marked logged-in, no profile — capture.js's own message names the
      // exact fix) is a different failure than profile-LOCKED (another window holds it — needs ⌘Q, not
      // ⌘W). Matching each shape explicitly means a lock-flavoured fallback can never misdirect an
      // absent-profile failure again — that misdirection is the bug this whole fix train started from.
      const tail = guidedJob ? guidedJob.errTail : [];
      const absentLine = tail.find(l => /marked as logged-in/i.test(l));
      const lockedLine = tail.find(l => /another window|locked|in use/i.test(l));
      const line = absentLine || lockedLine || tail[tail.length - 1];
      error = (line || 'Guided capture couldn’t start — the browser profile may be open in another window. Close any capture/login window and try again.').replace(/^❌\s*/, '');
    } else if (guidedJob && guidedJob.endPhase && guidedJob.endPhase !== 'ended' && (code || signal)) {
      // (ux-busy-states F1, design contract #3) the end sequence started (SIGTERM sent, or the window was
      // closed by hand) but the child died before reaching 'ended' — a genuinely abnormal exit, not the
      // clean shutdown the SIGTERM path always produces on success. Name the stage it died in; captures
      // already on disk are unaffected (writeSnapshot commits per-page, not at session end).
      const stage = END_STAGE_LABEL[guidedJob.endPhase] || guidedJob.endPhase;
      error = `The session ended abnormally while ${stage} (${signal || `exit ${code}`}). Pages already captured are safely on disk — check the terminal for details.`;
    }
    busy = false;
    // (design contract #3) persisted onto the job, not just this closure's broadcast — a client that
    // reconnects after the live 'guided-done' already went out (dropped SSE, or the dashboard opened
    // fresh right after the crash) still gets the real error from the /api/capture/events replay below,
    // instead of silently falling into the success/reload path.
    if (guidedJob) { guidedJob.running = false; guidedJob.code = code; guidedJob.error = error; }
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
        if (!guidedJob.running) res.write(`event: guided-done\ndata: ${JSON.stringify({ code: guidedJob.code, captures: guidedJob.captures.length, error: guidedJob.error || null })}\n\n`);
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

      // F1 (hygiene-speaks-designer brief): acknowledge a hygiene finding — "kept on purpose". Additive
      // to annotations.json under hygiene.acks, keyed by the finding's stable key (F1). Never deletes a
      // finding; hygiene still finds it next run, just marked acknowledged. No un-ack endpoint — that's
      // an edit to annotations.json, a designer/AI act. Pattern: the existing /api/state handler above.
      if (url === '/api/hygiene/ack') {
        const key = String(data.key || '').trim();
        if (!key) return json(res, 400, { ok: false, error: 'need a finding key' });
        const note = (data.note == null || String(data.note).trim() === '') ? null : String(data.note).trim().slice(0, 500);
        const annPath = path.join(LIB, 'annotations.json');
        const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
        ann.hygiene = ann.hygiene || {};
        ann.hygiene.acks = ann.hygiene.acks || {};
        ann.hygiene.acks[key] = { note, at: new Date().toISOString() };
        // F2: same self-heal as the fold endpoint — any hygiene-block write is a chance to drop a stale
        // pre-fix ack (see pruneStaleAcks in hygiene.js) rather than leaving it as inert cruft.
        let repaired = [];
        try { repaired = require('./hygiene.js').pruneStaleAcks(ann); } catch (_) {}
        try { fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), 'utf8'); }
        catch (e) { return json(res, 500, { ok: false, error: e.message.split('\n')[0] }); }
        if (!busy) { try { require('./build-index.js').buildIndex(LIB); } catch (e) { console.log(`⚠ hygiene-ack post-build: ${e.message.split('\n')[0]}`); } }
        console.log(`✓ hygiene ack ${key}${note ? ' — ' + note : ''}${repaired.length ? ` (repaired ${repaired.length} stale ack${repaired.length > 1 ? 's' : ''})` : ''}`);
        return json(res, 200, { ok: true });
      }

      // F3: fold — a derived-view decision recorded in annotations.json (hygiene.folds), never touching
      // pages/ on disk. Validates both slugs exist, records the fold, acks the originating finding key
      // (if given) so the ledger card excludes it going forward, and rebuilds so build-index.js's fold
      // derivation (member → foldedInto, rep's template/standsFor extended) takes effect immediately.
      if (url === '/api/hygiene/fold') {
        const rep = String(data.rep || '').trim();
        const members = Array.isArray(data.members) ? [...new Set(data.members.map(m => String(m || '').trim()).filter(Boolean))] : [];
        if (!rep || !members.length) return json(res, 400, { ok: false, error: 'need rep and members' });
        if (!fs.existsSync(path.join(LIB, 'pages', rep))) return json(res, 404, { ok: false, error: 'unknown rep slug' });
        for (const m of members) {
          if (m === rep) return json(res, 400, { ok: false, error: 'a page cannot fold into itself' });
          if (!fs.existsSync(path.join(LIB, 'pages', m))) return json(res, 404, { ok: false, error: `unknown member slug: ${m}` });
        }
        const pattern = data.pattern == null ? null : String(data.pattern).trim().slice(0, 300) || null;
        // F2: the ack key is a contract, not a guess — recompute it server-side from the LIVE finding
        // this fold answers (hygiene.js's own key builder), never from whatever key the browser sends.
        // A browser-held key can be correct the instant it's read and wrong the instant this very fold
        // is applied (matchesRep flips false→true, which changes the key's shape) — hygiene.js, asked
        // right now, is the only source of truth.
        let key = null;
        try {
          const { runHygiene } = require('./hygiene.js');
          const live = runHygiene(LIB);
          const memberSet = new Set(members);
          const match = live.duplicates.find(f => f.repSlug === rep && f.members.length === memberSet.size && f.members.every(m => memberSet.has(m)));
          if (match) key = match.key;
        } catch (_) {}
        const annPath = path.join(LIB, 'annotations.json');
        const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
        ann.hygiene = ann.hygiene || {};
        ann.hygiene.folds = ann.hygiene.folds || [];
        ann.hygiene.folds.push({ rep, members, pattern, at: new Date().toISOString() });
        if (key) { ann.hygiene.acks = ann.hygiene.acks || {}; ann.hygiene.acks[key] = { note: null, at: new Date().toISOString() }; }
        // F2: repair — any pre-existing ack stuck under the old "rep included in the key" shape (this
        // exact fold's own signature) is stale as of this write; drop it so it doesn't sit as cruft.
        let repaired = [];
        try { repaired = require('./hygiene.js').pruneStaleAcks(ann); } catch (_) {}
        try { fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), 'utf8'); }
        catch (e) { return json(res, 500, { ok: false, error: e.message.split('\n')[0] }); }
        if (!busy) { try { require('./build-index.js').buildIndex(LIB); } catch (e) { console.log(`⚠ hygiene-fold post-build: ${e.message.split('\n')[0]}`); } }
        console.log(`⧉ fold ${members.join(', ')} → ${rep}${repaired.length ? ` (repaired ${repaired.length} stale ack${repaired.length > 1 ? 's' : ''})` : ''}`);
        return json(res, 200, { ok: true, ackKey: key, staleAcksRepaired: repaired.length });
      }

      // F4 wiring: "Say how you got there" on an orphan finding — records the designer's own account of
      // how the page is reached. Additive to annotations.json (ann.pages[slug].reachedBy); build-index.js
      // and hygiene.js already treat this exactly like a meta.json reachedBy — the orphan reads explained.
      if (url === '/api/reached-by') {
        const slug = String(data.slug || '').trim();
        const note = String(data.note || '').trim().slice(0, 300);
        if (!slug || !note) return json(res, 400, { ok: false, error: 'need slug and a note' });
        if (!fs.existsSync(path.join(LIB, 'pages', slug))) return json(res, 404, { ok: false, error: 'unknown page slug' });
        const annPath = path.join(LIB, 'annotations.json');
        const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
        ann.pages = ann.pages || {}; ann.pages[slug] = ann.pages[slug] || {};
        ann.pages[slug].reachedBy = note;
        try { fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), 'utf8'); }
        catch (e) { return json(res, 500, { ok: false, error: e.message.split('\n')[0] }); }
        if (!busy) { try { require('./build-index.js').buildIndex(LIB); } catch (e) { console.log(`⚠ reached-by post-build: ${e.message.split('\n')[0]}`); } }
        console.log(`↳ reached-by ${slug}: ${note}`);
        return json(res, 200, { ok: true });
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
