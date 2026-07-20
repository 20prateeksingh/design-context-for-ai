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

let busy = false;              // one capture job at a time (shared by streaming + legacy runs)
let capJob = null;             // { lines:[], _partial, running, code, mode, startedAt }
let loginJob = null;           // { running, code, startedAt }
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
    });
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
        const u = (data.url || '').trim();
        if (!/^https?:\/\//.test(u)) return json(res, 400, { ok: false, error: 'need a URL starting with http:// or https://' });
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
        const u = (data.url || '').trim();
        if (!/^https?:\/\//.test(u)) return json(res, 400, { ok: false, error: 'need a valid URL' });
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
