#!/usr/bin/env node
/**
 * map.js — serve the coverage map with live download powers.
 *
 * Serves <workspace>/design-context/ on localhost (map.html as the home page) and
 * exposes two actions the static map can't do on its own:
 *   POST /api/capture {urls:[…]}          → runs capture.js --urls (selective frontier pull)
 *   POST /api/state {slug,name,url}       → records the state in annotations.json + captures it
 * Both re-run build-index automatically (capture.js does it), so the map refreshes on reload.
 *
 * One job at a time; the capture browser window opens on this machine as usual.
 * No dependencies. Usage: node map.js [--port 4173]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const args = process.argv.slice(2);
const PORT = parseInt((args[args.indexOf('--port') + 1] || '') , 10) || 4173;
const KIT = path.join(__dirname, '..');
const LIB = path.join(KIT, 'design-context');

const MIME = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
let busy = false;

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

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
  if (req.url === '/api/ping') return json(res, 200, { ok: true });

  if (req.method === 'POST' && (req.url === '/api/capture' || req.url === '/api/state')) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let data; try { data = JSON.parse(body); } catch { return json(res, 400, { ok: false, error: 'bad JSON' }); }
      if (req.url === '/api/capture') {
        const urls = (data.urls || []).filter(u => /^https?:\/\//.test(u)).slice(0, 15);
        if (!urls.length) return json(res, 400, { ok: false, error: 'no valid URLs' });
        return runCapture(['--urls', urls.join(',')], res);
      }
      // /api/state: record in annotations.json (designer-owned), then capture
      const { slug, name, url } = data;
      if (!slug || !name || !/^https?:\/\//.test(url || '')) return json(res, 400, { ok: false, error: 'need slug, name, url' });
      if (!fs.existsSync(path.join(LIB, 'pages', slug))) return json(res, 404, { ok: false, error: 'unknown page slug' });
      const annPath = path.join(LIB, 'annotations.json');
      const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
      ann.pages = ann.pages || {}; ann.pages[slug] = ann.pages[slug] || {};
      const states = ann.pages[slug].states = ann.pages[slug].states || [];
      if (!states.some(s => s.name === name)) states.push({ name, url, addedAt: new Date().toISOString() });
      fs.writeFileSync(annPath, JSON.stringify(ann, null, 2), 'utf8');
      return runCapture(['--state', `${slug}:${name}`, '--url', url], res);
    });
    return;
  }

  // static: serve design-context/, map.html as the home page — no path traversal
  const rel = decodeURIComponent((req.url.split('?')[0] === '/' ? '/map.html' : req.url.split('?')[0]));
  const file = path.normalize(path.join(LIB, rel));
  if (!file.startsWith(LIB)) return json(res, 403, { ok: false });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🗺  Coverage map: http://localhost:${PORT}`);
  console.log(`   Select greyed-out pages there to download them; add state URLs on any page.`);
  console.log(`   (Local only — nothing is exposed beyond this machine. Ctrl+C to stop.)\n`);
});
