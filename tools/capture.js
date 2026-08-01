#!/usr/bin/env node
/**
 * capture.js — one-click, read-only capture of a product's nav page layer.
 *
 * Implements the Design Context Toolkit one-click spec:
 *   • rides the persistent browser profile you logged into with login.js
 *   • discovers "important pages" from the product's own navigation (the nav IS the ranking)
 *   • follows <a href> links ONLY — never clicks buttons, never submits forms
 *   • captures each page deterministically: screenshot + self-contained editable HTML
 *     + verbatim copy + computed style tally + meta with provenance
 *   • templatizes: N same-shape pages (e.g. listing details) collapse to 1 representative,
 *     with the collapsed count logged — never silently dropped
 *   • assembles libraries/<product>/ : pages/ + ia/sitemap.json + manifest.json
 *
 * Usage:
 *   node capture.js --url https://app.example.com
 *     [--product slug]        default: derived from hostname
 *     [--profile default]     profile created by login.js
 *     [--depth 1|2]           1 = nav pages only (default); 2 = + one representative per template group
 *     [--cap 25]              max pages captured (logged when hit)
 *     [--logged-out]          public capture, ephemeral context — no profile needed
 *     [--headless]            run without a visible window (default: visible)
 *     [--no-dismiss]          never auto-dismiss cookie banners
 *
 * The single sanctioned "click" is cookie-banner dismissal: a narrow allowlist of
 * consent-button texts (privacy-preserving option preferred), every dismissal logged.
 */

const { chromium } = require('playwright');
const { launchChromium, launchPersistent } = require('./launch.js');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeThumb } = require('./thumb.js');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (f) => args.includes(f);

// --config: read url/presets(depth,cap)/loggedIn from design-context/product.json (the wizard writes
// this; the capture-product skill reads the same file). Explicit CLI flags always win over config.
const CONFIG_PATH = getArg('--config', null);
let CFG = {};
if (CONFIG_PATH) {
  const p = path.isAbsolute(CONFIG_PATH) ? CONFIG_PATH : path.join(__dirname, '..', CONFIG_PATH);
  try { CFG = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`⚠  could not read --config ${CONFIG_PATH}: ${e.message.split('\n')[0]}`); }
}
const CFG_PRESETS = CFG.presets || {};

// --login-page: capture the signed-out surface of --url into pages/login/ (PRD §2·4a). Always ephemeral.
const LOGIN_PAGE = hasFlag('--login-page');
const START_URL = getArg('--url', null) || CFG.url || null;
const ONLY_URLS = getArg('--urls', null);   // selective capture: comma-separated URLs from the map's frontier
const STATE = getArg('--state', null);      // state capture: <pageSlug>:<stateName>, with --url = the state's URL
const GUIDED = hasFlag('--guided');         // guided capture: headed browser, human drives, snapshot on the overlay button
if (require.main === module && !START_URL && !ONLY_URLS) { console.error('Usage: node capture.js --url <product URL> [--depth 1|2] [--cap 25]\n       node capture.js --urls "<u1>,<u2>"          (selective frontier pull)\n       node capture.js --state <slug>:<name> --url <stateUrl>\n       node capture.js --guided --url <startUrl>   (human drives; snapshot button-only states/modals)\n       node capture.js --config design-context/product.json   (presets + url from the wizard)\n       node capture.js --login-page --url <product URL>        (signed-out surface → pages/login/)'); process.exit(1); }

const PROFILE = getArg('--profile', 'default');
const DEPTH = parseInt(getArg('--depth', String(CFG_PRESETS.depth != null ? CFG_PRESETS.depth : 1)), 10);
const CAP = parseInt(getArg('--cap', String(CFG_PRESETS.cap != null ? CFG_PRESETS.cap : 25)), 10);
const HEADLESS = hasFlag('--headless');
const NO_DISMISS = hasFlag('--no-dismiss');
// logged-out (ephemeral, no persistent profile) when: explicit flag, login-page mode, or product.json
// says loggedIn:false. Otherwise logged-in (rides the persistent profile from login.js) — the default.
const LOGGED_OUT = hasFlag('--logged-out') || LOGIN_PAGE || CFG.loggedIn === false;
const VIEWPORT = { width: 1440, height: 900 };
// D6: see writeSnapshot's screenshot step — chosen from real captured evidence (clean up to ~9.8k px on
// some products, corrupted from ~10.7k px on others; no universal safe height), not the originally
// hypothesized 16,384px GPU texture limit, which direct testing refuted.
const SAFE_SCREENSHOT_HEIGHT = 8000;

const KIT_DIR = path.join(__dirname, '..');
const PROFILE_DIR = path.join(KIT_DIR, 'profiles', PROFILE);

// ── URL helpers ───────────────────────────────────────────────────────────────
const stripWww = (h) => h.replace(/^www\./, '');

function normalizeUrl(href, origin) {
  try {
    const u = new URL(href, origin);
    u.hash = '';
    // drop obvious tracking params, keep functional query
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(p => u.searchParams.delete(p));
    let s = u.href;
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

const SKIP_PATH = /log-?out|sign-?out|\/(auth|oauth)\//i;
const SKIP_EXT = /\.(pdf|zip|csv|xlsx?|docx?|pptx?|dmg|exe|mp4|mov|ics)(\?|$)/i;

function isCapturable(url, origin) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (stripWww(u.hostname) !== stripWww(new URL(origin).hostname)) return false; // same-origin only (www-insensitive)
    if (SKIP_PATH.test(u.pathname)) return false;
    if (SKIP_EXT.test(u.pathname + u.search)) return false;
    return true;
  } catch { return false; }
}

// Off-origin link targets this page points to but the crawl will never follow (same-origin-only, above).
// Recorded so the frontier's blind spot is visible instead of silently dropped (F11) — e.g. a marketing
// site's every "Sign in" button pointing at app.example.com, which never shows up anywhere otherwise.
// Only the origin check matters here — SKIP_PATH/SKIP_EXT are about what to crawl, not what to report.
function offOriginHostsOf(hrefs, origin) {
  let originHost; try { originHost = stripWww(new URL(origin).hostname.toLowerCase()); } catch { return []; }
  const hosts = new Set();
  for (const h of hrefs) {
    try {
      const u = new URL(h);
      if (!/^https?:$/.test(u.protocol)) continue;
      const host = stripWww(u.hostname.toLowerCase());
      if (host !== originHost) hosts.add(host);
    } catch (_) {}
  }
  return [...hosts].sort();
}

// Deterministic route-pattern detection: id-like segments → :id
const looksLikeId = (seg) =>
  /^\d+$/.test(seg) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
  /^[0-9a-f]{12,}$/i.test(seg) ||
  (/\d/.test(seg) && seg.length >= 8 && /^[A-Za-z0-9_-]+$/.test(seg));

function routePattern(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).map(s => looksLikeId(s) ? ':id' : s);
    return '/' + segs.join('/');
  } catch { return url; }
}

// Merge detail-template groups whose patterns differ in exactly ONE segment,
// when that position is already a wildcard (:id/:var) in one of them.
// Catches e.g. /boAt-Rockerz-Earphones/dp/:id + /:id/dp/:id → /:var/dp/:id
// (product-name slugs aren't id-like, so they'd otherwise fragment one template
// into many groups and burn capture slots on redundant same-template pages).
// Deterministic; only ever applied to :id-bearing (detail) patterns.
function mergeTemplateGroups(groups) { // Map<pattern, {urls:Set, from}>
  let changed = true;
  while (changed) {
    changed = false;
    const pats = [...groups.keys()];
    outer:
    for (let i = 0; i < pats.length; i++) {
      for (let j = i + 1; j < pats.length; j++) {
        const a = pats[i].split('/'), b = pats[j].split('/');
        if (a.length !== b.length) continue;
        let diff = -1, ok = true;
        for (let k = 0; k < a.length; k++) {
          if (a[k] !== b[k]) { if (diff !== -1) { ok = false; break; } diff = k; }
        }
        if (!ok || diff === -1) continue;
        const isWild = (s) => s === ':id' || s === ':var' || s === ':slug';
        if (!isWild(a[diff]) && !isWild(b[diff])) continue; // need wildcard evidence on one side
        const merged = a.map((s, k) => k === diff ? ':var' : s).join('/');
        const ga = groups.get(pats[i]), gb = groups.get(pats[j]);
        groups.delete(pats[i]); groups.delete(pats[j]);
        groups.set(merged, { urls: new Set([...ga.urls, ...gb.urls]), from: ga.from });
        changed = true; break outer;
      }
    }
  }
}

// Analytics/nav-source params that must NOT fork a page into a distinct slug: they carry no content
// (e.g. flipkart's ?link=home_rewards, utm_*, gclid). Stripping them is what makes the automated crawl
// and guided capture agree on one slug per page — otherwise the crawl (following a tracked nav link)
// and a guided visit (clean URL) produce two folders for the same page. Conservative denylist.
const TRACKING_PARAM = /^(link|otracker\d*|utm_[a-z]+|gclid|gclsrc|fbclid|dclid|msclkid|mc_eid|mc_cid|igshid|_ga|cmpid|spm|ref_)$/i;
function cleanSearch(search) {
  if (!search) return '';
  let sp; try { sp = new URLSearchParams(search); } catch { return ''; }
  for (const k of [...sp.keys()]) if (TRACKING_PARAM.test(k)) sp.delete(k);
  const kept = [...sp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // stable → order-independent
  return kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '';
}
// Canonical per-page identity: host + pathname (no trailing slash) + meaningful query (tracking stripped, sorted).
// The one key the crawl and guided both derive the same, so "already captured?" is answered consistently.
// The HOST is part of the identity: two pages are only "the same route" (safe to overwrite in place) when the
// host matches too. Without it, a product's signed-out surface and its signed-in app — the shape --login-page
// captures by design (www.pinterest.com/ → pages/login, in.pinterest.com/ → pages/home) — both key "/" and
// guided "recognizes" one as the other, overwriting it with the wrong content. www. is stripped so
// www.flipkart.com ≡ flipkart.com (one product, two spellings), but in.pinterest.com ≢ www.pinterest.com.
// MIRRORED in build-index.js — the two must agree exactly; guard: node tools/test-routekey.js.
function routeKey(url) {
  try { const u = new URL(url); let p = u.pathname; if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1); return stripWww(u.host.toLowerCase()) + p + cleanSearch(u.search); }
  catch { return url || '/'; }
}
function slugFor(url, origin) {
  try {
    const u = new URL(url);
    let s = u.pathname === '/' ? 'home' : u.pathname.split('/').filter(Boolean).join('-');
    s = s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const cs = cleanSearch(u.search);                    // tracking params never fork the slug
    if (cs) s += '-' + crypto.createHash('sha1').update(cs).digest('hex').slice(0, 6);
    return s.slice(0, 80) || 'home';
  } catch { return 'page'; }
}

// ── Settle: load + network-idle attempt + DOM-quiet window (SPA-safe) ─────────
async function settle(page) {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => new Promise((resolve) => {
    const QUIET = 800, MAX = 6000;
    let timer, done = false;
    const finish = () => { if (!done) { done = true; obs.disconnect(); resolve(); } };
    const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(finish, QUIET); });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    timer = setTimeout(finish, QUIET);
    setTimeout(finish, MAX);
  })).catch(() => {});
}

// ── Cookie-banner dismissal — the one sanctioned click, allowlisted + logged ──
// Preference order (M3, v1-fix-manifest-record): reject/decline/necessary-only first (most
// privacy-preserving), then a neutral dismiss/close/got-it, and accept-all only as a last resort.
// Was one flat list with accept-all interleaved before dismiss/close — on espncricinfo that meant
// "accept all" matched before "got it" even though both were present. Order now IS the priority.
const DISMISS_TEXTS = [
  'reject all', 'decline all', 'only essential', 'essential only', 'reject non-essential', 'necessary only', 'decline', 'reject',
  'dismiss', 'close', 'got it', 'ok, got it', 'understood', 'ok',
  'accept all', 'allow all', 'accept cookies', 'i agree', 'agree', 'accept',
];
// Pure + exported so the preference order is unit-testable without a browser (test-dismiss-order.js).
// Mirrors the in-page evaluate() logic below exactly — that closure can't require() this module
// (page.evaluate serializes its own scope only), so the algorithm is intentionally duplicated, not the data.
function pickDismissText(availableTexts) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const set = new Set((availableTexts || []).map(norm));
  for (const t of DISMISS_TEXTS) if (set.has(t)) return t;
  return null;
}
async function dismissBanner(page, log) {
  if (NO_DISMISS) return;
  try {
    const clicked = await page.evaluate((texts) => {
      const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(el => el.offsetParent !== null);
      for (const t of texts) {
        const el = candidates.find(el => norm(el.innerText) === t && (el.innerText || '').length < 30);
        if (el) { el.click(); return t; }
      }
      return null;
    }, DISMISS_TEXTS);
    if (clicked) {
      log.push({ action: 'dismissed-banner', buttonText: clicked, at: new Date().toISOString() });
      console.log(`   🍪 dismissed banner via "${clicked}" (logged)`);
      await page.waitForTimeout(600);
    }
  } catch (_) {}
}

// ── Nav discovery: the product's own navigation is the ranking ────────────────
async function discoverNav(page, origin) {
  const found = await page.evaluate(() => {
    const scopes = Array.from(document.querySelectorAll('nav, [role="navigation"], aside, header'));
    const grab = (root) => Array.from(root.querySelectorAll('a[href]')).map(a => {
      // aria-label first (clean, singular); otherwise the anchor's OWN heading — not its whole subtree,
      // which concatenates a heading + description run together on nav-dropdown anchors ("Xflow Receiving
      // AccountsOur version of virtual foreign currency accounts…"). Many nav anchors have neither a
      // heading element nor an aria-label (plain <p> siblings, e.g. Tailwind-style dropdown cards) — for
      // those we want the first sibling's text as the heading. innerText can't be trusted for this: mega-menu
      // items sit inside a CLOSED dropdown (zero-size ancestor, offsetParent null), and unlaid-out elements
      // never get innerText's block-boundary newlines — the whole subtree serializes as one run-on string.
      // leafLines() walks the DOM directly (computed `display`/box model, not actual layout) and puts each
      // leaf text-bearing element on its own line, so it works whether or not the menu is currently open.
      const leafLines = (el) => {
        const lines = [];
        (function walk(node) {
          const kids = Array.from(node.children);
          const direct = Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
          if (direct) lines.push(direct);
          kids.forEach(walk);
        })(el);
        return lines;
      };
      const head = a.querySelector('h1,h2,h3,h4,h5,h6,strong,b,[class*="title"],[class*="label"]');
      const firstLine = leafLines(a)[0] || '';
      let label = (a.getAttribute('aria-label') || (head && head.innerText) || firstLine)
        .trim().replace(/\s+/g, ' ');
      if (label.length > 60) label = label.slice(0, 60).replace(/\s+\S*$/, '') + '…'; // never cut mid-word
      label = label.split(' ').filter((w, i, ws) => w !== ws[i - 1]).join(' '); // drop consecutive dupes
      return { href: a.href, label };
    });
    let links = scopes.flatMap(grab);
    let source = 'nav-landmarks';
    if (links.length < 2) { links = grab(document.body); source = 'all-anchors-fallback'; }
    return { links, source };
  });
  const seen = new Set(); const out = [];
  for (const l of found.links) {
    const url = normalizeUrl(l.href, origin);
    if (!url || !isCapturable(url, origin) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: l.label || null });
  }
  return { candidates: out, source: found.source };
}

// ── Per-page artifacts (all deterministic, method: "dom") ─────────────────────
async function extractContent(page) {
  return await page.evaluate(() => {
    const lines = [];
    const skip = (el) => {
      const t = el.tagName;
      if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','PATH'].includes(t)) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden';
    };
    const walk = (el) => {
      if (skip(el)) return;
      const h = el.tagName.match(/^H([1-6])$/);
      if (h) { const txt = el.innerText.trim().replace(/\s+/g, ' '); if (txt) lines.push('\n' + '#'.repeat(+h[1]) + ' ' + txt); return; }
      for (const node of el.childNodes) {
        if (node.nodeType === 3) { const txt = node.textContent.trim().replace(/\s+/g, ' '); if (txt) lines.push(txt); }
        else if (node.nodeType === 1) walk(node);
      }
    };
    walk(document.body);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  });
}

async function tallyComputedTokens(page) {
  return await page.evaluate(() => {
    const tally = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
    const colors = {}, type = {}, spacing = {}, radius = {}, shadows = {};
    const els = Array.from(document.querySelectorAll('body *')).slice(0, 4000);
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      tally(colors, cs.color);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') tally(colors, cs.backgroundColor);
      if (el.innerText && el.children.length === 0) tally(type, `${cs.fontSize} / ${cs.fontWeight} / ${cs.fontFamily.split(',')[0].replace(/"/g, '')}`);
      [cs.paddingTop, cs.paddingLeft, cs.marginTop, cs.marginLeft].forEach(v => { if (v && v !== '0px') tally(spacing, v); });
      if (cs.borderRadius && cs.borderRadius !== '0px') tally(radius, cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== 'none') tally(shadows, cs.boxShadow);
    }
    const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([value, count]) => ({ value, count }));
    return {
      method: 'dom', note: 'computed-style tally on THIS page; counts = elements observed',
      colors: top(colors, 40), typography: top(type, 25), spacing: top(spacing, 25),
      radius: top(radius, 10), shadows: top(shadows, 10),
    };
  });
}

// ── Self-contained snapshot processing (from the proven Xflow capture) ────────
function absolutiseCssUrls(css, href) {
  return css.replace(/url\(\s*(['"]?)(?!data:|https?:|#)([^'")]+)\1\s*\)/g,
    (_, q, rel) => { try { return `url(${q}${new URL(rel, href).href}${q})`; } catch { return _; } });
}

async function inlineStylesheets(page, context) {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href));
  for (const href of hrefs) {
    try {
      const resp = await context.request.get(href);
      if (!resp.ok()) continue;
      const css = absolutiseCssUrls(await resp.text(), href);
      await page.evaluate(({ href, css }) => {
        const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(l => l.href === href);
        if (link) { const s = document.createElement('style'); s.textContent = css; link.replaceWith(s); }
      }, { href, css });
    } catch (_) {}
  }
}

const MAX_INLINE_BYTES = 400 * 1024;   // same ceiling for fetched images and resolved blobs — huge media stays remote

// blob: (object URL) images — resolve IN PAGE CONTEXT, before serialization.
// An object URL is only valid inside the live tab, so Node can never fetch it after the fact; skipping it
// (what we used to do) shipped a baseline with broken images on every lazy-image product (Pinterest's grid).
// fetch(blobUrl) → Blob → FileReader data: URL, rewriting the src. Failures leave the src untouched and are
// COUNTED (and marked in the DOM) — hygiene's blob: check then reports a page we tried and couldn't fix,
// rather than the fix failing silently.
async function inlineBlobImages(page) {
  return await page.evaluate(async (maxBytes) => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => (i.getAttribute('src') || '').startsWith('blob:'));
    const cache = new Map();   // one fetch per distinct object URL, however many <img> share it
    let resolved = 0, failed = 0, tooBig = 0;
    for (const img of imgs) {
      const src = img.getAttribute('src');
      try {
        if (!cache.has(src)) {
          const resp = await fetch(src);
          if (!resp.ok) throw new Error('fetch ' + resp.status);
          const blob = await resp.blob();
          if (blob.size > maxBytes) { cache.set(src, { tooBig: true }); }
          else cache.set(src, { dataUri: await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result); fr.onerror = () => rej(new Error('read failed'));
            fr.readAsDataURL(blob);
          }) });
        }
        const hit = cache.get(src);
        if (hit.tooBig) { tooBig++; img.setAttribute('data-dck-blob', 'too-large'); continue; }
        img.setAttribute('src', hit.dataUri); img.removeAttribute('srcset'); resolved++;
      } catch (_) { failed++; img.setAttribute('data-dck-blob', 'unresolved'); }
    }
    return { resolved, failed, tooBig };
  }, MAX_INLINE_BYTES).catch(() => ({ resolved: 0, failed: 0, tooBig: 0, error: true }));
}

async function inlineImages(page, context) {
  const srcs = await page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll('img')).map(i => i.src))]);
  for (const src of srcs) {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    try {
      const resp = await context.request.get(src);
      if (!resp.ok()) continue;
      const buf = await resp.body();
      if (buf.length > MAX_INLINE_BYTES) continue; // keep huge media remote
      const ct = (resp.headers()['content-type'] || 'image/png').split(';')[0];
      const dataUri = `data:${ct};base64,${buf.toString('base64')}`;
      await page.evaluate(({ src, dataUri }) => {
        document.querySelectorAll('img').forEach(i => {
          if (i.src === src) { i.setAttribute('src', dataUri); i.removeAttribute('srcset'); }
        });
      }, { src, dataUri });
    } catch (_) {}
  }
}

function makeStatic(html, url) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<link\b[^>]*rel=["'](?:modulepreload|preload)["'][^>]*as=["']?script["']?[^>]*>/gi, '')
    .replace('<head>',
      `<head>\n<!-- DESIGN CONTEXT SNAPSHOT of ${url} — real DOM + real CSS, scripts stripped. Edit this as the design baseline. -->`);
}

function prettyHtml(html) {
  try {
    return require('js-beautify').html(html, {
      indent_size: 2, wrap_line_length: 0, preserve_newlines: false,
      unformatted: ['svg', 'path', 'g', 'defs', 'clipPath', 'rect', 'pre', 'code'], extra_liners: [],
    });
  } catch (_) { return html; }
}

function contentHash(html) {
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [''])[0]
    .replace(/data:[^"')\s]+/g, '').replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
}

// ── Bad-page classification: soft-404s AND bot/CDN blocks ─────────────────────
// A blocked route (Akamai/Cloudflare "Access Denied", challenge pages) must be
// skipped with a reason, never saved as if it were real product content.
async function classifyBadPage(page) {
  return await page.evaluate(() => {
    const probe = document.title + ' ' + (document.querySelector('h1,h2')?.innerText || '');
    const tiny = (document.body?.innerText || '').length < 400;
    if (/access denied|forbidden|error 403|errors\.edgesuite\.net|attention required|just a moment|verify you are (a )?human|request blocked/i.test(probe)
      || (tiny && /denied|blocked|forbidden|captcha/i.test(document.body?.innerText || ''))) return 'blocked';
    const notFound = /page (you are looking for )?(was|has been)? ?(not found|moved or deleted)|page not found|404|doesn.t exist/i;
    if (notFound.test(probe)) return 'soft-404';
    if (tiny && notFound.test(document.body?.innerText || '')) return 'soft-404'; // near-empty body with a not-found message (e.g. Flipkart's "moved or deleted")
    return null;
  });
}

// D1: measure, don't guess — count loading indicators (same signature hygiene.js's old heuristic
// looked for: role="progressbar", class matching skeleton/shimmer/spinner/loading) that are ACTUALLY
// VISIBLE in the live DOM at snapshot time. Ground truth written once, at capture; hygiene.js reads
// it instead of re-guessing from content length + a static regex over serialized HTML.
const LOADING_MARKER_SELECTOR = '[role="progressbar"], [class*="skeleton" i], [class*="shimmer" i], [class*="spinner" i], [class*="loading" i]';
async function countVisibleLoadingMarkers(page) {
  return await page.evaluate((sel) => {
    const isVisible = (el) => {
      if (el.offsetParent === null) return false; // display:none or a display:none ancestor
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      return true;
    };
    const visible = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    return {
      count: visible.length,
      selectors: visible.slice(0, 5).map(el => el.tagName.toLowerCase() + (el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : '')),
    };
  }, LOADING_MARKER_SELECTOR).catch(() => ({ count: 0, selectors: [] }));
}

// ── Snapshot the CURRENTLY-LOADED page → pages/<subdir||slug>/ ────────────────
// No navigation: the caller has already positioned the page (capturePage navigates first;
// guided capture lets the human navigate/click). Reused by both so the artifact shape is identical.
// NOTE: inlining mutates the live DOM (link→style, img→data-uri). Callers that keep interacting
// with the page afterward (guided mode) remount their own UI after this returns.
async function writeSnapshot(page, context, requestedUrl, meta, outDir) {
  const finalUrl = page.url();
  const bad = await classifyBadPage(page);
  if (bad) return { status: bad, finalUrl };

  const slug = meta.slug;
  const dir = path.join(outDir, 'pages', meta.subdir || slug); // states land under pages/<slug>/states/<name>/
  fs.mkdirSync(dir, { recursive: true });

  // 1. screenshot first (pixel truth, before DOM mutation). Hide any guided overlay JUST for the shot
  // (so the pill never lands in the PNG), then restore it — the designer keeps seeing the "Capturing…"
  // pill through the slower passes below. No-op for the automated crawl (no such element).
  await page.evaluate(() => document.querySelectorAll('[id^="__dck"]').forEach(e => { e.dataset.dckVis = e.style.visibility; e.style.visibility = 'hidden'; })).catch(() => {});
  // D6: Playwright's fullPage screenshot scroll-and-stitches a tall page in viewport-sized tiles, and a
  // page with sticky/fixed header or sidebar chrome (confirmed on real MDN AND Wikipedia captures) gets
  // that chrome re-rendered fresh at each tile boundary — it ends up duplicated, overlaid on top of the
  // content still scrolling underneath. This was suspected to track Chromium's 16,384px GPU texture
  // limit; direct evidence refutes that — corruption reproduced as low as ~10,700px on MDN while a
  // GitHub/Amazon page past 9,700px stayed clean (whether the PAGE has sticky chrome decides it, not a
  // fixed height). With no universal safe "let it stitch" height, a single-shot capture of just the top
  // slice — at a resized viewport, so Chromium never tiles at all — trades a full (but sometimes
  // corrupted) shot for an honest, always-clean partial one.
  const fullPx = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  let screenshotTruncated = null;
  if (fullPx > SAFE_SCREENSHOT_HEIGHT) {
    await page.setViewportSize({ width: VIEWPORT.width, height: SAFE_SCREENSHOT_HEIGHT });
    await page.screenshot({ path: path.join(dir, 'screenshot.png') });
    await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
    screenshotTruncated = { shownPx: SAFE_SCREENSHOT_HEIGHT, fullPx };
  } else {
    await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true }).catch(async () => {
      await page.screenshot({ path: path.join(dir, 'screenshot.png') }); // fullPage can fail on huge pages
    });
  }
  await page.evaluate(() => document.querySelectorAll('[id^="__dck"]').forEach(e => { e.style.visibility = e.dataset.dckVis || ''; delete e.dataset.dckVis; })).catch(() => {});

  // 1b. the render-time thumbnail, derived from the PNG we just wrote. Here because this is the cheap
  // moment — the file is on disk and warm — but NOT because a browser is needed: tools/thumb.js does the
  // decode/downscale/re-encode in integer arithmetic on Node's own zlib, so build-index.js produces the
  // same bytes when it backfills a library captured before this shipped. Never fatal: a page with no
  // thumbnail renders its full screenshot everywhere, which is exactly what every page did before.
  // Pages only — a state's screenshot renders in a 150×92 strip and is out of scope (see thumb.js).
  if (!meta.subdir) {
    const t = writeThumb(dir);
    if (!t.ok) console.log(`   thumbnail skipped for ${slug} — ${t.reason} (the full screenshot renders instead)`);
  }

  // 2. verbatim copy + computed tokens + outbound links + loading markers (read-only DOM passes)
  const [content, tokens, linksOut, title, loadingMarkers] = [
    await extractContent(page),
    await tallyComputedTokens(page),
    await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.href))]),
    await page.title(),
    await countVisibleLoadingMarkers(page),
  ];

  // 3. self-contained editable snapshot (blobs first — resolved ones become data: and the pass below skips them)
  const blobs = await inlineBlobImages(page);
  await inlineStylesheets(page, context);
  await inlineImages(page, context);
  // Strip any guided overlay from the SAVED html (never part of the product). Removing it from the live
  // DOM here is fine — guided mode remounts the pill after writeSnapshot returns. No-op for the crawl.
  let html = await page.evaluate(() => { document.querySelectorAll('[id^="__dck"]').forEach(e => e.remove()); return `<!DOCTYPE html>${document.documentElement.outerHTML}`; });
  html = prettyHtml(makeStatic(html, finalUrl));

  const method = meta.method || 'dom';
  fs.writeFileSync(path.join(dir, 'page.html'), html, 'utf8');
  fs.writeFileSync(path.join(dir, 'content.md'), `# ${title}\n\nSource: ${finalUrl} — verbatim copy, method: ${method}\n\n${content}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'computed-tokens.json'), JSON.stringify(tokens, null, 2), 'utf8');

  const origin = new URL(finalUrl).origin;
  const outLinks = linksOut.map(h => normalizeUrl(h, origin)).filter(u => u && isCapturable(u, origin));
  const metaOut = {
    url: requestedUrl, finalUrl, route: new URL(finalUrl).pathname, pattern: meta.pattern || routePattern(finalUrl),
    title, navLabel: meta.label || null,
    template: meta.template || null, collapsed: meta.collapsed || 0,
    linksOut: [...new Set(outLinks)].slice(0, 200),
    offOriginHosts: offOriginHostsOf(linksOut, origin), // F11: hosts this page links to that the crawl can't follow
    capturedAt: new Date().toISOString(), viewport: VIEWPORT,
    source: 'scrape', method, contentHash: contentHash(html),
    // D1: ground truth for hygiene's mid-render check — see countVisibleLoadingMarkers above.
    visibleLoadingMarkers: loadingMarkers.count,
    ...(loadingMarkers.count ? { visibleLoadingMarkerSelectors: loadingMarkers.selectors } : {}),
    ...(screenshotTruncated ? { screenshotTruncated } : {}),
    // method: 'guided' — reached by a human interaction (click/wizard), not URL navigation.
    // reachedBy records HOW, so a state with no inbound link is explained, not mysterious.
    ...(meta.reachedBy ? { reachedBy: meta.reachedBy } : {}),
    ...(meta.loginPage ? { capturedLoggedOut: true, note: 'signed-out surface captured before login existed' } : {}),
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(metaOut, null, 2), 'utf8');
  return { status: 'ok', slug, finalUrl, meta: metaOut, sizeKb: Math.round(html.length / 1024), blobImages: blobs };
}

// Blob-resolution outcome, appended to a capture's status line. Silent when nothing needed resolving or
// everything resolved; loud (per-page, on the same line) when an object URL could not be recovered.
function blobNote(r) {
  const b = r && r.blobImages; if (!b) return '';
  const left = (b.failed || 0) + (b.tooBig || 0);
  if (!left) return b.resolved ? ` · ${b.resolved} blob img inlined` : '';
  const parts = [];
  if (b.failed) parts.push(`${b.failed} unresolved`);
  if (b.tooBig) parts.push(`${b.tooBig} over ${Math.round(MAX_INLINE_BYTES / 1024)}KB`);
  return ` · ⚠ blob img: ${parts.join(', ')}${b.resolved ? `, ${b.resolved} inlined` : ''} (left as-is — hygiene flags this page)`;
}

// ── Lazy-content settle: step-scroll until the page stops growing, then return to top ─────────
// Infinite-scroll and lazy-mounted grids keep everything below the fold OUT of the DOM until it scrolls
// into view, so serializing straight after load ships a mostly-empty baseline of a content-rich page.
// Step by one viewport, watch document.body.scrollHeight, stop when it stabilises (or the caps hit),
// then return to the top so the full-page screenshot and the DOM both start where the designer expects.
//
// PRODUCT RULE, not an optimization: this is called from capturePage (URL-driven modes — crawl, depth-2,
// --urls, --state, --login-page) and NEVER from the guided path, which calls writeSnapshot directly. In
// guided capture a human framed that exact state — an open modal, a mid-wizard step — and auto-scrolling
// could dismiss or mutate it. Keeping the call here, one level above writeSnapshot, is what makes that
// separation structural rather than a flag someone can flip by accident.
async function scrollAndSettle(page) {
  const MAX_STEPS = 12, HARD_MS = 10000, STEP_WAIT = 450;
  const startedAt = Date.now();
  const height = () => page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
  let steps = 0, stableRounds = 0, grew = 0;
  try {
    let last = await height();
    const startHeight = last;
    for (; steps < MAX_STEPS; steps++) {
      if (Date.now() - startedAt > HARD_MS) break;
      const atBottom = await page.evaluate(() => window.scrollY + window.innerHeight >= (document.body ? document.body.scrollHeight : 0) - 2);
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(STEP_WAIT);
      const h = await height();
      if (h > last) { grew += h - last; last = h; stableRounds = 0; }
      else if (atBottom && ++stableRounds >= 2) break;   // bottom reached twice with no growth → done
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);                       // let sticky headers re-settle and lazy images paint
    return { steps, grewPx: grew, startHeight, endHeight: last };
  } catch (_) { return { steps, grewPx: grew, error: true }; }
}

// ── Capture one page → pages/<slug>/ (navigate, settle, then snapshot) ────────
async function capturePage(page, context, url, meta, outDir, actionLog) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page);
  await dismissBanner(page, actionLog);

  const finalUrl = page.url();
  // In --login-page mode the login route IS the target — capture it; skip the auth-redirect guard.
  if (!meta.loginPage && /\/(login|signin|sign-in|signup|auth)\b/i.test(new URL(finalUrl).pathname) && !/login|signin/i.test(new URL(url).pathname)) {
    return { status: 'auth-redirect', finalUrl };
  }
  await scrollAndSettle(page);   // lazy content into the DOM — URL-driven modes only, never guided (see above)
  return writeSnapshot(page, context, url, meta, outDir);
}

// ── Guided-capture overlay (runs IN the page; injected on every document) ─────
// A simple bottom-center pill. It is URL-AWARE: on every navigation it asks Node whether the
// current URL has been captured (calm ✓ + timestamp) or is new (loud ✦), and auto-derives the
// page slug + reached-by note so the designer types nothing in the common case. The only optional
// field is a state name for a button-only tab (the URL can't reveal which tab is active) — and even
// that is auto-suggested from the active tab. The designer drives the product; this only records.
// Excluded from the snapshot itself (the Node handler removes it before capture, remounts after).
function guidedOverlayInjector() {
  if (window.top !== window) return; // top frame only
  const slugify = (s) => (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  // Best-effort: read the active tab / current wizard step / modal heading so the state name is pre-filled.
  function detectState() {
    const first = (el) => el && el.innerText ? el.innerText.trim().split('\n')[0].trim() : '';
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"],.modal,.drawer');
    if (dialog) {
      const step = dialog.querySelector('[aria-current="step"],[class*="step"][class*="active"],[class*="active"][class*="step"]');
      return slugify(first(step) || first(dialog.querySelector('h1,h2,[role="heading"]')) || 'modal');
    }
    const selTab = document.querySelector('[role="tab"][aria-selected="true"]');
    if (selTab) return slugify(first(selTab));
    const active = Array.from(document.querySelectorAll('[role="tablist"] *,[class*="tab"] a,[class*="tab"] button,[role="tab"]'))
      .find(el => /(^|[\s_-])(active|selected)([\s_-]|$)/i.test(el.className || ''));
    return slugify(first(active));
  }
  function build() {
    if (document.getElementById('__dck_overlay') || !document.body) return;
    const wrap = document.createElement('div');
    wrap.id = '__dck_overlay';
    wrap.setAttribute('style', 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;background:#111;color:#fff;padding:9px 10px 9px 14px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.42);font:13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:92vw');
    // one-time keyframe for the "capturing" pulse (scoped id, harmless if it lands nowhere)
    if (!document.getElementById('__dck_kf')) { const kf = document.createElement('style'); kf.id = '__dck_kf';
      kf.textContent = '@keyframes __dckpulse{0%,100%{opacity:1}50%{opacity:.35}}'; document.head && document.head.appendChild(kf); }
    wrap.innerHTML =
      '<span id="__dck_dot" style="width:9px;height:9px;border-radius:50%;background:#888;flex:none"></span>' +
      '<span id="__dck_status" style="white-space:nowrap;max-width:40vw;overflow:hidden;text-overflow:ellipsis">…</span>' +
      '<input id="__dck_state" placeholder="state name" style="display:none;width:140px;padding:6px 9px;border:1px solid #444;border-radius:999px;background:#1c1c1c;color:#fff;font:12px sans-serif">' +
      '<button id="__dck_btn" style="flex:none;padding:7px 15px;border:0;border-radius:999px;background:#2f6fed;color:#fff;font-weight:600;cursor:pointer">📸 Capture</button>' +
      '<button id="__dck_recap" style="display:none;flex:none;padding:7px 12px;border:1px solid #555;border-radius:999px;background:transparent;color:#ddd;font-weight:600;cursor:pointer">↻ Re-capture page</button>';
    document.body.appendChild(wrap);
    const dot = wrap.querySelector('#__dck_dot'), statusEl = wrap.querySelector('#__dck_status');
    const stateInput = wrap.querySelector('#__dck_state'), btn = wrap.querySelector('#__dck_btn'), recapBtn = wrap.querySelector('#__dck_recap');
    let cur = { slug: '', captured: false, at: null }, userEdited = false, busy = false;
    stateInput.addEventListener('input', () => { userEdited = true; });
    function setBusy(on) { busy = on; btn.disabled = on; recapBtn.disabled = on;
      dot.style.background = on ? '#f0a020' : dot.style.background; dot.style.animation = on ? '__dckpulse 1s ease-in-out infinite' : 'none';
      if (on) { statusEl.style.color = '#ffe6b0'; statusEl.textContent = '⏳ Capturing this page… (big pages take a few seconds)'; } }
    async function refresh() {
      if (busy) return;                                    // don't clobber the "Capturing…" message mid-shot
      let info; try { info = await window.__dckStatus(location.href); } catch { return; }
      if (!info) return;
      cur = info; dot.style.animation = 'none';
      if (info.captured) {
        dot.style.background = '#4ac36a'; statusEl.style.color = '#d4ecd9';
        statusEl.textContent = `✓ in your library since ${info.at} — Capture adds a state`;
        stateInput.style.display = ''; recapBtn.style.display = '';   // offer overwrite of the existing page
        if (!userEdited) stateInput.value = detectState();
      } else {
        dot.style.background = '#ff5252'; statusEl.style.color = '#ffd5d5';
        statusEl.textContent = `✦ NEW — not in your library yet`;
        stateInput.style.display = 'none'; recapBtn.style.display = 'none';
      }
    }
    async function doCapture(payload, okLabel) {
      setBusy(true);
      try {
        const r = await window.__dckCapture(payload);
        statusEl.style.color = r && r.ok ? '#d4ecd9' : '#ffb3b3';
        statusEl.textContent = r && r.ok ? `✓ ${okLabel || 'saved'} ${r.label || ''}`.trim() : `✗ ${(r && r.error) || 'failed'}`;
        userEdited = false;
      } catch (e) { statusEl.style.color = '#ffb3b3'; statusEl.textContent = '✗ ' + (e.message || 'failed'); }
      setBusy(false);
      setTimeout(refresh, 1000);
    }
    btn.addEventListener('click', () => doCapture({ url: location.href, state: cur.captured ? (stateInput.value.trim() || detectState()) : '' }, 'saved'));
    recapBtn.addEventListener('click', () => doCapture({ url: location.href, recapture: true }, 're-captured'));
    refresh();
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; userEdited = false; refresh(); } }, 700);
    window.__dckRefresh = refresh;
  }
  window.__dckMount = () => { const e = document.getElementById('__dck_overlay'); if (e) e.remove(); build(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
}

// ── Non-guided capture-window progress pill (busy-states-everywhere B2) ───────
// crawl/--urls/--state opened a headed Chromium and left the window silent — no sign the kit was
// driving it, no sign whether the designer could touch it. This is the read-only counterpart to
// guidedOverlayInjector above: same injection mechanism (an init script, so it survives every
// navigation), same visual family, but output only — no button, no input, nothing for a click to
// land on (`pointer-events:none` on the wrapper is belt-and-suspenders on top of that). Node holds
// the one thing that changes, `progressState` (set right before each capturePage call, in the loop
// that drives this mode); the pill asks for it once on mount via the exposed `__dckProgress` binding
// and polls lightly afterward, rather than Node pushing into a page it's about to navigate away from.
// Copy is locked in ux-copy.md (2026-07-30, "busy states everywhere").
function progressPillInjector() {
  if (window.top !== window) return; // top frame only
  let pending = null;
  function render(state) {
    const el = document.getElementById('__dck_progress_text');
    if (!el) { pending = state; return; }
    let fragment = 'starting capture…';
    if (state && state.label) {
      fragment = state.total ? `capturing ${state.index} of ${state.total} — ${state.label}` : `capturing ${state.label}`;
    }
    el.textContent = `Design Context Kit — driving this window, please don't click · ${fragment}`;
  }
  function build() {
    if (document.getElementById('__dck_progress') || !document.body) return;
    if (!document.getElementById('__dck_progress_kf')) {
      const kf = document.createElement('style'); kf.id = '__dck_progress_kf';
      kf.textContent = '@keyframes __dckprogspin{to{transform:rotate(360deg)}}';
      document.head && document.head.appendChild(kf);
    }
    const wrap = document.createElement('div');
    wrap.id = '__dck_progress';
    wrap.setAttribute('style', 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;background:#111;color:#fff;padding:9px 14px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.42);font:13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:92vw;pointer-events:none');
    wrap.innerHTML =
      '<span id="__dck_progress_ring" aria-hidden="true" style="width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;flex:none;animation:__dckprogspin .8s linear infinite"></span>' +
      '<span id="__dck_progress_text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Design Context Kit — driving this window, please don\'t click · starting capture…</span>';
    document.body.appendChild(wrap);
    render(pending);
  }
  async function poll() { try { render(await window.__dckProgress()); } catch (_) {} }
  function start() { build(); poll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  setInterval(poll, 1000);
}

// ── Cumulative capture record (M1, v1-fix-manifest-record) ────────────────────────────────────
// manifest.json describes only the latest run and OVERWRITES — a run after a prior one destroys that
// prior run's skipped[]/failed[] record (real damage already done: espncricinfo's two genuinely-blocked
// URL families were observed once, then unevidencable once a later run replaced manifest.json). This is
// additive: one entry appended per run, across all five modes (crawl/urls/state/guided/login-page).
// Mirrors the guided-sessions.json read-modify-write pattern used a few hundred lines below.
function appendCaptureLog(outDir, entry) {
  const p = path.join(outDir, 'capture-log.json');
  let store = { runs: [] };
  if (fs.existsSync(p)) { try { const prev = JSON.parse(fs.readFileSync(p, 'utf8')); if (prev && Array.isArray(prev.runs)) store = prev; } catch (_) {} }
  store.runs.push(entry);
  fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
  return store.runs.length;
}

// Flatten hygiene.js's grouped findings into a plain list for persistence (F4·1). Mirrors the section
// renders in hygiene.formatHygiene so the ledger's detail lines read the same, action included.
function flattenHygiene(f) {
  if (!f || f.error) return [];
  const out = [];
  const push = (it, text) => out.push({ severity: it.severity || 'warn', text, action: it.action || '' });
  let renderDuplicate; try { ({ renderDuplicate } = require('./hygiene.js')); } catch (_) {}
  if (!renderDuplicate) renderDuplicate = (it) => `${(it.pages || []).join(', ')} — ${it.issue}`;
  for (const it of f.duplicates || []) push(it, renderDuplicate(it));
  for (const it of f.orphans || []) push(it, `${it.page} (${it.route}) — ${it.issue}`);
  for (const it of f.identicalStates || []) push(it, `${it.page} › ${it.state} — ${it.issue}`);
  for (const it of f.quality || []) push(it, `${it.target} — ${it.issue}`);
  return out;
}

// Exported for tests/reuse. Requiring this file no longer auto-runs the CLI (guarded below).
module.exports = { writeSnapshot, capturePage, guidedOverlayInjector, progressPillInjector, routePattern, slugFor, routeKey, cleanSearch, flattenHygiene, appendCaptureLog, pickDismissText, DISMISS_TEXTS };

// ── Main ──────────────────────────────────────────────────────────────────────
if (require.main === module) (async () => {
  // ── Login-page mode (PRD §2·4a): ephemeral, logged-out, one page → pages/login/ ──
  // Runs BEFORE login.js, so no persistent profile exists yet — uses a throwaway context that
  // never touches (or locks) the designer's profile. The signed-out surface is uncapturable once
  // logged in (the route redirects into the app), so it must be grabbed first.
  if (LOGIN_PAGE) {
    const OUT_DIR = path.join(KIT_DIR, 'design-context');
    fs.mkdirSync(path.join(OUT_DIR, 'pages'), { recursive: true });
    console.log(`\n🚀 Login-page capture (logged-out, ephemeral) — ${START_URL}\n`);
    const browser = await launchChromium({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const actionLog = [];
    let loginCaptured = 0, loginSkipped = [], loginFailed = [];
    process.stdout.write(`⤷ login page … `);
    try {
      const r = await capturePage(page, context, START_URL, { slug: 'login', label: 'Login', loginPage: true }, OUT_DIR, actionLog);
      console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB)${blobNote(r)} — captured logged-out` : `skipped (${r.status})`);
      if (r.status === 'ok') loginCaptured = 1; else loginSkipped.push({ slug: 'login', url: START_URL, reason: r.status });
    } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); loginFailed.push({ slug: 'login', url: START_URL, error: e.message.split('\n')[0] }); }
    await context.close(); await browser.close();
    appendCaptureLog(OUT_DIR, { at: new Date().toISOString(), mode: 'login-page', argsSummary: `--login-page --url ${START_URL}`, captured: loginCaptured, skipped: loginSkipped, failed: loginFailed });
    // Refresh the consumption layer only if a prior full capture exists (fresh workspace has none yet;
    // the login page gets folded in when the main capture rebuilds the index).
    if (fs.existsSync(path.join(OUT_DIR, 'ia', 'sitemap.json'))) {
      try { require('./build-index.js').buildIndex(OUT_DIR); console.log('📇  index refreshed'); }
      catch (e) { console.log(`⚠  build-index skipped: ${e.message.split('\n')[0]}`); }
    }
    return;
  }

  // ── Guided capture: headed browser, the DESIGNER drives, snapshot on the overlay button ──
  // Closes the button-only-state / modal gap (tabs with no URL, multi-step wizards) that the
  // URL-based crawl and --state cannot reach. The tool NEVER clicks product controls — a human
  // reaches the state, the overlay button records it (method: guided, with a reached-by note).
  if (GUIDED) {
    const OUT_DIR = path.join(KIT_DIR, 'design-context');
    fs.mkdirSync(path.join(OUT_DIR, 'pages'), { recursive: true });
    if (!START_URL) { console.error('Usage: node capture.js --guided --url <startUrl> [--profile default]'); process.exit(1); }
    // F3: mirror the selective-pull's publicFallback — a product with no profile AND no recorded
    // logged-in signal (or an explicit --logged-out) runs guided ephemerally instead of hard-requiring
    // login.js, exactly like the selective-pull branch already does 140 lines below. Only a product the
    // designer actually MARKED logged-in (CFG.loggedIn === true), with no profile, is a real dead end —
    // that gets its own message, distinct from the profile-LOCKED case below.
    const noProfile = !fs.existsSync(PROFILE_DIR);
    const guidedEphemeral = LOGGED_OUT || (noProfile && CFG.loggedIn !== true);
    if (noProfile && !guidedEphemeral) {
      console.error(`❌ This product is marked as logged-in — run: node tools/login.js --url ${START_URL} (you'll log in yourself; the kit never sees your password)`);
      process.exit(1);
    }
    const QUIT_HINT = process.platform === 'darwin' ? 'press ⌘Q to QUIT the browser (⌘W / closing the window is not enough — Chrome keeps running)' : 'fully quit the browser window (closing it may not end the process)';
    console.log(`\n🚀 Guided capture${guidedEphemeral ? ' (logged-out)' : ''} — ${START_URL}`);
    if (guidedEphemeral && noProfile) console.log(`   ℹ no browser profile — guided capture runs logged-out (fine for public pages).`);
    console.log(`   A browser opens ${guidedEphemeral ? 'in a fresh, signed-out session' : 'on your logged-in session'}. A pill sits at the bottom:`);
    console.log(`   it turns red on a URL never captured, green (with the time) on one already in`);
    console.log(`   the library. Drive to any state and click 📸 Capture.`);
    console.log(`   When you're done, ${QUIT_HINT} — that ends the session, rebuilds the index, and runs the hygiene check.\n`);
    let gctx, gbrowser = null;
    try {
      if (guidedEphemeral) {
        gbrowser = await launchChromium({ headless: false });
        gctx = await gbrowser.newContext({ viewport: null });
      } else {
        gctx = await launchPersistent(PROFILE_DIR, { headless: false, viewport: null, args: ['--window-size=1440,980'] });
      }
    } catch (e) {
      // F3: profile-ABSENT is handled above and never reaches here — this catch is only the profile-
      // LOCKED-by-another-window case (persistent-context launch only), which is why the ⌘Q hint belongs
      // only here, not on the absent-profile message above.
      if (!guidedEphemeral && /existing browser session|already in use/i.test(e.message)) {
        console.error(`❌ The capture profile is open in another window (login.js?). ${process.platform === 'darwin' ? 'Quit it with ⌘Q — ⌘W leaves Chrome running and holding the lock' : 'Close it fully'} and re-run.`);
        process.exit(1);
      }
      throw e;
    }
    const formatWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso || ''; } };
    // Seed the URL-awareness index keyed by ROUTE (tracking stripped), each → the slug already on disk.
    // Keying by route (not by a freshly-derived slug) is what lets guided recognize a page the crawl
    // saved under a tracking-suffixed slug (e.g. account-rewards-94b8ce from ?link=home_rewards) when the
    // designer lands on the clean URL — so it re-captures that page instead of forking a duplicate folder.
    const routeIndex = new Map(); // routeKey → { slug, at }
    { const pdir = path.join(OUT_DIR, 'pages');
      if (fs.existsSync(pdir)) for (const s of fs.readdirSync(pdir)) {
        const mp = path.join(pdir, s, 'meta.json');
        if (fs.existsSync(mp)) { try { const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
          routeIndex.set(routeKey(m.finalUrl || m.url || `/${s}`), { slug: s, at: formatWhen(m.capturedAt) });
        } catch (_) {} }
      } }
    const startedAt = new Date().toISOString();  // session start — persisted at session end (F4)
    const captures = [];
    const guidedIssues = []; // non-ok attempts this session (M1 capture-log), each {slug, url, reason} or {slug, url, error}
    const sessionNames = new Set(); // `${slug}/${name}` captured THIS session — repeats get suffixed, never overwritten
    // URL-awareness: the overlay asks this on every navigation → red (new) vs green (seen, + when).
    await gctx.exposeBinding('__dckStatus', async (source, url) => {
      const existing = routeIndex.get(routeKey(url));
      return { slug: existing ? existing.slug : slugFor(url, url), captured: !!existing, at: existing ? existing.at : null };
    });
    await gctx.exposeBinding('__dckCapture', async (source, payload) => {
      const pageObj = source.page;
      const url = pageObj.url();
      const rk = routeKey(url);
      const existing = routeIndex.get(rk);            // the slug already on disk for this route, if any
      const slug = existing ? existing.slug : slugFor(url, url); // reuse the existing slug → overwrite, don't duplicate
      const isNew = !existing;
      const sname = String(payload.state || '').trim();
      const recapture = !!payload.recapture;          // designer chose to overwrite the existing page
      // New URL → capture as a PAGE. Already-captured URL → either RE-CAPTURE the page (overwrite) or
      // capture a variant as a STATE (needs a name). Overwriting an existing page is opt-in, never silent.
      if (!isNew && !sname && !recapture) return { ok: false, error: 'name the state, or choose “Re-capture page” (this URL is already captured)' };
      const asPage = isNew || recapture;              // writes into pages/<slug>/ (overwrites if it exists)
      let safeName = sname.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'state';
      // Collision guard (states only): a name reused WITHIN this session is a distinct new capture → suffix
      // it so it never silently overwrites (the "5× modal" data-loss bug). A name matching only a PRIOR
      // session's state is left as-is → deliberate re-capture still overwrites.
      if (!asPage && sessionNames.has(`${slug}/${safeName}`)) {
        let i = 2, cand; const statesRoot = path.join(OUT_DIR, 'pages', slug, 'states');
        do { cand = `${safeName}-${i++}`; } while (sessionNames.has(`${slug}/${cand}`) || fs.existsSync(path.join(statesRoot, cand)));
        safeName = cand;
      }
      if (!asPage) sessionNames.add(`${slug}/${safeName}`);
      const label = asPage ? (recapture && !isNew ? `${slug} (re-captured)` : slug) : `${slug} › ${safeName}`;
      const meta = asPage
        ? { slug, label: null, method: 'guided', reachedBy: `guided ${recapture && !isNew ? 're-capture' : 'capture'} — ${url}`, pattern: routePattern(url) }
        : { slug, subdir: path.join(slug, 'states', safeName), label: safeName, method: 'guided', reachedBy: `${new URL(url).pathname} · state: ${safeName}`, pattern: routePattern(url) };
      try {
        // Tell the dashboard a capture is in flight (it shows "Capturing…"); the pill hides itself for the shot.
        console.log('GUIDED_JSON:' + JSON.stringify({ phase: 'capturing', url }));
        const r = await writeSnapshot(pageObj, gctx, url, meta, OUT_DIR);
        // Update the index BEFORE remounting, so the remounted pill's status reflects this capture (green + now).
        if (r.status === 'ok') {
          const at = new Date().toISOString();
          routeIndex.set(rk, { slug, at: formatWhen(at) });   // this route is now captured under `slug` → pill flips green, no re-duplicate
          const rec = { slug, state: sname || null, url, at, ...(recapture && !isNew ? { recapture: true } : {}) };
          captures.push(rec);
          // Stable machine line the server parses into live status + SSE (F5). ONLY under --guided —
          // capture.js is imported as a library elsewhere, so this must never print in other modes.
          console.log('GUIDED_JSON:' + JSON.stringify(rec));
        }
        await pageObj.evaluate(() => { if (window.__dckMount) window.__dckMount(); }).catch(() => {});
        if (r.status !== 'ok') { console.log(`  ✗ ${label}: ${r.status}`); guidedIssues.push({ slug, url, reason: r.status }); return { ok: false, error: r.status }; }
        console.log(`  ✓ ${label}  (${r.sizeKb} KB)${blobNote(r)}`);
        return { ok: true, label, sizeKb: r.sizeKb };
      } catch (e) {
        console.log(`  ✗ ${label}: ${e.message.split('\n')[0]}`);
        guidedIssues.push({ slug, url, error: e.message.split('\n')[0] });
        return { ok: false, error: e.message.split('\n')[0] };
      }
    });
    await gctx.addInitScript(guidedOverlayInjector);
    const gp = gctx.pages()[0] || await gctx.newPage();
    await gp.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    // End the session gracefully on a signal (the dashboard's "End session" sends SIGTERM; Ctrl+C sends
    // SIGINT) — closing the context fires the 'close' below, so persistence + build-index still run. This
    // is what lets the session be ended from the dashboard, not only by quitting the browser window.
    // (ux-busy-states F1) each real checkpoint from here emits a GUIDED_JSON {phase} line — map.js relays
    // it over SSE so the dashboard can show honest stages instead of one frozen "Ending…" message.
    let ending = false;
    let tEnding = null;
    const emitPhase = (phase, extra) => console.log('GUIDED_JSON:' + JSON.stringify({ phase, ...extra }));
    const endSession = () => { if (ending) return; ending = true; tEnding = Date.now(); emitPhase('ending'); gctx.close().catch(() => {}); };
    process.on('SIGTERM', endSession); process.on('SIGINT', endSession);
    await new Promise((resolve) => gctx.on('close', resolve));
    // The window can also be closed by hand, bypassing endSession — tEnding still needs a value so the
    // timing math below can't see a negative/NaN duration.
    if (tEnding === null) { tEnding = Date.now(); emitPhase('ending'); }
    if (gbrowser) await gbrowser.close().catch(() => {});   // F3: the ephemeral (logged-out) path owns a browser process the persistent-context path never has
    const tBrowserClosed = Date.now();
    emitPhase('browser-closed');
    const endedAt = new Date().toISOString();
    console.log(`\n✅  Guided session ended — ${captures.length} state(s) captured.`);
    // ── Session persistence (F4·1, additive + absent-safe) — append this session to guided-sessions.json.
    // The file grows across sessions; build-index derives one ledger event per session (capped) from it.
    if (captures.length) {
      try {
        const gsPath = path.join(OUT_DIR, 'guided-sessions.json');
        let store = { sessions: [] };
        if (fs.existsSync(gsPath)) { try { const prev = JSON.parse(fs.readFileSync(gsPath, 'utf8')); if (prev && Array.isArray(prev.sessions)) store = prev; } catch (_) {} }
        store.sessions.push({ startedAt, endedAt, startUrl: START_URL, captures });
        fs.writeFileSync(gsPath, JSON.stringify(store, null, 2), 'utf8');
        console.log(`🗒  guided-sessions.json updated (${store.sessions.length} session${store.sessions.length === 1 ? '' : 's'})`);
      } catch (e) { console.log(`⚠  could not write guided-sessions.json: ${e.message.split('\n')[0]}`); }
    }
    if (captures.length || guidedIssues.length) {
      appendCaptureLog(OUT_DIR, {
        at: endedAt, mode: 'guided', argsSummary: `--guided --url ${START_URL}`,
        captured: captures.length,
        skipped: guidedIssues.filter(i => i.reason).map(i => ({ slug: i.slug, url: i.url, reason: i.reason })),
        failed: guidedIssues.filter(i => i.error).map(i => ({ slug: i.slug, url: i.url, error: i.error })),
      });
    }
    const tSessionSaved = Date.now();
    emitPhase('session-saved', { captures: captures.length });
    emitPhase('indexing');
    try {
      const { buildIndex } = require('./build-index.js');
      const r = buildIndex(OUT_DIR);
      console.log(`📇  Index + map rebuilt (${r.pages} pages)`);
    } catch (e) { console.log(`⚠  build-index failed: ${e.message.split('\n')[0]}`); }
    const tIndexed = Date.now();
    emitPhase('hygiene');
    try {
      const { runHygiene, formatHygiene } = require('./hygiene.js');
      const findings = runHygiene(OUT_DIR);
      console.log(formatHygiene(findings));
      // Persist a flattened findings list (F4·1) so the ledger can surface a hygiene event. Additive,
      // absent-safe; generatedAt is a stable input (written once here), so build-twice stays deterministic.
      try { fs.writeFileSync(path.join(OUT_DIR, 'hygiene.json'), JSON.stringify({ generatedAt: endedAt, findings: flattenHygiene(findings) }, null, 2), 'utf8'); }
      catch (e) { console.log(`⚠  could not write hygiene.json: ${e.message.split('\n')[0]}`); }
    } catch (e) { console.log(`⚠  hygiene skipped: ${e.message.split('\n')[0]}`); }
    const tHygiened = Date.now();
    const ms = { browser: tBrowserClosed - tEnding, save: tSessionSaved - tBrowserClosed, index: tIndexed - tSessionSaved, hygiene: tHygiened - tIndexed, total: tHygiened - tEnding };
    console.log(`⏱  guided end — browser ${ms.browser}ms · save ${ms.save}ms · index ${ms.index}ms · hygiene ${ms.hygiene}ms · total ${ms.total}ms`);
    emitPhase('ended', { ms });
    return;
  }

  // ── Context: persistent profile (logged-in) OR ephemeral (logged-out) ──
  let browser = null, context;
  const banner = STATE ? `\n🚀 State capture (read-only)\n`
    : ONLY_URLS ? `\n🚀 Selective capture (read-only)\n`
    : `\n🚀 One-click capture${LOGGED_OUT ? ' (logged-out)' : ''} — ${START_URL}  (depth ${DEPTH}, cap ${CAP}, read-only)\n`;
  // First target URL, for messages — START_URL is null in --urls mode, so never interpolate it raw.
  const firstTarget = START_URL || (ONLY_URLS ? ONLY_URLS.split(',')[0].trim() : '<product URL>');
  // A selective pull (--urls/--state) with no profile and no loggedIn signal from product.json is
  // treated as a public pull: capture ephemerally instead of hard-failing. A wrong guess stays loud,
  // never silent — auth-gated pages get skipped as `auth-redirect` and named in the summary.
  const publicFallback = !LOGGED_OUT && (ONLY_URLS || STATE) && CFG.loggedIn !== true && !fs.existsSync(PROFILE_DIR);
  if (LOGGED_OUT || publicFallback) {
    console.log(banner);
    if (publicFallback) {
      console.log(`   ℹ no browser profile — capturing logged-out (fine for public pages).`);
      console.log(`     If these pages need your login: node tools/login.js --url ${firstTarget}  then re-run.`);
    }
    browser = await launchChromium({ headless: HEADLESS });
    context = await browser.newContext({ viewport: VIEWPORT });
  } else {
    if (!fs.existsSync(PROFILE_DIR)) {
      console.error(`\n❌  No browser profile at profiles/${PROFILE} — logged-in capture needs one.\n   Run first: node tools/login.js --url ${firstTarget}\n   Capturing a public site? Re-run with --logged-out — no profile needed.\n`);
      process.exit(1);
    }
    console.log(banner);
    try {
      context = await launchPersistent(PROFILE_DIR, { headless: HEADLESS, viewport: VIEWPORT });
    } catch (e) {
      if (/existing browser session|already in use/i.test(e.message)) {
        console.error(`\n❌  The capture browser profile is still open in another window`);
        console.error(`   (usually the login window from login.js). Close that browser window`);
        console.error(`   and re-run this capture — your login is already saved.\n`);
        process.exit(1);
      }
      throw e;
    }
  }
  // (busy-states-everywhere B2) the progress pill — crawl/--urls/--state were silent windows before
  // this; guided already had one. `progressState` is the one thing Node updates as it works through
  // each mode's loop below; the pill (injected fresh into every new document, same mechanism as
  // guided's overlay) asks for it on mount and polls lightly while the document stays open. A missing
  // pill can never fail a capture, so both calls are best-effort.
  let progressState = null;
  try {
    await context.exposeBinding('__dckProgress', async () => progressState);
    await context.addInitScript(progressPillInjector);
  } catch (_) {}
  const page = context.pages()[0] || await context.newPage();
  const actionLog = [];

  // ── Selective modes (driven by the map or the agent): no nav discovery ──────
  if (STATE || ONLY_URLS) {
    const OUT_DIR = path.join(KIT_DIR, 'design-context');
    fs.mkdirSync(path.join(OUT_DIR, 'pages'), { recursive: true });
    const runResults = { ok: [], skipped: [], failed: [] }; // M1 capture-log — this branch has no existing tracker
    if (STATE) {
      const [pslug, sname] = STATE.split(':').map(s => (s || '').trim());
      if (!pslug || !sname || !START_URL) { console.error('Usage: node capture.js --state <pageSlug>:<stateName> --url <stateUrl>'); process.exit(1); }
      process.stdout.write(`⤷ state ${pslug} › ${sname} … `);
      progressState = { index: 1, total: 1, label: `${pslug} › ${sname}` };
      try {
        const r = await capturePage(page, context, START_URL,
          { slug: pslug, subdir: path.join(pslug, 'states', sname.replace(/[^A-Za-z0-9-]+/g, '-')), label: sname }, OUT_DIR, actionLog);
        console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB)${blobNote(r)}` : `skipped (${r.status})`);
        if (r.status === 'ok') runResults.ok.push(pslug); else runResults.skipped.push({ slug: pslug, url: START_URL, reason: r.status });
      } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); runResults.failed.push({ slug: pslug, url: START_URL, error: e.message.split('\n')[0] }); }
    } else {
      const urls = ONLY_URLS.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`🎯 Selective capture — ${urls.length} url(s) from the frontier`);
      // "Already captured?" is answered by ROUTE, exactly as guided answers it (the routeIndex pattern) —
      // not by a disk listing of slug names. A listing can only ever say "that folder name is taken", so
      // re-supplying an already-captured URL forked <slug>-2 forever, breaking the kit's own promise that
      // re-running refreshes the library in place. Now: same route → overwrite THAT page's folder (keeping
      // its nav label / template facts, which --urls can't rediscover); genuinely new route → new folder,
      // with the -2 suffix kept only for a true slug collision between two DIFFERENT routes.
      const pagesDir = path.join(OUT_DIR, 'pages');
      const routeIndex = new Map();   // routeKey → { slug, meta }
      const takenSlugs = new Set();
      if (fs.existsSync(pagesDir)) {
        const dirs = fs.readdirSync(pagesDir).filter(s => { try { return fs.statSync(path.join(pagesDir, s)).isDirectory(); } catch { return false; } });
        for (const s of dirs) takenSlugs.add(s);
        // Two passes so finalUrl always wins over the requested url it redirected from (a page is identified
        // by where it landed; the requested URL is only an alias for reaching it).
        for (const field of ['url', 'finalUrl']) for (const s of dirs) {
          const mp = path.join(pagesDir, s, 'meta.json');
          if (!fs.existsSync(mp)) continue;
          try { const m = JSON.parse(fs.readFileSync(mp, 'utf8')); if (m[field]) routeIndex.set(routeKey(m[field]), { slug: s, meta: m }); } catch (_) {}
        }
      }
      for (let ui = 0; ui < urls.length; ui++) {
        const u = urls[ui];
        const rk = routeKey(u);
        const existing = routeIndex.get(rk);
        let slug;
        if (existing) slug = existing.slug;                     // refresh in place
        else { slug = slugFor(u, u); while (takenSlugs.has(slug)) slug += '-2'; }
        takenSlugs.add(slug);
        const prev = existing ? existing.meta : {};
        process.stdout.write(`  ${slug}${existing ? ' (refresh)' : ''} … `);
        progressState = { index: ui + 1, total: urls.length, label: slug };
        try {
          const r = await capturePage(page, context, u, {
            slug, label: prev.navLabel || null,                 // preserve the facts a URL alone can't carry
            pattern: prev.pattern || routePattern(u),
            template: prev.template || null, collapsed: prev.collapsed || 0,
          }, OUT_DIR, actionLog);
          console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB)${blobNote(r)}` : `skipped (${r.status})`);
          if (r.status === 'ok') { routeIndex.set(routeKey(r.finalUrl || u), { slug, meta: r.meta }); runResults.ok.push(slug); }
          else runResults.skipped.push({ slug, url: u, reason: r.status });
        } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); runResults.failed.push({ slug, url: u, error: e.message.split('\n')[0] }); }
      }
    }
    await context.close(); if (browser) await browser.close();
    appendCaptureLog(OUT_DIR, {
      at: new Date().toISOString(), mode: STATE ? 'state' : 'urls',
      argsSummary: STATE ? `--state ${STATE} --url ${START_URL}` : `--urls ${ONLY_URLS}`,
      // (covered-shapes) the pulled URLs as data, not just display text: build-index's derivePulledUrls
      // reads this to know a page was downloaded AS the one example of a frontier shape, which is what
      // lets that shape's ghost retire in favour of "stands for N" on the page. It falls back to parsing
      // argsSummary for logs written before this field existed, so both shapes stay readable.
      ...(STATE ? {} : { urls: String(ONLY_URLS || '').split(',').map(u => u.trim()).filter(Boolean) }),
      captured: runResults.ok.length, skipped: runResults.skipped, failed: runResults.failed,
    });
    try {
      const { buildIndex } = require('./build-index.js');
      const r = buildIndex(OUT_DIR);
      const pending = r.pages - r.described;
      console.log(`📇  Index + map rebuilt (${r.pages} pages — ${r.described} described, ${pending} pending)`);
      if (ONLY_URLS && pending) console.log(`⚠  ${pending} page(s) have no "What this page is" yet — run the describe step (skills/capture-product §5) so they aren't blank in INDEX.md`);
    } catch (e) { console.log(`⚠  build-index failed: ${e.message.split('\n')[0]}`); }
    return;
  }

  // Landing: navigate, settle, resolve the REAL origin (TLD/country redirects)
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  await dismissBanner(page, actionLog);
  const landingUrl = page.url();
  const origin = new URL(landingUrl).origin;
  if (origin !== new URL(START_URL).origin) console.log(`   ↪ redirected — capturing against ${origin}`);
  // Logged-in mode: landing on a login page means the saved session expired — bail with guidance.
  // Logged-out mode captures whatever greets a signed-out visitor, so don't bail there.
  if (!LOGGED_OUT && /\/(login|signin|sign-in|auth)\b/i.test(new URL(landingUrl).pathname)) {
    console.error(`\n❌  Landed on a login page — the saved session has expired.\n   Run: node tools/login.js --url ${START_URL}  (log in, close the window), then re-run capture.\n`);
    await context.close(); if (browser) await browser.close(); process.exit(1);
  }

  const PRODUCT = getArg('--product', stripWww(new URL(origin).hostname).split('.')[0]);
  // One workspace = one product: the library lives at <workspace>/design-context/
  const OUT_DIR = path.join(KIT_DIR, 'design-context');
  fs.mkdirSync(path.join(OUT_DIR, 'ia'), { recursive: true });

  // 1. Nav discovery
  const { candidates, source: navSource } = await discoverNav(page, origin);
  console.log(`🧭 Nav discovery (${navSource}): ${candidates.length} candidate pages`);

  // Portal detection: 0 in-origin candidates but siblings on the same registrable
  // domain (e.g. www.wikipedia.org → en.wikipedia.org). Don't guess — tell the designer.
  if (candidates.length === 0) {
    const regDomain = (h) => h.split('.').slice(-2).join('.');
    const siblings = await page.evaluate(() =>
      [...new Set(Array.from(document.querySelectorAll('a[href^="http"]')).map(a => { try { return new URL(a.href).hostname; } catch { return null; } }))]);
    const sameFamily = [...new Set(siblings.filter(h => h && regDomain(h) === regDomain(new URL(origin).hostname) && stripWww(h) !== stripWww(new URL(origin).hostname)))];
    if (sameFamily.length) {
      console.log(`   ⚠ this looks like a PORTAL page — its links live on sibling subdomains, which one-click`);
      console.log(`     treats as separate products. Re-run against the subdomain your product lives on, e.g.:`);
      sameFamily.slice(0, 3).forEach(h => console.log(`       node tools/capture.js --url https://${h}`));
    }
  }

  // 2. Templatize the candidate list (same route pattern → one representative)
  const groups = new Map(); // pattern -> [candidates]
  const landingCand = { url: normalizeUrl(landingUrl, origin), label: 'Landing' };
  for (const c of [landingCand, ...candidates]) {
    if (!c.url) continue;
    const pat = routePattern(c.url);
    if (!groups.has(pat)) groups.set(pat, []);
    groups.get(pat).push(c);
  }
  let queue = [];
  for (const [pattern, members] of groups) {
    const rep = { ...members[0], pattern, template: members.length > 1 ? pattern : null, collapsed: members.length - 1 };
    queue.push(rep);
    if (members.length > 1) console.log(`   ⧉ template ${pattern}: capturing 1 of ${members.length} (collapsed ${members.length - 1})`);
  }
  let capped = 0, overCapNav = [];
  if (queue.length > CAP) {
    capped = queue.length - CAP;
    overCapNav = queue.slice(CAP).map(c => ({ url: c.url, label: c.label || null, pattern: c.pattern || routePattern(c.url) }));
    queue = queue.slice(0, CAP);
    console.log(`   ⚠ cap ${CAP} hit — ${capped} candidates not captured (kept on the frontier)`);
  }

  // 3. Capture loop
  const results = { ok: [], skipped: [], failed: [] };
  const seenSlugs = new Set();
  const navEntries = [];
  for (let i = 0; i < queue.length; i++) {
    const cand = queue[i];
    let slug = slugFor(cand.url, origin);
    while (seenSlugs.has(slug)) slug += '-2';
    seenSlugs.add(slug);
    process.stdout.write(`[${String(i + 1).padStart(2, '0')}/${queue.length}] ${slug} … `);
    progressState = { index: i + 1, total: queue.length, label: slug };
    try {
      const r = await capturePage(page, context, cand.url, { ...cand, slug }, OUT_DIR, actionLog);
      if (r.status === 'ok') {
        console.log(`✓ (${r.sizeKb} KB)${blobNote(r)}`);
        results.ok.push(slug);
        navEntries.push({ label: cand.label, url: cand.url, route: r.meta.route, pattern: r.meta.pattern,
          slug, template: cand.template, collapsed: cand.collapsed || 0 });
      } else { console.log(`skipped (${r.status})`); results.skipped.push({ slug, reason: r.status }); }
    } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); results.failed.push({ slug, error: e.message.split('\n')[0] }); }
  }

  // 4. Depth 2 — one representative per on-page template group (≥3 same-pattern links)
  if (DEPTH >= 2 && results.ok.length) {
    console.log(`\n🔎 Depth 2 — representative detail pages from template groups`);
    const alreadyPatterns = new Set(navEntries.map(n => n.pattern));
    const capturedUrls = new Set(navEntries.map(n => n.url));
    const detailGroups = new Map();
    const slugGroups = new Map(); // no-digit templates: same prefix, varying last segment (/wiki/:slug)
    for (const slug of results.ok) {
      const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'pages', slug, 'meta.json'), 'utf8'));
      for (const link of meta.linksOut) {
        if (capturedUrls.has(link)) continue;
        const pat = routePattern(link);
        if (alreadyPatterns.has(pat)) continue;
        if (pat.includes(':id')) {
          if (!detailGroups.has(pat)) detailGroups.set(pat, { urls: new Set(), from: slug });
          detailGroups.get(pat).urls.add(link);
        } else {
          try {
            const segs = new URL(link).pathname.split('/').filter(Boolean);
            if (segs.length < 2) continue; // need a non-root shared prefix
            const sp = '/' + segs.slice(0, -1).join('/') + '/:slug';
            if (alreadyPatterns.has(sp)) continue;
            if (!slugGroups.has(sp)) slugGroups.set(sp, { urls: new Set(), from: slug });
            slugGroups.get(sp).urls.add(link);
          } catch (_) {}
        }
      }
    }
    // slug templates are weaker evidence than :id — require 5+ siblings before collapsing.
    // Add them BEFORE the merge pass so /wiki/:slug can fold into /wiki/:id.
    for (const [sp, g] of slugGroups) if (g.urls.size >= 5) detailGroups.set(sp, g);
    mergeTemplateGroups(detailGroups); // fold name-slug variants of one template together
    // biggest groups first: when the cap cuts depth-2 short, it must trim the tail, not the headline template
    const orderedGroups = [...detailGroups.entries()].sort((a, b) => b[1].urls.size - a[1].urls.size);
    for (const [pattern, g] of orderedGroups) {
      if (g.urls.size < 3) continue; // template = 3+ same-shape links
      if (results.ok.length >= CAP) { console.log(`   ⚠ cap ${CAP} hit — stopping depth-2`); break; }
      const rep = [...g.urls][0];
      let slug = slugFor(rep, origin);
      while (seenSlugs.has(slug)) slug += '-2';
      seenSlugs.add(slug);
      process.stdout.write(`   ⧉ ${pattern} (${g.urls.size} instances, via ${g.from}) → ${slug} … `);
      // No total here (unlike the phase-1 loop above): depth-2 groups are discovered as it goes, so any
      // denominator shown before the pass finishes would be a guess — the pill just names the page.
      progressState = { index: null, total: null, label: slug };
      try {
        const r = await capturePage(page, context, rep, { url: rep, label: null, pattern, slug, template: pattern, collapsed: g.urls.size - 1 }, OUT_DIR, actionLog);
        if (r.status === 'ok') {
          console.log(`✓ (${r.sizeKb} KB, collapsed ${g.urls.size - 1})${blobNote(r)}`);
          results.ok.push(slug);
          navEntries.push({ label: null, url: rep, route: r.meta.route, pattern, slug, template: pattern, collapsed: g.urls.size - 1 });
        } else { console.log(`skipped (${r.status})`); results.skipped.push({ slug, reason: r.status }); }
      } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); results.failed.push({ slug, error: e.message.split('\n')[0] }); }
    }
  }

  await context.close(); if (browser) await browser.close();

  // 5. Assemble sitemap + manifest
  const sitemap = {
    product: PRODUCT, origin, capturedAt: new Date().toISOString(),
    source: 'scrape', method: 'dom', navSource,
    note: 'Nav order = the product’s own navigation. template != null means N same-shape pages collapsed to this representative.',
    pages: navEntries,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'ia', 'sitemap.json'), JSON.stringify(sitemap, null, 2), 'utf8');

  const manifest = {
    kit: 'design-context-kit v0.1', product: PRODUCT, startUrl: START_URL, resolvedOrigin: origin,
    capturedAt: new Date().toISOString(), depth: DEPTH, cap: CAP, capped, headless: HEADLESS,
    counts: { captured: results.ok.length, skipped: results.skipped.length, failed: results.failed.length },
    pages: results.ok, skipped: results.skipped, failed: results.failed,
    actions: actionLog,
    frontierHints: { overCapNav }, // discovered-but-not-captured nav candidates (rest of the frontier is reconstructed from linksOut)
    provenance: { source: 'scrape', method: 'dom', determinism: 'no OCR, no vision, no model-derived values' },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  appendCaptureLog(OUT_DIR, {
    at: manifest.capturedAt, mode: 'crawl',
    argsSummary: `--url ${START_URL} --depth ${DEPTH} --cap ${CAP}${HEADLESS ? ' --headless' : ''}`,
    captured: results.ok.length, skipped: results.skipped, failed: results.failed,
    capHit: capped > 0,
  });

  // 6. Consumption layer: registry.json + INDEX.md + per-page page.md (preserves AI descriptions on re-runs)
  try {
    const { buildIndex } = require('./build-index.js');
    const r = buildIndex(OUT_DIR);
    console.log(`📇  Consumption layer: INDEX.md + registry.json + ${r.pages} page.md (${r.pages - r.described} descriptions pending — the describe step fills them)`);
  } catch (e) { console.log(`⚠  build-index failed: ${e.message.split('\n')[0]} — run tools/build-index.js manually`); }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`✅  Captured: ${results.ok.length} pages → design-context/`);
  if (results.skipped.length) console.log(`⏭️  Skipped: ${results.skipped.map(s => `${s.slug} (${s.reason})`).join(', ')}`);
  if (results.failed.length) console.log(`❌  Failed: ${results.failed.map(f => f.slug).join(', ')}`);
  // D2: a block that's specific to headless Chromium (a site-side bot check, not a broken kit or a
  // down site) looks identical to any other failure unless the run says so. Message only — no
  // user-agent games, no evasion: a block is the site's answer and the kit respects it either way.
  const blockedCount = results.skipped.filter(s => s.reason === 'blocked').length;
  const attempted = results.ok.length + results.skipped.length + results.failed.length;
  if (HEADLESS && attempted > 0 && (results.ok.length === 0 || blockedCount > attempted / 2)) {
    console.log(`⚠  Blocked pages + --headless often means the site rejects headless browsers — retry without --headless (a browser window will open).`);
  }
  if (capped) console.log(`⚠  ${capped} candidates beyond the cap — raise --cap to include them`);
  console.log(`🧭  Sitemap: design-context/ia/sitemap.json`);
  console.log(`\nOpen design-context/INDEX.md for the map — any pages/<slug>/page.html is your editable design baseline.\n`);
})();
