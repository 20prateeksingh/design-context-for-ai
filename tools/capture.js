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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function slugFor(url, origin) {
  try {
    const u = new URL(url);
    let s = u.pathname === '/' ? 'home' : u.pathname.split('/').filter(Boolean).join('-');
    s = s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if (u.search) s += '-' + crypto.createHash('sha1').update(u.search).digest('hex').slice(0, 6);
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
// Privacy-preserving options first; exact-ish short-text match only.
const DISMISS_TEXTS = [
  'reject all', 'decline all', 'only essential', 'essential only', 'reject non-essential',
  'necessary only', 'decline', 'reject',
  'accept all', 'allow all', 'accept cookies', 'i agree', 'agree', 'accept', 'ok', 'got it', 'ok, got it', 'dismiss', 'understood', 'close',
];
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
      // aria-label first (clean, singular); innerText concatenates hover/badge dupes ("Homes Homes")
      let label = (a.getAttribute('aria-label') || a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
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

async function inlineImages(page, context) {
  const srcs = await page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll('img')).map(i => i.src))]);
  for (const src of srcs) {
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    try {
      const resp = await context.request.get(src);
      if (!resp.ok()) continue;
      const buf = await resp.body();
      if (buf.length > 400 * 1024) continue; // keep huge media remote
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
  await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true }).catch(async () => {
    await page.screenshot({ path: path.join(dir, 'screenshot.png') }); // fullPage can fail on huge pages
  });
  await page.evaluate(() => document.querySelectorAll('[id^="__dck"]').forEach(e => { e.style.visibility = e.dataset.dckVis || ''; delete e.dataset.dckVis; })).catch(() => {});

  // 2. verbatim copy + computed tokens + outbound links (read-only DOM passes)
  const [content, tokens, linksOut, title] = [
    await extractContent(page),
    await tallyComputedTokens(page),
    await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.href))]),
    await page.title(),
  ];

  // 3. self-contained editable snapshot
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
    capturedAt: new Date().toISOString(), viewport: VIEWPORT,
    source: 'scrape', method, contentHash: contentHash(html),
    // method: 'guided' — reached by a human interaction (click/wizard), not URL navigation.
    // reachedBy records HOW, so a state with no inbound link is explained, not mysterious.
    ...(meta.reachedBy ? { reachedBy: meta.reachedBy } : {}),
    ...(meta.loginPage ? { capturedLoggedOut: true, note: 'signed-out surface captured before login existed' } : {}),
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(metaOut, null, 2), 'utf8');
  return { status: 'ok', slug, meta: metaOut, sizeKb: Math.round(html.length / 1024) };
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

// Flatten hygiene.js's grouped findings into a plain list for persistence (F4·1). Mirrors the section
// renders in hygiene.formatHygiene so the ledger's detail lines read the same, action included.
function flattenHygiene(f) {
  if (!f || f.error) return [];
  const out = [];
  const push = (it, text) => out.push({ severity: it.severity || 'warn', text, action: it.action || '' });
  for (const it of f.duplicates || []) push(it, `${(it.pages || []).join(', ')} — ${it.issue}`);
  for (const it of f.orphans || []) push(it, `${it.page} (${it.route}) — ${it.issue}`);
  for (const it of f.identicalStates || []) push(it, `${it.page} › ${it.state} — ${it.issue}`);
  for (const it of f.quality || []) push(it, `${it.target} — ${it.issue}`);
  return out;
}

// Exported for tests/reuse. Requiring this file no longer auto-runs the CLI (guarded below).
module.exports = { writeSnapshot, capturePage, guidedOverlayInjector, routePattern, slugFor, flattenHygiene };

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
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const actionLog = [];
    process.stdout.write(`⤷ login page … `);
    try {
      const r = await capturePage(page, context, START_URL, { slug: 'login', label: 'Login', loginPage: true }, OUT_DIR, actionLog);
      console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB) — captured logged-out` : `skipped (${r.status})`);
    } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); }
    await context.close(); await browser.close();
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
    if (!fs.existsSync(PROFILE_DIR)) {
      console.error(`\n❌  Guided capture needs your logged-in profile.\n   Run first: node tools/login.js --url ${START_URL}\n`);
      process.exit(1);
    }
    const QUIT_HINT = process.platform === 'darwin' ? 'press ⌘Q to QUIT the browser (⌘W / closing the window is not enough — Chrome keeps running)' : 'fully quit the browser window (closing it may not end the process)';
    console.log(`\n🚀 Guided capture — ${START_URL}`);
    console.log(`   A browser opens on your logged-in session. A pill sits at the bottom:`);
    console.log(`   it turns red on a URL never captured, green (with the time) on one already in`);
    console.log(`   the library. Drive to any state and click 📸 Capture.`);
    console.log(`   When you're done, ${QUIT_HINT} — that ends the session, rebuilds the index, and runs the hygiene check.\n`);
    let gctx;
    try {
      gctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null, args: ['--window-size=1440,980'] });
    } catch (e) {
      if (/existing browser session|already in use/i.test(e.message)) {
        console.error(`\n❌  The capture profile is open in another window (login.js?). Close it and re-run.\n`);
        process.exit(1);
      }
      throw e;
    }
    const formatWhen = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso || ''; } };
    // Seed the URL-awareness index from what's already captured (slug → when).
    const capturedIndex = new Map();
    { const pdir = path.join(OUT_DIR, 'pages');
      if (fs.existsSync(pdir)) for (const s of fs.readdirSync(pdir)) {
        const mp = path.join(pdir, s, 'meta.json');
        if (fs.existsSync(mp)) { try { capturedIndex.set(s, formatWhen(JSON.parse(fs.readFileSync(mp, 'utf8')).capturedAt)); } catch (_) {} }
      } }
    const startedAt = new Date().toISOString();  // session start — persisted at session end (F4)
    const captures = [];
    const sessionNames = new Set(); // `${slug}/${name}` captured THIS session — repeats get suffixed, never overwritten
    // URL-awareness: the overlay asks this on every navigation → red (new) vs green (seen, + when).
    await gctx.exposeBinding('__dckStatus', async (source, url) => {
      const slug = slugFor(url, url);
      return { slug, captured: capturedIndex.has(slug), at: capturedIndex.get(slug) || null };
    });
    await gctx.exposeBinding('__dckCapture', async (source, payload) => {
      const pageObj = source.page;
      const url = pageObj.url();
      const slug = slugFor(url, url);                 // page slug auto-derived from the URL (no field to fill)
      const isNew = !capturedIndex.has(slug);
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
          capturedIndex.set(slug, formatWhen(at));
          const rec = { slug, state: sname || null, url, at, ...(recapture && !isNew ? { recapture: true } : {}) };
          captures.push(rec);
          // Stable machine line the server parses into live status + SSE (F5). ONLY under --guided —
          // capture.js is imported as a library elsewhere, so this must never print in other modes.
          console.log('GUIDED_JSON:' + JSON.stringify(rec));
        }
        await pageObj.evaluate(() => { if (window.__dckMount) window.__dckMount(); }).catch(() => {});
        if (r.status !== 'ok') { console.log(`  ✗ ${label}: ${r.status}`); return { ok: false, error: r.status }; }
        console.log(`  ✓ ${label}  (${r.sizeKb} KB)`);
        return { ok: true, label, sizeKb: r.sizeKb };
      } catch (e) {
        console.log(`  ✗ ${label}: ${e.message.split('\n')[0]}`);
        return { ok: false, error: e.message.split('\n')[0] };
      }
    });
    await gctx.addInitScript(guidedOverlayInjector);
    const gp = gctx.pages()[0] || await gctx.newPage();
    await gp.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    // End the session gracefully on a signal (the dashboard's "End session" sends SIGTERM; Ctrl+C sends
    // SIGINT) — closing the context fires the 'close' below, so persistence + build-index still run. This
    // is what lets the session be ended from the dashboard, not only by quitting the browser window.
    let ending = false;
    const endSession = () => { if (ending) return; ending = true; gctx.close().catch(() => {}); };
    process.on('SIGTERM', endSession); process.on('SIGINT', endSession);
    await new Promise((resolve) => gctx.on('close', resolve));
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
    try {
      const { buildIndex } = require('./build-index.js');
      const r = buildIndex(OUT_DIR);
      console.log(`📇  Index + map rebuilt (${r.pages} pages)`);
    } catch (e) { console.log(`⚠  build-index failed: ${e.message.split('\n')[0]}`); }
    try {
      const { runHygiene, formatHygiene } = require('./hygiene.js');
      const findings = runHygiene(OUT_DIR);
      console.log(formatHygiene(findings));
      // Persist a flattened findings list (F4·1) so the ledger can surface a hygiene event. Additive,
      // absent-safe; generatedAt is a stable input (written once here), so build-twice stays deterministic.
      try { fs.writeFileSync(path.join(OUT_DIR, 'hygiene.json'), JSON.stringify({ generatedAt: endedAt, findings: flattenHygiene(findings) }, null, 2), 'utf8'); }
      catch (e) { console.log(`⚠  could not write hygiene.json: ${e.message.split('\n')[0]}`); }
    } catch (e) { console.log(`⚠  hygiene skipped: ${e.message.split('\n')[0]}`); }
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
    browser = await chromium.launch({ headless: HEADLESS });
    context = await browser.newContext({ viewport: VIEWPORT });
  } else {
    if (!fs.existsSync(PROFILE_DIR)) {
      console.error(`\n❌  No browser profile at profiles/${PROFILE} — logged-in capture needs one.\n   Run first: node tools/login.js --url ${firstTarget}\n   Capturing a public site? Re-run with --logged-out — no profile needed.\n`);
      process.exit(1);
    }
    console.log(banner);
    try {
      context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: HEADLESS, viewport: VIEWPORT });
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
  const page = context.pages()[0] || await context.newPage();
  const actionLog = [];

  // ── Selective modes (driven by the map or the agent): no nav discovery ──────
  if (STATE || ONLY_URLS) {
    const OUT_DIR = path.join(KIT_DIR, 'design-context');
    fs.mkdirSync(path.join(OUT_DIR, 'pages'), { recursive: true });
    if (STATE) {
      const [pslug, sname] = STATE.split(':').map(s => (s || '').trim());
      if (!pslug || !sname || !START_URL) { console.error('Usage: node capture.js --state <pageSlug>:<stateName> --url <stateUrl>'); process.exit(1); }
      process.stdout.write(`⤷ state ${pslug} › ${sname} … `);
      try {
        const r = await capturePage(page, context, START_URL,
          { slug: pslug, subdir: path.join(pslug, 'states', sname.replace(/[^A-Za-z0-9-]+/g, '-')), label: sname }, OUT_DIR, actionLog);
        console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB)` : `skipped (${r.status})`);
      } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); }
    } else {
      const urls = ONLY_URLS.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`🎯 Selective capture — ${urls.length} url(s) from the frontier`);
      const seen = new Set(fs.existsSync(path.join(OUT_DIR, 'pages')) ? fs.readdirSync(path.join(OUT_DIR, 'pages')) : []);
      for (const u of urls) {
        let slug = slugFor(u, u);
        while (seen.has(slug)) slug += '-2';
        seen.add(slug);
        process.stdout.write(`  ${slug} … `);
        try {
          const r = await capturePage(page, context, u, { slug, label: null, pattern: routePattern(u) }, OUT_DIR, actionLog);
          console.log(r.status === 'ok' ? `✓ (${r.sizeKb} KB)` : `skipped (${r.status})`);
        } catch (e) { console.log(`✗ ${e.message.split('\n')[0]}`); }
      }
    }
    await context.close(); if (browser) await browser.close();
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
    try {
      const r = await capturePage(page, context, cand.url, { ...cand, slug }, OUT_DIR, actionLog);
      if (r.status === 'ok') {
        console.log(`✓ (${r.sizeKb} KB)`);
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
      try {
        const r = await capturePage(page, context, rep, { url: rep, label: null, pattern, slug, template: pattern, collapsed: g.urls.size - 1 }, OUT_DIR, actionLog);
        if (r.status === 'ok') {
          console.log(`✓ (${r.sizeKb} KB, collapsed ${g.urls.size - 1})`);
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
    capturedAt: new Date().toISOString(), depth: DEPTH, cap: CAP, capped,
    counts: { captured: results.ok.length, skipped: results.skipped.length, failed: results.failed.length },
    pages: results.ok, skipped: results.skipped, failed: results.failed,
    actions: actionLog,
    frontierHints: { overCapNav }, // discovered-but-not-captured nav candidates (rest of the frontier is reconstructed from linksOut)
    provenance: { source: 'scrape', method: 'dom', determinism: 'no OCR, no vision, no model-derived values' },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

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
  if (capped) console.log(`⚠  ${capped} candidates beyond the cap — raise --cap to include them`);
  console.log(`🧭  Sitemap: design-context/ia/sitemap.json`);
  console.log(`\nOpen design-context/INDEX.md for the map — any pages/<slug>/page.html is your editable design baseline.\n`);
})();
