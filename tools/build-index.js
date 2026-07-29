#!/usr/bin/env node
/**
 * build-index.js — the consumption layer over a captured library.
 *
 * Generates, deterministically, from files capture.js already wrote:
 *   • registry.json      — machine front door for AI agents: every page keyed by slug,
 *                          with route, label, files, link graph (linksTo / linkedFrom),
 *                          template info, and the (labeled) AI description if present.
 *   • INDEX.md           — human front door: nav-ordered table of every page with its
 *                          one-line description and links to screenshot / HTML / page.md.
 *   • pages/<slug>/page.md — per-page digest: facts (route, template, headings, link
 *                          graph) + a marked "What this page is" section that the
 *                          describe step (AI, labeled) fills in.
 *
 * Idempotent: re-running regenerates all derived files but PRESERVES the AI-written
 * description between the ai:begin / ai:end markers in each page.md.
 * Ground truth (meta.json, content.md, page.html, screenshots) is never modified.
 *
 * Usage: node build-index.js   (rebuilds <workspace>/design-context/; pass an explicit path to override)
 */

const fs = require('fs');
const path = require('path');
const { domainToUnicode } = require('url');

const AI_BEGIN = '<!-- ai:begin method=ai — written by the describe step, NOT ground truth -->';
const AI_END = '<!-- ai:end -->';
const PENDING = '_(not yet described — run the describe step)_';

// F6/E6: bump whenever CLAUDE.md/AGENTS.md's INSTRUCTIONAL content changes (not every kit release —
// only when a workspace running an older copy would actually miss something). Stamped as the last line
// of each file; a workspace copy running behind this gets a one-line, info-level hygiene warning rather
// than drifting silently (F6: a 7-day-old workspace had no design-new instruction at all, undetected).
const KIT_SURFACES_VERSION = 1;

// journal actor canon — CLOSED set. The dashboard's journal filter chips (All/You/The kit/Your AI)
// assume every event's actor is exactly one of these three, so each entry matches exactly one filter.
// Any unrecognized actor string (future event kind, typo) coerces to the nearest canonical one instead
// of leaking a 4th value into the UI.
const ACTORS = ['you', 'the kit', 'your AI'];
function canonicalActor(a) {
  if (ACTORS.includes(a)) return a;
  const s = String(a || '').toLowerCase();
  if (s.includes('kit')) return 'the kit';
  if (s.includes('ai')) return 'your AI';
  return 'you';
}

function normalize(u) { try { const x = new URL(u); x.hash = ''; let s = x.href; if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1); return s; } catch { return u; } }

// routeKey — canonical per-page identity: host + path with analytics/nav-source params stripped. MIRRORS
// capture.js's routeKey (kept in sync by hand; both are tiny pure functions — the guard that they still
// agree is `node tools/test-routekey.js`). Lets the link graph resolve a nav link that carries a tracking
// param (e.g. /account/rewards?link=home_rewards) to the page captured under the clean route — so tracked
// links don't leave real pages looking unlinked. The host is part of the key (www. stripped, so
// www.flipkart.com ≡ flipkart.com) — two same-path pages on different hosts are different pages.
const TRACKING_PARAM = /^(link|otracker\d*|utm_[a-z]+|gclid|gclsrc|fbclid|dclid|msclkid|mc_eid|mc_cid|igshid|_ga|cmpid|spm|ref_)$/i;
function routeKey(u) {
  try {
    const x = new URL(u); let sp; try { sp = new URLSearchParams(x.search); } catch { sp = new URLSearchParams(); }
    for (const k of [...sp.keys()]) if (TRACKING_PARAM.test(k)) sp.delete(k);
    const kept = [...sp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let p = x.pathname; if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
    return x.host.toLowerCase().replace(/^www\./, '') + p + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
  } catch { return u || '/'; }
}

// A template representative page has no nav label and would otherwise inherit ONE collapsed
// instance's <title> or route as its identity (e.g. "XFlow" / "/connected-users/account_F0A_…").
// Derive a clean human name from the pattern instead: /connected-users/:id → "Connected User Details".
// Returns null for non-template pages so their existing label fallback is untouched.
function templateLabel(m) {
  if (!m || !m.template || !m.pattern) return null;
  // (covered-shapes) A DERIVED claim — a real page that now stands for a merge-derived frontier shape —
  // keeps its OWN name. The tail of such a pattern is a wildcard's neighbour, not a name: `/wiki/:var`
  // renders as "Wiki Details", which would relabel Wikipedia:General disclaimer into anonymity. The map
  // leans on that node to carry the shape's count now, so it has to stay recognisable.
  if (m.templateDerived) return null;
  const segs = m.pattern.split('/').filter(s => s && !/^[:[]/.test(s)); // drop dynamic segments (:id, [id])
  const last = segs[segs.length - 1];
  if (!last) return null;
  const words = last.split(/[-_]/).filter(Boolean);
  if (!words.length) return null;
  words[words.length - 1] = words[words.length - 1].replace(/s$/, ''); // singularize the final word only
  const titled = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (!titled) return null;
  // E15: a pattern whose last segment IS already "order-details" singularizes to "Order Detail" above,
  // and unconditionally appending " Details" produced "Order Detail Details". Pluralize the existing
  // word back instead of stacking a second one.
  return /\bDetail$/i.test(titled) ? titled.replace(/Detail$/i, 'Details') : `${titled} Details`;
}

// D5: root-caused the "On this page" truncation — content.md always begins with ITS OWN generated
// "# {title}" line (capture.js writes it as line 1, before the real DOM extraction starts), which is
// itself a `#`-heading match. The old code matched every `#`-line first, THEN sliced off exactly one
// entry (`.slice(1, 1 + 8)`) to account for that — but content.md's real DOM extraction usually starts
// with the page's OWN <h1>, a second title-like match, so the slice's implicit "skip 1" assumption was
// already wrong by one, AND the hardcoded max=8 silently dropped anything past the 8th real heading —
// confirmed truncating 3 separate MDN pages at exactly that count. Fix: drop content.md's generated
// title by POSITION (it is always line 1, deterministic by construction) rather than by counting
// matches, and keep every real heading after it — max is a generous sanity ceiling, not a design limit.
function headingsFrom(contentMd, max = 300) {
  const body = contentMd.split('\n').slice(1).join('\n'); // drop content.md's own generated title line only
  return body.split('\n').filter(l => /^#{1,6} /.test(l)).slice(0, max)
    .map(l => l.replace(/^#+ /, '').trim()).filter(Boolean);
}

function extractAiSection(pageMdText) {
  const m = pageMdText && pageMdText.split(AI_BEGIN)[1];
  if (!m) return null;
  const body = m.split(AI_END)[0].trim();
  return body && body !== PENDING ? body : null;
}

// ── Dashboard-v2 derivations (all deterministic; embedded additively) ─────────
// clickDepth: BFS over the captured link graph from the home page (route '/').
// depth 0 = home; depth null = captured but not reachable from home (drawn honestly on
// the outer ring, never faked into a nearer one).
function computeDepths(pages, rootSlug) {
  const depth = {};
  for (const s of Object.keys(pages)) depth[s] = null;
  if (!rootSlug || !pages[rootSlug]) return depth;
  const strip = (t) => t.replace(' (template)', '');
  depth[rootSlug] = 0;
  let frontierLayer = [rootSlug];
  while (frontierLayer.length) {
    const next = [];
    for (const s of frontierLayer) for (const raw of pages[s].linksTo || []) {
      const t = strip(raw);
      if (pages[t] && depth[t] === null) { depth[t] = depth[s] + 1; next.push(t); }
    }
    frontierLayer = next;
  }
  return depth;
}

// The product's own nav section, derived from the first route segment (never invented).
// '/' → 'Home'; '/account/orders' → 'Account'; '/the-gift-card-store' → 'The Gift Card Store'.
function sectionOf(route) {
  const segs = (route || '/').split('/').filter(Boolean);
  if (!segs.length) return 'Home';
  return segs[0].split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Home';
}
function sectionOfUrl(u) { try { return sectionOf(new URL(u).pathname); } catch { return 'Other'; } }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const key = e.toLowerCase();
    if (ENT[key] != null) return ENT[key];
    if (/^#x/i.test(e)) { const n = parseInt(e.slice(2), 16); return isNaN(n) ? m : String.fromCodePoint(n); }
    if (/^#/.test(e)) { const n = parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
    return m;
  });
}
// Observed page-level description — <meta name=description> or og:description, from the
// captured DOM (method: 'dom'). Never fetched; only read from the already-captured page.html.
function extractMetaDescription(html) {
  if (!html) return null;
  const tagRe = /<meta\b[^>]*>/gi; let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const nm = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!nm) continue;
    const key = nm[1].toLowerCase();
    if (key !== 'description' && key !== 'og:description') continue;
    const c = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag); // same quote closes (apostrophes inside stay)
    if (c && c[2].trim()) return decodeEntities(c[2]).replace(/\s+/g, ' ').trim();
  }
  return null;
}

// ── Token aggregation: merge per-page computed-tokens into observed scales ────
// Statistics only (frequency + clustering), stamped method:heuristic. Deterministic:
// stable sort (count desc, value asc), timestamps from the manifest, never Date.now().
function normColor(v) {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return v.startsWith('#') ? { hex: v.toUpperCase(), alpha: false } : null;
  const hex = '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, alpha: m[4] !== undefined && +m[4] < 1 };
}
function aggregateTokens(pagesDir, slugs) {
  const cats = { colors: new Map(), typography: new Map(), spacing: new Map(), radius: new Map(), shadows: new Map() };
  const bump = (map, key, count, slug, extra) => {
    if (!map.has(key)) map.set(key, { count: 0, pages: new Set(), ...extra });
    const e = map.get(key); e.count += count; e.pages.add(slug);
  };
  for (const slug of slugs) {
    const tp = path.join(pagesDir, slug, 'computed-tokens.json');
    if (!fs.existsSync(tp)) continue;
    const t = JSON.parse(fs.readFileSync(tp, 'utf8'));
    for (const c of t.colors || []) { const n = normColor(c.value); if (n) bump(cats.colors, n.hex, c.count, slug, { alpha: n.alpha }); }
    for (const y of t.typography || []) {
      const [size, weight, family] = y.value.split(' / ');
      bump(cats.typography, y.value, y.count, slug, { size: parseFloat(size) || 0, weight, family });
    }
    for (const s of t.spacing || []) bump(cats.spacing, s.value, s.count, slug, { px: parseFloat(s.value) || 0 });
    for (const r of t.radius || []) bump(cats.radius, r.value, r.count, slug, { px: parseFloat(r.value) || 0 });
    for (const s of t.shadows || []) bump(cats.shadows, s.value, s.count, slug, {});
  }
  const list = (map, extraKeys = []) => [...map.entries()]
    .map(([value, e]) => ({ value, count: e.count, pages: e.pages.size, ...Object.fromEntries(extraKeys.map(k => [k, e[k]])) }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
  const multiPage = slugs.length > 1;
  const keep = (arr) => multiPage ? arr.filter(x => x.pages >= 2) : arr;
  const colors = list(cats.colors, ['alpha']), typography = list(cats.typography, ['size', 'weight', 'family']);
  const spacing = list(cats.spacing, ['px']), radius = list(cats.radius, ['px']), shadows = list(cats.shadows);
  // scale inference: spacing/radius ladder (values seen on 2+ pages, sorted; base-unit share via divisibility)
  const ladder = (arr) => {
    const vals = keep(arr).filter(x => x.px > 0).sort((a, b) => a.px - b.px);
    const share = (n) => vals.length ? vals.filter(v => Math.abs(v.px / n - Math.round(v.px / n)) < 0.01).length / vals.length : 0;
    const base = share(8) >= 0.7 ? 8 : share(4) >= 0.7 ? 4 : null;
    return { steps: vals, baseUnit: base, baseUnitShare: base ? +share(base).toFixed(2) : null };
  };
  const ramp = keep(typography).sort((a, b) => b.size - a.size || b.count - a.count);
  return {
    method: 'heuristic',
    note: 'OBSERVED values aggregated across captured pages and clustered by statistics — not the product’s authored tokens. Filtered = seen on 2+ pages (raw kept below).',
    colors: { top: keep(colors).slice(0, 48), droppedSinglePage: colors.length - keep(colors).length },
    typography: { ramp: ramp.slice(0, 24), droppedSinglePage: typography.length - keep(typography).length },
    spacing: ladder(spacing), radius: ladder(radius),
    shadows: { top: keep(shadows).slice(0, 8), droppedSinglePage: shadows.length - keep(shadows).length },
    raw: { colors, typography, spacing, radius, shadows },
  };
}

// ── F2 (v2.4): the whitelabel accent — the dashboard wears the captured product's own color. ─────
// A pure, deterministic function of tokens.json contents (no clock, no randomness; stable sort with a
// lower-hex tiebreaker), so build-twice is byte-identical. The color is OBSERVED data: no qualifying
// candidate → no brand entry at all, and the dashboard keeps its CSS fallback (indigo #4F46E5) —
// measured-or-absent applies to color.
const DARK_PANEL = '#131316'; // must match the dashboard's :root --panel (contrast guard surface)
const DARK_BG = '#08090A';    // must match --bg (button-text candidate)
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0').toUpperCase()).join(''); }
function hexToHsl(hex) {
  const [R, G, B] = hexToRgb(hex).map(x => x / 255);
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) { if (mx === R) h = 60 * (((G - B) / d) % 6); else if (mx === G) h = 60 * ((B - R) / d + 2); else h = 60 * ((R - G) / d + 4); }
  if (h < 0) h += 360;
  return { h, s, l };
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function relLum(hex) {
  const lin = hexToRgb(hex).map(x => { const c = x / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a, b) { const la = relLum(a), lb = relLum(b); const [hi, lo] = la >= lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); }
function deriveBrand(tokens) {
  // §2.1 candidates: opaque, saturated (s ≥ .35), mid-lightness (l in [.20, .75]), never the error-red
  // band (h ≤ 15° or ≥ 345° with s ≥ .5 — the brand must not impersonate --bad). Score = count × pages;
  // ties break to the lower hex (stable, documented).
  const cands = ((tokens.colors && tokens.colors.top) || [])
    .filter(c => !c.alpha && /^#[0-9A-F]{6}$/i.test(c.value))
    .map(c => ({ ...c, hsl: hexToHsl(c.value), score: c.count * c.pages }))
    .filter(c => c.hsl.s >= 0.35 && c.hsl.l >= 0.20 && c.hsl.l <= 0.75)
    .filter(c => !((c.hsl.h <= 15 || c.hsl.h >= 345) && c.hsl.s >= 0.5));
  if (!cands.length) return null;
  cands.sort((a, b) => (b.score - a.score) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const seed = cands[0];
  // §2.2a dark-contrast guard: the accent as text/border on --panel must reach ≥ 3.0:1 — lighten
  // stepwise in HSL (hue/sat kept) until it does. On dark, "stronger" = LIGHTER (+8% L).
  let { h, s, l } = hexToHsl(seed.value);
  let accent = seed.value.toUpperCase();
  let guard = 0;
  while (contrastRatio(accent, DARK_PANEL) < 3.0 && l < 0.98 && guard++ < 50) { l = Math.min(0.98, l + 0.02); accent = hslToHex(h, s, l); }
  const accentStrong = hslToHex(h, s, Math.min(0.98, l + 0.08));
  // §2.2b button text on an accent fill: whichever of white/near-black reads stronger, stored per brand.
  const buttonText = contrastRatio('#FFFFFF', accent) >= contrastRatio(DARK_BG, accent) ? '#FFFFFF' : DARK_BG;
  return { seed: seed.value.toUpperCase(), applied: { accent, accentStrong, buttonText }, source: 'observed', basis: { count: seed.count, pages: seed.pages } };
}

// (covered-shapes) The set of URLs the designer explicitly pulled with `capture.js --urls` — i.e.
// downloaded AS the one example of a frontier shape ("Get one example"), rather than found by the crawl.
// Read from capture-log.json (cumulative, so it survives a later manifest.json overwrite — same reason
// deriveSkips reads it). Only such a page may claim a WILDCARD frontier group by route-match (§2b·2);
// without this gate the earliest-captured page that merely MATCHES a wildcard would claim it, and on
// wikipedia that is the home page — `/wiki/Main_Page` matches `/wiki/:var`, so the sun of the map would
// be relabelled "template standing for 2890 pages". Prefers an explicit `urls` array when a run has one
// (capture.js records it now); falls back to parsing argsSummary so pre-existing logs still work.
function derivePulledUrls(libDir) {
  const out = new Set();
  let runs = null;
  try {
    const cl = JSON.parse(fs.readFileSync(path.join(libDir, 'capture-log.json'), 'utf8'));
    if (cl && Array.isArray(cl.runs)) runs = cl.runs;
  } catch (_) {}
  for (const run of runs || []) {
    if (!run || run.mode !== 'urls') continue;
    const list = Array.isArray(run.urls) ? run.urls : String(run.argsSummary || '').replace(/^--urls\s+/, '').split(',');
    for (const u of list) { const t = String(u || '').trim(); if (/^https?:\/\//.test(t)) out.add(t); }
  }
  return out;
}

// M1 (v1-fix-manifest-record): registry.skips — the union of every run's skip/fail reasons, derived
// from the cumulative design-context/capture-log.json (see capture.js's appendCaptureLog), so a page
// blocked or auth-walled during ANY past run stays evidencable even after a later run's manifest.json
// overwrites the single latest-run record. Deduped by url (falling back to slug when a run never
// recorded a literal url, e.g. crawl-discovered candidates) — a later run's entry for the same key wins,
// so this reads as "current known state", not an ever-growing list of resolved history.
function deriveSkips(libDir, manifest) {
  let runs = null;
  try {
    const cl = JSON.parse(fs.readFileSync(path.join(libDir, 'capture-log.json'), 'utf8'));
    if (cl && Array.isArray(cl.runs)) runs = cl.runs;
  } catch (_) {}
  const byKey = new Map();
  const record = (key, reason, at) => { if (key) byKey.set(key, { url: key, reason, at }); };
  if (runs) {
    for (const run of runs) {
      for (const s of run.skipped || []) record(s.url || s.slug, s.reason, run.at);
      for (const f of run.failed || []) record(f.url || f.slug, f.error || 'failed', run.at);
    }
  } else {
    // No capture-log.json yet (a workspace mid-upgrade, before its next real capture run) — seed from
    // the latest manifest so registry.skips isn't empty until then. Additive-only: no data invented.
    for (const s of (manifest && manifest.skipped) || []) record(s.url || s.slug, s.reason, manifest.capturedAt);
    for (const f of (manifest && manifest.failed) || []) record(f.url || f.slug, f.error || 'failed', manifest.capturedAt);
  }
  return [...byKey.values()].sort((a, b) => (a.at < b.at ? 1 : (a.at > b.at ? -1 : 0)));
}

// D3: the zero-page branch — same public shape (registry.json + INDEX.md), honest content. Never
// throws even if manifest fields are missing/unexpected (a hand-built or edge-case manifest.json).
function buildEmptyIndex(libDir, manifest) {
  const product = (manifest && manifest.product) || path.basename(path.dirname(libDir));
  const origin = (manifest && (manifest.resolvedOrigin || manifest.startUrl)) || null;
  const skipped = (manifest && manifest.skipped) || [];
  const failed = (manifest && manifest.failed) || [];
  const reasons = [...new Set(skipped.map(s => s && s.reason).filter(Boolean))];

  const registry = {
    product, origin, capturedAt: (manifest && manifest.capturedAt) || null,
    generated: 'build-index.js — derived view; ground truth lives in pages/*/meta.json',
    howToConsume: 'This capture landed 0 pages — see manifest.json for the per-page skipped/failed reasons. Re-run capture once the underlying issue is addressed.',
    pages: {},
    frontier: { total: 0, note: 'discovered during capture, not downloaded; select on map.html or pass to capture.js --urls', nodes: [] },
    offOrigin: [],
    identity: null, readiness: null, events: [],
  };
  fs.writeFileSync(path.join(libDir, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  const why = reasons.length ? `every attempted page was skipped (${reasons.join(', ')})`
    : (failed.length ? 'every attempted page failed to capture' : 'no capture has run yet, or it found nothing to capture');
  const index = [
    `# ${product} — design context library`,
    '',
    '```',
    'described: 0/0 · states: 0 · frontier: 0 · offOrigin: 0 hosts · labels: scraped',
    '```',
    '',
    `**No pages are captured yet** — ${why}. See [manifest.json](manifest.json) for the full detail.`,
    '',
    origin ? `Last attempt was against: ${origin}` : null,
    '',
    'Re-run capture once the underlying issue is addressed — see the workspace CLAUDE.md for the command.',
  ].filter(x => x !== null).join('\n');
  fs.writeFileSync(path.join(libDir, 'INDEX.md'), index, 'utf8');

  return { pages: 0, described: 0, frontier: 0, hygiene: null };
}

function buildIndex(libDir) {
  const pagesDir = path.join(libDir, 'pages');
  const manifest = JSON.parse(fs.readFileSync(path.join(libDir, 'manifest.json'), 'utf8'));

  // D3: a capture that landed 0 pages (fully blocked, cap hit at zero, etc.) never gets a pages/
  // directory at all — writeSnapshot only mkdir's it on an actual write, which happens AFTER the
  // bad-page check, so a 100%-blocked run leaves neither pages/ nor ia/sitemap.json behind. That's a
  // real STATE to report honestly (see manifest.json's own skipped/failed reasons), not a crash —
  // build-index used to abort here with an unhandled ENOENT scanning a directory that was never
  // created. Any workspace with at least one real captured page is untouched by this guard.
  const hasPages = fs.existsSync(pagesDir) && fs.readdirSync(pagesDir).some(slug => fs.existsSync(path.join(pagesDir, slug, 'meta.json')));
  if (!hasPages) return buildEmptyIndex(libDir, manifest);

  const sitemap = JSON.parse(fs.readFileSync(path.join(libDir, 'ia', 'sitemap.json'), 'utf8'));

  // 1. load every page's meta + existing AI description
  const pages = {};
  for (const slug of fs.readdirSync(pagesDir)) {
    const dir = path.join(pagesDir, slug);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const pageMdPath = path.join(dir, 'page.md');
    const description = fs.existsSync(pageMdPath) ? extractAiSection(fs.readFileSync(pageMdPath, 'utf8')) : null;
    const content = fs.existsSync(path.join(dir, 'content.md')) ? fs.readFileSync(path.join(dir, 'content.md'), 'utf8') : '';
    pages[slug] = { meta, description, headings: headingsFrom(content) };
  }

  // 2. link graph among captured pages: exact URL match, then tracking-stripped routeKey, then template-pattern
  const byUrl = new Map();
  const byRouteKey = new Map();
  for (const [slug, p] of Object.entries(pages)) {
    byUrl.set(normalize(p.meta.url), slug); byUrl.set(normalize(p.meta.finalUrl), slug);
    byRouteKey.set(routeKey(p.meta.finalUrl || p.meta.url), slug);
  }
  const patternOf = (u) => { try { const segs = new URL(u).pathname.split('/').filter(Boolean); return '/' + segs.map(s => (/^\d+$/.test(s) || /^[0-9a-f]{12,}$/i.test(s) || (/\d/.test(s) && s.length >= 8 && /^[A-Za-z0-9_-]+$/.test(s))) ? ':id' : s).join('/'); } catch { return null; } };

  // 2a. the raw frontier (every discovered-but-not-captured URL) — built early so the additive
  // representative-first patch below (bug 8) can see it before byPattern locks in "who's a template".
  const capturedUrlSet = new Set(byUrl.keys());
  const fro = new Map(); // url -> {url, pattern, via:Set, label}
  const noteFrontier = (rawUrl, via, label) => {
    const n = normalize(rawUrl); if (!n || capturedUrlSet.has(n)) return;
    if (!fro.has(n)) fro.set(n, { url: n, pattern: patternOf(n), via: new Set(), label: null });
    fro.get(n).via.add(via); if (label) fro.get(n).label = label;
  };
  for (const [slug, p] of Object.entries(pages)) for (const link of p.meta.linksOut || []) noteFrontier(link, slug);
  for (const h of manifest.frontierHints?.overCapNav || []) noteFrontier(h.url, 'nav', h.label);

  // Representative-first (bug 8): capture.js's selective `--urls` pull only preserves template/collapsed
  // on a REFRESH (same route as before) — a brand-new URL downloaded as "the one example" of a frontier
  // shape gets template:null like any ordinary page (verified: tools/capture.js selective-pull branch).
  // Reuse the crawl's own rule (3+ same-pattern URLs = a template) additively here, in the derived view
  // only — meta.json (ground truth) is never touched. If this page's raw route pattern still has ≥2
  // OTHER urls sitting in the frontier, this page is standing in for all of them.
  // Earliest-captured first, so if two separate "get one example" pulls ever land on the same pattern
  // (unusual — the offer stops suggesting more once one exists) exactly ONE claims the remaining pool;
  // zeroing its count after claiming stops a second untemplated sibling double-claiming the same pages.
  const frontierPatternCounts = new Map();
  for (const f of fro.values()) frontierPatternCounts.set(f.pattern, (frontierPatternCounts.get(f.pattern) || 0) + 1);
  const byCaptureOrder = Object.values(pages).slice().sort((a, b) => (a.meta.capturedAt || '') < (b.meta.capturedAt || '') ? -1 : 1);
  for (const p of byCaptureOrder) {
    if (p.meta.template) continue;
    const remaining = frontierPatternCounts.get(p.meta.pattern) || 0;
    if (remaining >= 2) { p.meta.template = p.meta.pattern; p.meta.collapsed = remaining; frontierPatternCounts.set(p.meta.pattern, 0); }
  }

  const byPattern = new Map();
  for (const [slug, p] of Object.entries(pages)) if (p.meta.template) byPattern.set(p.meta.pattern, slug);

  for (const [slug, p] of Object.entries(pages)) {
    const to = new Set();
    for (const link of p.meta.linksOut || []) {
      const n = normalize(link);
      if (byUrl.has(n) && byUrl.get(n) !== slug) { to.add(byUrl.get(n)); continue; }
      const rk = routeKey(link);                                  // tracked link → page captured under the clean route
      if (byRouteKey.has(rk) && byRouteKey.get(rk) !== slug) { to.add(byRouteKey.get(rk)); continue; }
      const pat = patternOf(link);
      if (pat && byPattern.has(pat) && byPattern.get(pat) !== slug) to.add(byPattern.get(pat) + ' (template)');
    }
    p.linksTo = [...to];
  }
  for (const [slug, p] of Object.entries(pages)) {
    p.linkedFrom = Object.entries(pages).filter(([s, q]) => s !== slug && q.linksTo.some(t => t.replace(' (template)', '') === slug)).map(([s]) => s);
  }

  // 2b. annotations (designer-owned, survives everything) + captured states (from fs)
  const annPath = path.join(libDir, 'annotations.json');
  const annotations = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, 'utf8')) : { pages: {} };
  for (const [slug, p] of Object.entries(pages)) {
    const ann = (annotations.pages || {})[slug] || {};
    p.notes = ann.notes || null;
    p.displayLabelRaw = (typeof ann.displayLabel === 'string' && ann.displayLabel.trim()) ? ann.displayLabel.trim() : null; // designer-owned override (F4)
    const states = [];
    const stDir = path.join(pagesDir, slug, 'states');
    if (fs.existsSync(stDir)) for (const name of fs.readdirSync(stDir)) {
      const mp = path.join(stDir, name, 'meta.json');
      if (fs.existsSync(mp)) { const sm = JSON.parse(fs.readFileSync(mp, 'utf8')); states.push({ name, captured: true, capturedAt: sm.capturedAt, url: sm.finalUrl }); }
    }
    for (const s of ann.states || []) if (!states.some(x => x.name === s.name)) states.push({ name: s.name, captured: false, url: s.url });
    p.states = states;
  }

  // 2b·2 (F3 hygiene-speaks-designer): folds — designer-recorded "one example can stand for both"
  // decisions, DERIVED-VIEW ONLY. A member gets foldedInto: rep; the rep's template/collapsed extends
  // exactly like a capture-time template collapse (creating one fresh if the rep wasn't already a
  // representative), pattern from the fold's own recorded `pattern` when given, else the rep's own
  // route. meta.json is never touched — mutating `pages[slug].meta` here only shapes THIS run's
  // registry.json/dashboard.html; removing the fold from annotations.json and rebuilding fully restores
  // (gate). Invalid/pruned rep or member slugs are skipped, not thrown — a stale fold can't break a build.
  const folds = (annotations.hygiene && Array.isArray(annotations.hygiene.folds)) ? annotations.hygiene.folds : [];
  for (const fold of folds) {
    const rep = pages[fold.rep];
    if (!rep) continue;
    const validMembers = (fold.members || []).filter(m => pages[m] && m !== fold.rep && !pages[m].foldedInto);
    if (!validMembers.length) continue;
    if (!rep.meta.template) {
      const pat = fold.pattern || rep.meta.route || '/';
      rep.meta.template = pat; rep.meta.pattern = pat; rep.meta.collapsed = 0;
    }
    rep.meta.collapsed += validMembers.length;
    for (const m of validMembers) pages[m].foldedInto = fold.rep;
  }

  // 2c. the FRONTIER — group the raw per-URL map (`fro`, built in 2a) by pattern.
  // group by id-pattern → merge one-segment-different patterns (same rule as capture's
  // mergeTemplateGroups) → fold prefix-sharing singles into /prefix/:slug groups →
  // overflow-fold whatever's left so the map never becomes a hairball.
  const WILD = (s) => s === ':id' || s === ':var' || s === ':slug';
  const wildNorm = (p) => p.split('/').map(s => WILD(s) ? '*' : s).join('/');
  const repByWild = new Map([...byPattern].map(([p, s]) => [wildNorm(p), s]));
  const groupsByPat = new Map();
  for (const f of fro.values()) { const k = f.pattern; if (!groupsByPat.has(k)) groupsByPat.set(k, []); groupsByPat.get(k).push(f); }
  // Merge pass (perf-frontier-merge): two keys are mergeable iff same segment count and they
  // differ at exactly one segment with at least one side WILD there — a property of the two
  // strings themselves that can never flip while both are alive. So a live pair, once found
  // incompatible, stays incompatible forever; only a freshly-created merged key needs checking
  // against what's still alive. The old code re-scanned every pair from scratch on every single
  // merge (that restart is what made this O(k²) per merge); this indexes keys by "signature"
  // (length + differing position + the other segments) so mergeable pairs are found via hash
  // lookup instead of brute force, while reproducing the exact same greedy pick order — first by
  // original Map-iteration rank, then by rank of partner — because merge order is NOT
  // interchangeable here: a key can be claimed by only one of two independently-eligible
  // partners, and which one it takes changes the final grouping (verified against the old
  // algorithm's output, byte-for-byte, on all 9 workspaces).
  const sigOf = (segs, pos) => segs.length + '|' + pos + '|' + segs.map((s, k) => k === pos ? '\0' : s).join('/');
  const sigBuckets = new Map(); // sig -> Set(key)
  const partners = new Map();   // key -> Set(key) of currently-known mergeable partners
  const segsOf = new Map();     // key -> its '/'.split() segments, cached
  const addKey = (key) => {
    const segs = key.split('/');
    segsOf.set(key, segs); partners.set(key, new Set());
    for (let pos = 0; pos < segs.length; pos++) {
      const sig = sigOf(segs, pos);
      let bucket = sigBuckets.get(sig);
      if (!bucket) { bucket = new Set(); sigBuckets.set(sig, bucket); }
      for (const other of bucket) {
        if (!WILD(segs[pos]) && !WILD(segsOf.get(other)[pos])) continue;
        partners.get(key).add(other); partners.get(other).add(key);
      }
      bucket.add(key);
    }
  };
  const removeKey = (key) => {
    const segs = segsOf.get(key);
    for (let pos = 0; pos < segs.length; pos++) sigBuckets.get(sigOf(segs, pos)).delete(key);
    for (const other of partners.get(key)) partners.get(other).delete(key);
    partners.delete(key); segsOf.delete(key);
  };
  for (const key of groupsByPat.keys()) addKey(key);
  for (;;) {
    const keys = [...groupsByPat.keys()];
    const i = keys.find(k => partners.get(k).size > 0);
    if (i === undefined) break; // fixed point — no live pair left that can merge
    const j = keys.find(k => partners.get(i).has(k)); // i's partners all rank after i (else they'd have been found first)
    const a = segsOf.get(i), b = segsOf.get(j);
    let diff = -1;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { diff = k; break; }
    const merged = a.map((s, k) => k === diff ? ':var' : s).join('/');
    const items = [...groupsByPat.get(i), ...groupsByPat.get(j)];
    removeKey(i); removeKey(j);
    groupsByPat.delete(i); groupsByPat.delete(j); groupsByPat.set(merged, items);
    // merged can coincide with a still-live third key's string (rare) — its index entry is
    // already correct for that string, so only index it if it's genuinely new.
    if (!partners.has(merged)) addKey(merged);
  }
  const singles = [];
  const frontier = []; let gi = 0;
  // repUrl (bug 8, representative-first): the URL "Get one example" downloads by default when the
  // designer hasn't picked a specific one — highest-inbound item, ties broken by original (stable) order.
  const pushGroup = (pattern, items) => { const viaAll = new Set(items.flatMap(i => [...i.via]));
    const repUrl = items.slice().sort((a, b) => b.via.size - a.via.size)[0].url;
    frontier.push({
    id: 'f' + (gi++), kind: 'frontier-group', pattern, count: items.length,
    urls: items.slice(0, 30).map(i => i.url), via: [...viaAll].slice(0, 6), inboundCount: viaAll.size, // inbound-from-captured (uncapped) → honest ghost sizing
    repUrl, underTemplate: repByWild.get(wildNorm(pattern)) || null }); };
  for (const [pat, items] of groupsByPat) { if (items.length >= 3) pushGroup(pat, items); else singles.push(...items); }
  const byPrefix = new Map();
  for (const f of singles) {
    try { const segs = new URL(f.url).pathname.split('/').filter(Boolean);
      const k = segs.length >= 2 ? '/' + segs.slice(0, -1).join('/') + '/:slug' : '/:slug'; // root-level singles group together
      if (!byPrefix.has(k)) byPrefix.set(k, []); byPrefix.get(k).push(f);
    } catch { if (!byPrefix.has('(other)')) byPrefix.set('(other)', []); byPrefix.get('(other)').push(f); }
  }
  const leftover = [];
  for (const [k, items] of byPrefix) { if (items.length >= 3) pushGroup(k, items); else leftover.push(...items); }
  const MAX_SINGLES = 25; // labeled (nav) singles first, then the rest; overflow folds into one node
  leftover.sort((a, b) => (b.label ? 1 : 0) - (a.label ? 1 : 0));
  leftover.slice(0, MAX_SINGLES).forEach(f => frontier.push({ id: 'f' + (gi++), kind: 'frontier', pattern: f.pattern, count: 1,
    url: f.url, urls: [f.url], label: f.label, via: [...f.via].slice(0, 6), inboundCount: f.via.size, underTemplate: repByWild.get(wildNorm(f.pattern)) || null }));
  if (leftover.length > MAX_SINGLES) pushGroup('(assorted one-off pages)', leftover.slice(MAX_SINGLES));
  const frontierTotal = [...fro.values()].length;

  // 2c·2 (covered-shapes) — REPRESENTATIVE-FIRST for MERGE-DERIVED shapes.
  // §2b's claim counts raw per-URL patternOf() patterns, so it only ever fires for a group whose pattern
  // patternOf itself produced (a `:id` group). The big groups on the map are not those: `/wiki/:var` is
  // manufactured by the merge pass above out of 2890 mutually-distinct literal patterns, so every member's
  // raw count is 1, and a downloaded example claimed nothing — it landed as an ordinary page while the
  // ghost kept its full count and nothing tied the two together. (Measured on wikipedia before this fix:
  // 1 of 76 groups had underTemplate, the one whose pattern is literal rather than merged.)
  // So the claim is made here against the FINAL grouped pattern, by route-match, gated on the page having
  // been explicitly pulled with --urls — see derivePulledUrls for why that gate is load-bearing.
  // `coveredBy` is the field the dashboard reads to decide a group gets NO ghost of its own: the count
  // then lives on the covering page ("stands for N") instead of being drawn twice, once in each place.
  // frontier.total and every fog/coverage tally still count these pages — they are not downloaded, they
  // just stop having a second disc (honesty rule #5: the fog must not shrink because a label moved).
  // Biggest group first, so a page that could answer two shapes goes to the larger one; `claimed` stops
  // one page standing for two. Deterministic — no Date.now, every tie broken by name.
  const pulledUrls = derivePulledUrls(libDir);
  const segsOfPath = (s) => String(s || '').split('/').filter(Boolean);
  const routeUnderPattern = (route, pattern) => {
    const r = segsOfPath(route), g = segsOfPath(pattern);
    return r.length === g.length && g.every((s, i) => WILD(s) || s === r[i]);
  };
  const claimedShape = new Set();
  const capOrder = Object.entries(pages).slice().sort((a, b) => {
    const x = a[1].meta.capturedAt || '', y = b[1].meta.capturedAt || '';
    return x < y ? -1 : (x > y ? 1 : String(a[0]).localeCompare(String(b[0])));
  });
  for (const g of frontier.slice().sort((a, b) => (b.count || 1) - (a.count || 1) || String(a.pattern || '').localeCompare(String(b.pattern || '')))) {
    if (g.underTemplate) { g.coveredBy = g.underTemplate; continue; }   // §2b already covered this shape
    if ((g.count || 1) < 2 || !g.pattern) continue;
    const hit = capOrder.find(([slug, p]) => !p.meta.template && !claimedShape.has(slug)
      && pulledUrls.has(p.meta.url) && routeUnderPattern(p.meta.route, g.pattern));
    if (!hit) continue;
    const [slug, p] = hit;
    // Derived-view mutation only — exactly the fold precedent in §2b·2: meta.json on disk is never
    // touched, and rebuilding without capture-log.json's --urls record restores the old shape. `pattern`
    // follows `template` (the fold sets both) so the page names the shape it stands for; `meta.route`
    // keeps the page's own real route, which is what the panel shows.
    p.meta.template = g.pattern; p.meta.pattern = g.pattern; p.meta.collapsed = g.count;
    p.meta.templateDerived = true;   // keeps its own name — see templateLabel
    claimedShape.add(slug);
    g.coveredBy = slug; g.underTemplate = slug;
  }

  // 2c·3 (covered-shapes) — one shape, ONE representative.
  // §2b claims by RAW pattern, so a claim can survive for a shape the merge pass has since absorbed:
  // wikipedia had a page standing for `/wiki/:id` (5 pages) while another stood for `/wiki/:var` (2891) —
  // and the first 5 are inside the second 2891. Two badges, the same pages counted twice, which is the
  // exact duplication retiring the ghost was meant to end. A claim is dropped when a COVERED group's
  // pattern subsumes it (same segment count, every segment equal-or-wildcard on the covered side) and it
  // isn't that group's own representative. Dropping a claim only demotes a page back to an ordinary page
  // — no page or URL leaves the library, and the covered group still counts every one of its pages.
  const coveredGroups = frontier.filter(g => g.coveredBy);
  for (const [slug, p] of Object.entries(pages)) {
    if (!p.meta.template) continue;
    const absorbed = coveredGroups.find(g => g.coveredBy !== slug && routeUnderPattern(p.meta.template, g.pattern));
    if (!absorbed) continue;
    p.meta.template = null; p.meta.collapsed = 0;
  }

  // 2e. offOrigin (F11): hosts linked from captured pages that the same-origin-only crawl never follows.
  // inbound = number of distinct captured pages referencing that host (mirrors inboundCount's semantics).
  const offOriginTally = new Map(); // host -> Set(slug)
  for (const [slug, p] of Object.entries(pages)) {
    for (const host of p.meta.offOriginHosts || []) {
      if (!offOriginTally.has(host)) offOriginTally.set(host, new Set());
      offOriginTally.get(host).add(slug);
    }
  }
  // D7: `host` stays the raw punycode form (ground truth, unchanged) — `hostDisplay` is additive, for
  // anywhere this reaches a designer (an AI agent quoting it in chat, INDEX.md, the dashboard). Node's
  // domainToUnicode is a no-op on an already-ASCII host, so this is safe for every product, not just an
  // IDN one.
  const offOrigin = [...offOriginTally.entries()]
    .map(([host, slugs]) => ({ host, hostDisplay: domainToUnicode(host), inbound: slugs.size }))
    .sort((a, b) => b.inbound - a.inbound || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));

  // 3. per-page page.md (regenerated; AI section preserved)
  const navOrder = sitemap.pages.map(x => x.slug);
  const ordered = [...navOrder.filter(s => pages[s]), ...Object.keys(pages).filter(s => !navOrder.includes(s))];

  // ── 2d. Dashboard-v2 derived data (deterministic; embedded additively) ──────────
  const round1 = (x) => Math.round(x * 10) / 10;
  // R1 (v1-fix-map-root): root resolution is ground-truth-first. Route '/' is a page-authoring
  // convention plenty of real products don't use (Wikipedia's home is /wiki/Main_Page) — falling
  // straight to "most inbound" on those products hands the map's centre to whatever page every other
  // page happens to link to (Wikipedia: Special:CreateAccount, in the footer nav of every page), an
  // arbitrary page wearing the "home" label, not a home. manifest.json's startUrl/resolvedOrigin is
  // what the designer actually pointed the crawl at — that's the recorded fact, not an inference.
  const hostOf = (u) => { try { return new URL(u).host.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
  const urlOf = (s) => pages[s].meta.finalUrl || pages[s].meta.url;
  // Two independent recordings of "where the designer pointed this crawl", tried in order — startUrl
  // may carry a path resolvedOrigin never does, resolvedOrigin may carry a post-redirect origin startUrl
  // never does (capture.js resolves TLD/country redirects into resolvedOrigin, e.g. airbnb.com →
  // www.airbnb.co.in), so a product that redirects needs the latter and one that doesn't needs the
  // former — trying only one leaves real workspaces falling through to a weaker tier for no reason.
  const startCandidates = [manifest.startUrl, manifest.resolvedOrigin, sitemap.origin].filter(Boolean);
  let rootSlug = null;
  for (const cand of startCandidates) {
    rootSlug = ordered.find(s => routeKey(urlOf(s)) === routeKey(cand));
    if (rootSlug) break;
  }
  if (!rootSlug) {
    // Neither candidate routeKey-matched a captured page by path — likely a bare-origin start that
    // redirected inward (e.g. `--url https://en.wikipedia.org` → /wiki/Main_Page). capture.js always
    // captures the page that origin actually resolves to FIRST (`landingCand` → ia/sitemap.json's
    // pages[0]) — still the crawl's own recorded entry, just keyed by discovery order + host instead of
    // an exact URL match.
    for (const cand of startCandidates) {
      const host = hostOf(cand);
      if (host && navOrder.length && pages[navOrder[0]] && hostOf(urlOf(navOrder[0])) === host) { rootSlug = navOrder[0]; break; }
    }
  }
  let rootBasis = rootSlug ? 'startUrl' : null;
  if (!rootSlug) { rootSlug = ordered.find(s => pages[s].meta.route === '/'); if (rootSlug) rootBasis = 'route'; }
  if (!rootSlug) {
    rootSlug = [...ordered].sort((a, b) => pages[b].linkedFrom.length - pages[a].linkedFrom.length)[0] || ordered[0];
    rootBasis = 'most-inbound (fallback)';
  }
  const depths = computeDepths(pages, rootSlug);
  const tokens = aggregateTokens(pagesDir, ordered);
  const brand = deriveBrand(tokens); // F2 (v2.4): whitelabel accent — null when nothing qualifies

  // display labels (F4): designer override (annotations.displayLabel) wins verbatim; otherwise the
  // usual label; on collision between two auto-labels, append the distinguishing route → deterministic.
  const baseLabelOf = (s) => { const m = pages[s].meta; return pages[s].displayLabelRaw || m.navLabel || templateLabel(m) || m.title || s; };
  const labelCounts = {};
  for (const s of ordered) { const b = baseLabelOf(s); labelCounts[b] = (labelCounts[b] || 0) + 1; }
  const displayLabel = {}; const usedLabels = {};
  for (const s of ordered) { const b = baseLabelOf(s);
    let cand = (pages[s].displayLabelRaw || labelCounts[b] === 1) ? b : `${b} (${pages[s].meta.route})`;
    // final uniqueness guard — if route also collides (near-identical template pages) append a counter
    if (usedLabels[cand]) { let i = 2, base = cand; while (usedLabels[`${base} · ${i}`]) i++; cand = `${base} · ${i}`; }
    usedLabels[cand] = true; displayLabel[s] = cand; }
  const displayLabelOf = (s) => displayLabel[s] || s;

  const capturedCount = ordered.length;
  const describedCount = ordered.filter(s => pages[s].description).length;
  const tplCountD = ordered.filter(s => pages[s].meta.template).length;
  const pagesWithStates = ordered.filter(s => pages[s].states.some(x => x.captured)).length;
  const statesTotalD = ordered.reduce((n, s) => n + pages[s].states.filter(x => x.captured).length, 0);
  const productSummaryPresent = (() => { try { const p = path.join(libDir, 'product-summary.md'); return fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim().length > 0; } catch { return false; } })();
  const patternsPresent = fs.existsSync(path.join(libDir, 'patterns.json'));
  const tokensPresent = tokens.colors.top.length > 0 && tokens.typography.ramp.length > 0;

  // readiness = COMPOSITE context-readiness score (not surface coverage). Heuristic v1, labeled.
  const KEY_PAGES_TARGET = 12, STATES_TARGET = 3;
  const rc = [
    { key: 'keyPages', label: 'Key pages captured', earned: round1(30 * Math.min(1, capturedCount / KEY_PAGES_TARGET)), max: 30, detail: `${capturedCount} page${capturedCount === 1 ? '' : 's'} captured` },
    { key: 'tokens', label: 'Visual language extracted', earned: tokensPresent ? 14 : 0, max: 14, detail: tokensPresent ? `${tokens.colors.top.length} colors · ${tokens.typography.ramp.length} type sizes` : 'not extracted yet' },
    { key: 'descriptions', label: 'Pages described', earned: round1(capturedCount ? 30 * describedCount / capturedCount : 0), max: 30, detail: `${describedCount} of ${capturedCount} described` },
    { key: 'productSummary', label: 'Product summary', earned: productSummaryPresent ? 8 : 0, max: 8, detail: productSummaryPresent ? 'written by your AI' : 'not written yet' },
    { key: 'states', label: 'Key states captured', earned: round1(18 * Math.min(1, pagesWithStates / STATES_TARGET)), max: 18, detail: `${pagesWithStates} of ${STATES_TARGET} key pages with states` },
  ];
  const readiness = {
    score: Math.round(rc.reduce((n, c) => n + c.earned, 0)), reachable: 100, method: 'heuristic', formula: 'v1',
    note: 'Composite context-readiness (how ready this library is to serve as AI design context) — NOT surface coverage. Heuristic v1; the weighting is a first pass.',
    components: rc,
  };

  // identity — name + observed meta description (from the already-captured DOM; never fetched) + facts.
  const rootHtml = (() => { try { return fs.readFileSync(path.join(pagesDir, rootSlug, 'page.html'), 'utf8'); } catch { return ''; } })();
  const metaDesc = extractMetaDescription(rootHtml);
  let identHost = ''; try { identHost = new URL(sitemap.origin).host; } catch { identHost = sitemap.origin; }
  const identity = {
    name: sitemap.product, host: identHost, origin: sitemap.origin,
    logo: null, // no favicon/logo in captured assets → UI renders the hatched placeholder; never fetched
    description: metaDesc ? { text: metaDesc, method: 'dom' } : null,
    found: capturedCount + frontierTotal, downloaded: capturedCount, described: describedCount, describable: capturedCount,
    capturedAt: manifest.capturedAt,
  };

  // nav sections (bearings) + district summaries — measured from the route graph, honest.
  const sectionsOrder = [];
  { const seen = new Set(); for (const s of ordered) { const sec = sectionOf(pages[s].meta.route); if (!seen.has(sec)) { seen.add(sec); sectionsOrder.push(sec); } } }
  const districts = sectionsOrder.filter(x => x !== 'Home').map(name => ({
    name,
    explored: ordered.filter(s => s !== rootSlug && sectionOf(pages[s].meta.route) === name).length,
    fog: frontier.reduce((n, f) => n + ((f.pattern ? sectionOf(f.pattern) : sectionOfUrl(f.url)) === name ? (f.count || 1) : 0), 0),
    states: ordered.filter(s => sectionOf(pages[s].meta.route) === name && pages[s].states.some(x => x.captured)).length,
  }));

  // events[] — the journal feed, assembled from EMBEDDED/stable metadata only (never page.md mtime,
  // which build-index itself rewrites every run; never Date.now). Deterministic ordering.
  const pageLabelOf = (s) => pages[s] ? displayLabelOf(s) : s;
  const events = [];
  const capAt = manifest.capturedAt;
  const dudSkip = (manifest.skipped || []).length, failCount = (manifest.failed || []).length;
  events.push({ at: capAt, dateOnly: false, seq: 1, actor: 'the kit', kind: 'capture',
    title: `Captured ${capturedCount} page${capturedCount === 1 ? '' : 's'} of ${identHost}`,
    detail: `${identity.found} discovered · ${tplCountD} layout template${tplCountD === 1 ? '' : 's'}${dudSkip ? ` · ${dudSkip} dud excluded` : ''}${failCount ? ` · ${failCount} failed` : ''}`,
    link: { tab: 'map' } });
  if (tokensPresent) events.push({ at: capAt, dateOnly: true, seq: 2, actor: 'the kit', kind: 'tokens',
    title: 'Extracted the visual language',
    detail: `${tokens.colors.top.length} colors · ${tokens.typography.ramp.length} type sizes${tokens.spacing.baseUnit ? ` · ${tokens.spacing.baseUnit}px base` : ''}`,
    link: { tab: 'design' } });
  // F2 (v2.4): the brand event — same `at` as the tokens event, next seq. Derived from tokens.json
  // contents (build-twice identical); ABSENT when no brand qualifies (no fake entry). Canon §7 wording.
  if (brand) events.push({ at: capAt, dateOnly: true, seq: 3, actor: 'the kit', kind: 'brand',
    title: "Borrowed your product's color",
    detail: `${brand.seed} — the dashboard now wears it · observed across ${brand.basis.pages} pages`,
    link: { tab: 'design' } });
  if (describedCount > 0) {
    // No embedded timestamp for the describe step → anchor to the latest capture (describing can't
    // predate capture) and show the date only, never a fabricated clock time.
    const latestCap = ordered.map(s => pages[s].meta.capturedAt).filter(Boolean).sort().pop() || capAt;
    events.push({ at: latestCap, dateOnly: true, seq: 3, actor: 'your AI', kind: 'describe',
      title: `Read the library — ${describedCount} page${describedCount === 1 ? '' : 's'} described`,
      detail: describedCount === capturedCount ? 'Wrote "what this page is" for every page.' : `${capturedCount - describedCount} still pending.`,
      link: { tab: 'home' } });
  }
  for (const s of ordered) for (const st of pages[s].states) if (st.captured && st.capturedAt)
    events.push({ at: st.capturedAt, dateOnly: false, seq: 5, actor: 'you', kind: 'state',
      title: `State added — ${st.name}`, detail: `on ${pageLabelOf(s)}`, link: { page: s } });
  // wireframe rounds — scan the sibling wireframes/ dir (build-index never writes there → dir mtime
  // is stable across consecutive runs, so this stays deterministic for the run-twice check).
  try {
    const wfRoot = path.join(libDir, '..', 'wireframes');
    const countHtml = (dir, depth = 0) => { let n = 0; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && /\.html$/i.test(e.name)) n++; else if (e.isDirectory() && depth < 1) n += countHtml(path.join(dir, e.name), depth + 1); } } catch {} return n; };
    const scanRounds = (base, label, isNew) => { try {
      for (const e of fs.readdirSync(base, { withFileTypes: true })) {
        if (!e.isDirectory() || !/^round-/i.test(e.name)) continue;
        const rdir = path.join(base, e.name); const n = e.name.replace(/^round-/i, '');
        const approaches = countHtml(rdir);
        events.push({ at: fs.statSync(rdir).mtime.toISOString(), dateOnly: false, seq: 6, actor: 'your AI', kind: 'wireframe',
          title: `Wireframes — ${label}, round ${n}${approaches ? ` · ${approaches} approach${approaches === 1 ? '' : 'es'}` : ''}`,
          detail: `${isNew ? 'wireframes/new/' : 'wireframes/'}${isNew ? label : (pages[label] ? label : label)}/${e.name} · library untouched`,
          link: (!isNew && pages[label]) ? { page: label } : null });
      }
    } catch {} };
    if (fs.existsSync(wfRoot)) for (const e of fs.readdirSync(wfRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name === 'new') { for (const c of fs.readdirSync(path.join(wfRoot, 'new'), { withFileTypes: true })) if (c.isDirectory()) scanRounds(path.join(wfRoot, 'new', c.name), c.name, true); }
      else scanRounds(path.join(wfRoot, e.name), pageLabelOf(e.name), false);
    }
  } catch {}
  // guided sessions → one ledger event per session (F4·2). Absent-safe. Capped to the last N so a
  // long-lived guided-sessions.json never floods the ledger — full history stays in the file (the
  // journal can show all). Derived from file CONTENTS (endedAt), never mtime → build-twice stable.
  const GUIDED_LEDGER_CAP = 8;
  let guidedSummary = null;
  try {
    const gs = JSON.parse(fs.readFileSync(path.join(libDir, 'guided-sessions.json'), 'utf8'));
    const sessions = (gs && Array.isArray(gs.sessions)) ? gs.sessions : [];
    if (sessions.length) {
      const totalCaptures = sessions.reduce((n, s) => n + ((s.captures || []).length), 0);
      guidedSummary = { sessions: sessions.length, captures: totalCaptures, lastAt: sessions[sessions.length - 1].endedAt || null };
      for (const s of sessions.slice(-GUIDED_LEDGER_CAP)) {
        const caps = s.captures || [];
        if (!caps.length) continue;
        // Adaptive title: a capture with no state name is a NEW PAGE; one with a state name is a STATE
        // of an existing page. Count each honestly so "N states across M pages" isn't claimed when the
        // session only added whole pages.
        const stateCount = caps.filter(c => c.state).length;
        const pageCount = caps.length - stateCount;
        const statePages = new Set(caps.filter(c => c.state).map(c => c.slug)).size;
        const pg = (n) => `${n} page${n === 1 ? '' : 's'}`;
        const st = (n) => `${n} state${n === 1 ? '' : 's'}`;
        // F3: a session where every single capture re-captured an already-captured page (recapture is
        // only ever set on page-level writes, never states — see capture.js) gets its own adaptive
        // title; a mixed session keeps the existing title and marks just the affected detail lines.
        const recaptureOnly = caps.every(c => c.recapture);
        let title;
        if (recaptureOnly) title = `Guided capture — ${pg(caps.length)} re-captured`;
        else if (stateCount === 0) title = `Guided capture — ${pg(pageCount)}`;
        else if (pageCount === 0) title = `Guided capture — ${st(stateCount)} across ${pg(statePages)}`;
        else title = `Guided capture — ${pg(pageCount)} + ${st(stateCount)}`;
        events.push({ at: s.endedAt || s.startedAt, dateOnly: false, seq: 5, actor: 'you', kind: 'guided',
          title,
          detail: null,
          detailLines: caps.map(c => {
            const base = c.state ? `${pageLabelOf(c.slug)} › ${c.state}` : pageLabelOf(c.slug);
            return (c.recapture && !recaptureOnly) ? `${base} (re-captured)` : base;
          }),
          link: null });
      }
    }
  } catch (_) {}

  // hygiene.json (persisted at a guided session's end) → one "the kit" event (F4·2). Targets render as
  // PLAIN TEXT only — a finding can name a page pruned since, so never a link that can 404. Absent-safe.
  try {
    const hy = JSON.parse(fs.readFileSync(path.join(libDir, 'hygiene.json'), 'utf8'));
    const findings = (hy && Array.isArray(hy.findings)) ? hy.findings : [];
    const warns = findings.filter(x => (x.severity || 'warn') === 'warn').length;
    events.push({ at: hy.generatedAt, dateOnly: false, seq: 7, actor: 'the kit', kind: 'hygiene',
      title: warns > 0 ? `Hygiene check — ${warns} warning${warns === 1 ? '' : 's'}` : 'Hygiene check — clean',
      detail: null,
      detailLines: findings.slice(0, 6).map(f => `${f.text}${f.action ? ` → ${f.action}` : ''}`),
      link: null });
  } catch (_) {}

  // figma-copies.json (appended by map.js on each successful Copy-for-Figma) → one "you" event per
  // copy (figma-exit-copy-paste PRD, F3). Additive + absent-safe: a workspace with no such file
  // regenerates a byte-identical registry (crit #4). Derived from file CONTENTS (`at`), never mtime,
  // so build-twice is identical. Capped to the last N in the ledger; full history stays in the file.
  const FIGMA_LEDGER_CAP = 8;
  try {
    const fc = JSON.parse(fs.readFileSync(path.join(libDir, 'figma-copies.json'), 'utf8'));
    const copies = (fc && Array.isArray(fc.copies)) ? fc.copies : [];
    for (const c of copies.slice(-FIGMA_LEDGER_CAP)) {
      if (!c || !c.slug || !c.at) continue;
      const label = pageLabelOf(c.slug);
      events.push({ at: c.at, dateOnly: false, seq: 5, actor: 'you', kind: 'figma',
        title: c.state ? `Sent ${label} › ${c.state} to Figma` : `Sent ${label} to Figma`,
        detail: null,
        // link only when the page is still in the library (a copied page could be pruned later) — a
        // dead link would 404; matches the hygiene-event safety posture.
        link: pages[c.slug] ? { page: c.slug } : null });
    }
  } catch (_) {}

  // F1: coerce every event's actor to the closed canonical set before it ever reaches the dashboard.
  for (const e of events) e.actor = canonicalActor(e.actor);

  // ascending by time, stable tiebreak (seq, then kind, then title) → identical across re-runs
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.seq - b.seq) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  for (const slug of ordered) {
    const p = pages[slug]; const m = p.meta;
    const standsFor = m.template ? `Represents **${m.collapsed + 1} pages** sharing the layout \`${m.pattern}\` (${m.collapsed} not captured — same template).` : null;
    const md = [
      '---',
      `slug: ${slug}`,
      `title: ${JSON.stringify(m.title || '')}`,
      `route: ${m.route}`,
      m.navLabel ? `nav_label: ${JSON.stringify(m.navLabel)}` : null,
      `url: ${m.finalUrl}`,
      m.template ? `template: ${m.pattern}` : null,
      m.template ? `collapsed: ${m.collapsed}` : null,
      `captured: ${m.capturedAt}`,
      `method: dom (facts) + labeled ai section (description)`,
      '---',
      '',
      `# ${m.navLabel || templateLabel(m) || m.title || slug}`,
      '',
      '## What this page is',
      AI_BEGIN,
      p.description || PENDING,
      AI_END,
      '',
      ...(standsFor ? ['## Stands for', standsFor, ''] : []),
      ...(p.notes ? ['## Designer notes (designer-authored — highest authority)', p.notes, ''] : []),
      ...(p.states.length ? ['## States', ...p.states.map(s => s.captured
        ? `- **${s.name}** — captured ${s.capturedAt ? s.capturedAt.slice(0, 10) : ''} → [screenshot](states/${s.name}/screenshot.png) · [HTML](states/${s.name}/page.html)`
        : `- **${s.name}** — pending (${s.url})`), ''] : []),
      '## Files',
      `[screenshot](screenshot.png) · [editable HTML](page.html) · [verbatim copy](content.md) · [style tally](computed-tokens.json) · [meta](meta.json)`,
      // D6: an honest partial beats a corrupted whole — the screenshot only shows the top slice on a
      // page tall enough that a full capture would mis-render (see meta.json.screenshotTruncated).
      ...(m.screenshotTruncated ? [`_Screenshot shows the first ${m.screenshotTruncated.shownPx}px of a ${m.screenshotTruncated.fullPx}px page — the full page is still captured in [content.md](content.md)._`] : []),
      '',
      ...(p.headings.length ? ['## On this page (headings, verbatim)', ...p.headings.map(h => `- ${h}`), ''] : []),
      ...(p.linksTo.length ? ['## Links to (captured pages)', ...p.linksTo.map(t => `- [${t.replace(' (template)', '')}](../${t.replace(' (template)', '')}/page.md)${t.endsWith('(template)') ? ' _(via template)_' : ''}`), ''] : []),
      ...(p.linkedFrom.length ? ['## Linked from', ...p.linkedFrom.map(t => `- [${t}](../${t}/page.md)`), ''] : []),
    ].filter(x => x !== null).join('\n');
    fs.writeFileSync(path.join(pagesDir, slug, 'page.md'), md, 'utf8');
  }

  // 4. registry.json — the machine front door
  const registry = {
    product: sitemap.product, origin: sitemap.origin, capturedAt: manifest.capturedAt,
    generated: 'build-index.js — derived view; ground truth lives in pages/*/meta.json',
    howToConsume: 'Start at INDEX.md (human) or here (machine). Each page: pages/<slug>/ with page.md (digest), screenshot.png, page.html (editable baseline), content.md (verbatim copy), computed-tokens.json, meta.json. description.method=ai means model-written orientation prose, not extracted fact.',
    pages: Object.fromEntries(ordered.map(slug => { const p = pages[slug]; const m = p.meta; return [slug, {
      route: m.route, url: m.finalUrl, label: m.navLabel || templateLabel(m) || null, displayLabel: displayLabelOf(slug), title: m.title || null,
      template: m.template ? { pattern: m.pattern, standsFor: m.collapsed + 1 } : null,
      files: { pageMd: `pages/${slug}/page.md`, screenshot: `pages/${slug}/screenshot.png`, html: `pages/${slug}/page.html`, content: `pages/${slug}/content.md`, tokens: `pages/${slug}/computed-tokens.json`, meta: `pages/${slug}/meta.json` },
      linksTo: p.linksTo, linkedFrom: p.linkedFrom, contentHash: m.contentHash,
      states: p.states, designerNotes: p.notes,
      // additive dashboard-v2 fields (never mutate/remove existing ones): observed inbound count + measured click-depth from home
      inboundCount: p.linkedFrom.length, clickDepth: depths[slug],
      // F3: fold — set only on a member folded into a representative (derived view; disk untouched)
      foldedInto: p.foldedInto || null,
      // description = the ai section's FIRST paragraph (one-liner); the full screen doc stays in page.md
      description: p.description ? { text: p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(), method: 'ai', fullDoc: `pages/${slug}/page.md` } : null,
    }]; })),
    frontier: { total: frontierTotal, note: 'discovered during capture, not downloaded; select on map.html or pass to capture.js --urls', nodes: frontier },
    // F11: hosts linked from captured pages that same-origin capture never follows (e.g. a marketing
    // site's "Sign in" pointing at a separate app subdomain) — not in frontier, not in readiness.
    offOrigin,
    // M1 (v1-fix-manifest-record): cumulative skip/fail ledger across every run — see deriveSkips().
    skips: deriveSkips(libDir, manifest),
    // additive dashboard-v2 top-level fields
    identity, readiness, events,
    // R1 (v1-fix-map-root): which page clickDepth's rings are measured from, and how that page was
    // chosen — 'startUrl' (matched the crawl's own entry, directly or via its recorded landing page),
    // 'route' (route '/', no startUrl match), or 'most-inbound (fallback)' (neither — an honest guess).
    rootSlug, rootBasis,
  };
  // guided-capture summary — strictly additive AND only present when a guided session has run, so a
  // workspace with no guided-sessions.json regenerates a byte-identical registry to before (crit #7).
  if (guidedSummary) registry.guidedSessions = guidedSummary;
  fs.writeFileSync(path.join(libDir, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  // Hygiene lint over the just-written library (optional — never breaks a build if the module is absent).
  // Especially catches what guided (human-driven) capture can introduce: dupes, orphans, dead states.
  let hygiene = null;
  try { hygiene = require('./hygiene.js').runHygiene(libDir); } catch (_) {}

  // E6: surfaces-version staleness — CLAUDE.md/AGENTS.md carry a version stamp as their last line
  // (HTML comment). A workspace copy behind tools/'s own KIT_SURFACES_VERSION gets one info-level
  // hygiene line, never a build failure. No stamp at all (pre-E6 workspace) counts as stale.
  if (hygiene && !hygiene.error) {
    const workspaceRoot = path.join(libDir, '..');
    const stampVersion = (file) => {
      try {
        const m = fs.readFileSync(path.join(workspaceRoot, file), 'utf8').match(/design-context-kit surfaces v(\d+)/);
        return m ? parseInt(m[1], 10) : null;
      } catch { return null; }
    };
    if (stampVersion('CLAUDE.md') !== KIT_SURFACES_VERSION || stampVersion('AGENTS.md') !== KIT_SURFACES_VERSION) {
      hygiene.quality = hygiene.quality || [];
      hygiene.quality.push({
        kind: 'quality', subKind: 'stale-surfaces', severity: 'info', target: 'CLAUDE.md/AGENTS.md',
        issue: 'CLAUDE.md/AGENTS.md are older than tools/ — re-copy them from the template.',
        action: 're-copy CLAUDE.md, AGENTS.md and skills/ from the template',
        key: 'quality::stale-surfaces',
      });
    }
  }

  // 4b. tokens.json + dashboard.html — Map · Home · Design language (self-contained; live via tools/map.js)
  // F2: `brand` is strictly additive (appended after every existing field) and only present when derived.
  fs.writeFileSync(path.join(libDir, 'tokens.json'), JSON.stringify(brand ? { ...tokens, brand } : tokens, null, 2), 'utf8');
  const tplPath = path.join(__dirname, 'dashboard-template.html');
  if (fs.existsSync(tplPath)) {
    const mapData = {
      product: sitemap.product, origin: sitemap.origin, generatedAt: manifest.capturedAt,
      rootSlug, rootBasis, sections: sectionsOrder, districts,
      nodes: ordered.map(slug => { const p = pages[slug]; const m = p.meta; return {
        id: slug, kind: m.template ? 'template' : 'page',
        label: m.navLabel || templateLabel(m) || (m.title || slug).slice(0, 40), displayLabel: displayLabelOf(slug), route: m.route,
        desc: p.description ? p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null,
        screenshot: `pages/${slug}/screenshot.png`, pageHtml: `pages/${slug}/page.html`, pageMd: `pages/${slug}/page.md`,
        capturedAt: m.capturedAt, standsFor: m.template ? m.collapsed + 1 : null,
        states: p.states, notes: p.notes, descPending: !p.description,
        inboundCount: p.linkedFrom.length, clickDepth: depths[slug], section: sectionOf(m.route),
        linksTo: p.linksTo.map(t => t.replace(' (template)', '')), linkedFrom: p.linkedFrom,
        foldedInto: p.foldedInto || null, // F3: set only on a member folded into a representative
      }; }),
      frontier: frontier.map(f => ({ ...f, section: f.pattern ? sectionOf(f.pattern) : sectionOfUrl(f.url) })),
      edges: [
        ...ordered.flatMap(slug => pages[slug].linksTo.map(t => ({ a: slug, b: t.replace(' (template)', ''), kind: 'link' }))),
        ...frontier.flatMap(f => (f.underTemplate ? [f.underTemplate] : f.via.slice(0, 3)).map(v => ({ a: v, b: f.id, kind: 'frontier' }))),
      ],
    };
    const overview = {
      health: { skipped: manifest.skipped || [], failed: manifest.failed || [], actions: manifest.actions || [], capped: manifest.capped || 0 },
      nav: ordered.filter(s => !pages[s].meta.template).map(s => ({ slug: s, label: pages[s].meta.navLabel || pages[s].meta.title, displayLabel: displayLabelOf(s), route: pages[s].meta.route,
        desc: pages[s].description ? pages[s].description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null, descPending: !pages[s].description })),
      templates: ordered.filter(s => pages[s].meta.template).map(s => ({ slug: s, pattern: pages[s].meta.pattern, standsFor: pages[s].meta.collapsed + 1,
        screenshot: `pages/${s}/screenshot.png`, desc: pages[s].description ? pages[s].description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null })),
      recent: ordered.map(s => ({ slug: s, label: pages[s].meta.navLabel || templateLabel(pages[s].meta) || pages[s].meta.title || s, at: pages[s].meta.capturedAt }))
        .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8),
      statesTotal: ordered.reduce((n, s) => n + pages[s].states.filter(x => x.captured).length, 0),
      notes: ordered.filter(s => pages[s].notes).map(s => ({ slug: s, notes: pages[s].notes })),
      standsForTotal: ordered.reduce((n, s) => n + (pages[s].meta.template ? pages[s].meta.collapsed + 1 : 1), 0),
      hygiene,
    };
    const dash = { map: mapData, overview, tokens: { ...tokens, raw: undefined }, // raw stays in tokens.json, not the page
      workspaceName: path.basename(path.dirname(libDir)),
      pendingDescriptions: ordered.filter(s => !pages[s].description).length,
      // dashboard-v2 additions
      identity, readiness, events, patternsPresent, productSummaryPresent };
    if (brand) dash.brand = brand; // F2 (v2.4): same object as tokens.json.brand — boot applies it to :root
    const html = fs.readFileSync(tplPath, 'utf8')
      .replace('/*__DASHDATA__*/null', JSON.stringify(dash).replace(/</g, '\\u003c'));
    fs.writeFileSync(path.join(libDir, 'dashboard.html'), html, 'utf8');
    const stale = path.join(libDir, 'map.html'); if (fs.existsSync(stale)) fs.unlinkSync(stale); // superseded
  }

  // 4c. _dom-to-figma.js — the vendored bundle that powers the ⧉ Copy for Figma exit, dropped beside
  // dashboard.html as a DERIVED asset (regenerated every build like the dashboard, never hand-edited).
  // 830KB, so it's NEVER inlined into the single-file dashboard — the dashboard lazy-loads it on the
  // first Copy-for-Figma click (dashboard first-paint cost unchanged). Absent-safe: if the vendored
  // file is missing, the build still succeeds and the dashboard shows its own paste-help toast.
  try {
    const vendored = path.join(__dirname, 'vendor', 'dom-to-figma.iife.js');
    if (fs.existsSync(vendored)) fs.copyFileSync(vendored, path.join(libDir, '_dom-to-figma.js'));
  } catch (e) { console.log(`⚠ dom-to-figma copy: ${e.message.split('\n')[0]}`); }

  // 5. INDEX.md — the human front door
  const line = (slug) => { const p = pages[slug]; const m = p.meta;
    const desc = p.description ? p.description.split(/(?<=\.)\s/)[0].replace(/\|/g, '\\|') : '_pending_';
    const tpl = m.template ? ` ⧉×${m.collapsed + 1}` : '';
    return `| **${m.navLabel || templateLabel(m) || m.title || slug}**${tpl} | \`${m.route}\` | ${desc} | [📸](pages/${slug}/screenshot.png) [HTML](pages/${slug}/page.html) [MD](pages/${slug}/page.md) |`; };
  const navSlugs = ordered.filter(s => !pages[s].meta.template);
  const tplSlugs = ordered.filter(s => pages[s].meta.template);
  // F4: machine-readable front-matter — every auto-load subject opened INDEX.md first regardless of
  // where the prose pointed (F4's evidence); this puts the counts they went hunting for on the first
  // lines instead. Exact keys, deterministic (same inputs registry.json already computes).
  const frontMatter = [
    '```',
    `described: ${describedCount}/${capturedCount} · states: ${statesTotalD} · frontier: ${frontierTotal} · offOrigin: ${offOrigin.length} hosts · labels: scraped`,
    '```',
    '',
  ];
  const index = [
    `# ${sitemap.product} — design context library`,
    '',
    ...frontMatter,
    `Captured ${manifest.capturedAt.slice(0, 10)} from ${sitemap.origin} · ${ordered.length} pages · read-only scrape, provenance-stamped.`,
    '',
    // R1: honest disclosure only when the map's centre was neither the crawl's own recorded entry nor
    // route '/' — i.e. an actual guess, not measured. Silent in the normal case on purpose.
    ...(rootBasis === 'most-inbound (fallback)' ? [`> **Map root is a guess:** no page matched the captured startUrl and none sits at route \`/\`, so the map's centre (**${displayLabelOf(rootSlug)}**) is the most-linked-to page instead — not necessarily this product's real home. Rings measure clicks from there.`, ''] : []),
    `**[Open the dashboard](dashboard.html)** — coverage map (**${frontierTotal}** discovered-but-not-downloaded pages on the frontier), capture overview, and the product's observed design tokens ([tokens.json](tokens.json), method: heuristic). Run \`node tools/map.js\` to make it live (unlock frontier pages, add state URLs).`,
    '',
    '**For AI agents:** read `registry.json` first (same content, machine shape). Every value here is derived from `pages/*/meta.json`; page descriptions are model-written and labeled `method: ai` — everything else is extracted fact.',
    '',
    '## Navigation pages (in the product\'s own nav order)',
    '', '| Page | Route | What it is | Open |', '|---|---|---|---|',
    ...navSlugs.map(line),
    '',
    ...(tplSlugs.length ? ['## Layout templates (one representative captured; ⧉×N = pages sharing this layout)', '', '| Template | Route | What it is | Open |', '|---|---|---|---|', ...tplSlugs.map(line), ''] : []),
    '## How pages connect',
    '', ...ordered.filter(s => pages[s].linksTo.length).map(s => `- **${pages[s].meta.navLabel || s}** → ${pages[s].linksTo.map(t => t.replace(' (template)', '⧉')).join(', ')}`),
    '',
    // D7: the human front door showing readable hostnames — decoded (hostDisplay), never the raw
    // punycode form registry.json keeps as ground truth. Top 10 by inbound count; the rest are in
    // registry.json's own offOrigin array for anything that needs the full list.
    ...(offOrigin.length ? ['## Off-origin (linked but not captured — a different host)', '',
      `${offOrigin.length} host${offOrigin.length === 1 ? '' : 's'} linked from captured pages, on a different host the same-origin crawl never follows:`, '',
      ...offOrigin.slice(0, 10).map(o => `- ${o.hostDisplay} (${o.inbound} page${o.inbound === 1 ? '' : 's'} link here)`),
      ...(offOrigin.length > 10 ? [`- …and ${offOrigin.length - 10} more — see registry.json's \`offOrigin\` array`] : []),
      ''] : []),
    `Skipped/failed during capture: see [manifest.json](manifest.json). Wireframes built on these pages live in \`../wireframes/\` — never inside this library.`,
  ].join('\n');
  fs.writeFileSync(path.join(libDir, 'INDEX.md'), index, 'utf8');

  return { pages: ordered.length, described: ordered.filter(s => pages[s].description).length, frontier: frontierTotal, hygiene };
}

module.exports = { buildIndex, routeKey, deriveBrand, contrastRatio, hexToHsl, deriveSkips }; // routeKey for the mirror test; deriveBrand & helpers for test-brand.js; deriveSkips for test-capture-log.js

if (require.main === module) {
  const libDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  const r = buildIndex(libDir);
  console.log(`✅  INDEX.md + registry.json + ${r.pages} page.md files (${r.described} described, ${r.pages - r.described} pending)`);
  try { if (r.hygiene) console.log(require('./hygiene.js').formatHygiene(r.hygiene)); } catch (_) {}
}
