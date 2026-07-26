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

const AI_BEGIN = '<!-- ai:begin method=ai — written by the describe step, NOT ground truth -->';
const AI_END = '<!-- ai:end -->';
const PENDING = '_(not yet described — run the describe step)_';

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
  const segs = m.pattern.split('/').filter(s => s && !/^[:[]/.test(s)); // drop dynamic segments (:id, [id])
  const last = segs[segs.length - 1];
  if (!last) return null;
  const words = last.split(/[-_]/).filter(Boolean);
  if (!words.length) return null;
  words[words.length - 1] = words[words.length - 1].replace(/s$/, ''); // singularize the final word only
  const titled = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return titled ? `${titled} Details` : null;
}

function headingsFrom(contentMd, max = 8) {
  return contentMd.split('\n').filter(l => /^#{1,6} /.test(l)).slice(1, 1 + max) // skip the title line
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

function buildIndex(libDir) {
  const pagesDir = path.join(libDir, 'pages');
  const sitemap = JSON.parse(fs.readFileSync(path.join(libDir, 'ia', 'sitemap.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(libDir, 'manifest.json'), 'utf8'));

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
  const byPattern = new Map();
  for (const [slug, p] of Object.entries(pages)) if (p.meta.template) byPattern.set(p.meta.pattern, slug);
  const patternOf = (u) => { try { const segs = new URL(u).pathname.split('/').filter(Boolean); return '/' + segs.map(s => (/^\d+$/.test(s) || /^[0-9a-f]{12,}$/i.test(s) || (/\d/.test(s) && s.length >= 8 && /^[A-Za-z0-9_-]+$/.test(s))) ? ':id' : s).join('/'); } catch { return null; } };

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

  // 2c. the FRONTIER — every discovered-but-not-captured URL, template-grouped.
  // Reconstructed from captured pages' linksOut + capture's over-cap hints; deterministic.
  const capturedUrlSet = new Set(byUrl.keys());
  const fro = new Map(); // url -> {url, pattern, via:Set, label}
  const noteFrontier = (rawUrl, via, label) => {
    const n = normalize(rawUrl); if (!n || capturedUrlSet.has(n)) return;
    if (!fro.has(n)) fro.set(n, { url: n, pattern: patternOf(n), via: new Set(), label: null });
    fro.get(n).via.add(via); if (label) fro.get(n).label = label;
  };
  for (const [slug, p] of Object.entries(pages)) for (const link of p.meta.linksOut || []) noteFrontier(link, slug);
  for (const h of manifest.frontierHints?.overCapNav || []) noteFrontier(h.url, 'nav', h.label);
  // group by id-pattern → merge one-segment-different patterns (same rule as capture's
  // mergeTemplateGroups) → fold prefix-sharing singles into /prefix/:slug groups →
  // overflow-fold whatever's left so the map never becomes a hairball.
  const WILD = (s) => s === ':id' || s === ':var' || s === ':slug';
  const wildNorm = (p) => p.split('/').map(s => WILD(s) ? '*' : s).join('/');
  const repByWild = new Map([...byPattern].map(([p, s]) => [wildNorm(p), s]));
  const groupsByPat = new Map();
  for (const f of fro.values()) { const k = f.pattern; if (!groupsByPat.has(k)) groupsByPat.set(k, []); groupsByPat.get(k).push(f); }
  let changed = true;
  while (changed) { // merge pass
    changed = false; const keys = [...groupsByPat.keys()];
    outer:
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i].split('/'), b = keys[j].split('/');
      if (a.length !== b.length) continue;
      let diff = -1, ok = true;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { if (diff !== -1) { ok = false; break; } diff = k; }
      if (!ok || diff === -1 || (!WILD(a[diff]) && !WILD(b[diff]))) continue;
      const merged = a.map((s, k) => k === diff ? ':var' : s).join('/');
      const items = [...groupsByPat.get(keys[i]), ...groupsByPat.get(keys[j])];
      groupsByPat.delete(keys[i]); groupsByPat.delete(keys[j]); groupsByPat.set(merged, items);
      changed = true; break outer;
    }
  }
  const singles = [];
  const frontier = []; let gi = 0;
  const pushGroup = (pattern, items) => { const viaAll = new Set(items.flatMap(i => [...i.via])); frontier.push({
    id: 'f' + (gi++), kind: 'frontier-group', pattern, count: items.length,
    urls: items.slice(0, 30).map(i => i.url), via: [...viaAll].slice(0, 6), inboundCount: viaAll.size, // inbound-from-captured (uncapped) → honest ghost sizing
    underTemplate: repByWild.get(wildNorm(pattern)) || null }); };
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

  // 3. per-page page.md (regenerated; AI section preserved)
  const navOrder = sitemap.pages.map(x => x.slug);
  const ordered = [...navOrder.filter(s => pages[s]), ...Object.keys(pages).filter(s => !navOrder.includes(s))];

  // ── 2d. Dashboard-v2 derived data (deterministic; embedded additively) ──────────
  const round1 = (x) => Math.round(x * 10) / 10;
  const rootSlug = ordered.find(s => pages[s].meta.route === '/')
    || [...ordered].sort((a, b) => pages[b].linkedFrom.length - pages[a].linkedFrom.length)[0]
    || ordered[0];
  const depths = computeDepths(pages, rootSlug);
  const tokens = aggregateTokens(pagesDir, ordered);

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
        events.push({ at: fs.statSync(rdir).mtime.toISOString(), dateOnly: false, seq: 6, actor: 'you + your AI', kind: 'wireframe',
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
        let title;
        if (stateCount === 0) title = `Guided capture — ${pg(pageCount)}`;
        else if (pageCount === 0) title = `Guided capture — ${st(stateCount)} across ${pg(statePages)}`;
        else title = `Guided capture — ${pg(pageCount)} + ${st(stateCount)}`;
        events.push({ at: s.endedAt || s.startedAt, dateOnly: false, seq: 5, actor: 'you', kind: 'guided',
          title,
          detail: null,
          detailLines: caps.map(c => c.state ? `${pageLabelOf(c.slug)} › ${c.state}` : pageLabelOf(c.slug)),
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
      // description = the ai section's FIRST paragraph (one-liner); the full screen doc stays in page.md
      description: p.description ? { text: p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(), method: 'ai', fullDoc: `pages/${slug}/page.md` } : null,
    }]; })),
    frontier: { total: frontierTotal, note: 'discovered during capture, not downloaded; select on map.html or pass to capture.js --urls', nodes: frontier },
    // additive dashboard-v2 top-level fields
    identity, readiness, events,
  };
  // guided-capture summary — strictly additive AND only present when a guided session has run, so a
  // workspace with no guided-sessions.json regenerates a byte-identical registry to before (crit #7).
  if (guidedSummary) registry.guidedSessions = guidedSummary;
  fs.writeFileSync(path.join(libDir, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  // Hygiene lint over the just-written library (optional — never breaks a build if the module is absent).
  // Especially catches what guided (human-driven) capture can introduce: dupes, orphans, dead states.
  let hygiene = null;
  try { hygiene = require('./hygiene.js').runHygiene(libDir); } catch (_) {}

  // 4b. tokens.json + dashboard.html — Map · Home · Design language (self-contained; live via tools/map.js)
  fs.writeFileSync(path.join(libDir, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf8');
  const tplPath = path.join(__dirname, 'dashboard-template.html');
  if (fs.existsSync(tplPath)) {
    const mapData = {
      product: sitemap.product, origin: sitemap.origin, generatedAt: manifest.capturedAt,
      rootSlug, sections: sectionsOrder, districts,
      nodes: ordered.map(slug => { const p = pages[slug]; const m = p.meta; return {
        id: slug, kind: m.template ? 'template' : 'page',
        label: m.navLabel || templateLabel(m) || (m.title || slug).slice(0, 40), displayLabel: displayLabelOf(slug), route: m.route,
        desc: p.description ? p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null,
        screenshot: `pages/${slug}/screenshot.png`, pageHtml: `pages/${slug}/page.html`, pageMd: `pages/${slug}/page.md`,
        capturedAt: m.capturedAt, standsFor: m.template ? m.collapsed + 1 : null,
        states: p.states, notes: p.notes, descPending: !p.description,
        inboundCount: p.linkedFrom.length, clickDepth: depths[slug], section: sectionOf(m.route),
        linksTo: p.linksTo.map(t => t.replace(' (template)', '')), linkedFrom: p.linkedFrom,
      }; }),
      frontier: frontier.map(f => ({ ...f, section: f.pattern ? sectionOf(f.pattern) : sectionOfUrl(f.url) })),
      edges: [
        ...ordered.flatMap(slug => pages[slug].linksTo.map(t => ({ a: slug, b: t.replace(' (template)', ''), kind: 'link' }))),
        ...frontier.flatMap(f => (f.underTemplate ? [f.underTemplate] : f.via.slice(0, 3)).map(v => ({ a: v, b: f.id, kind: 'frontier' }))),
      ],
    };
    const overview = {
      health: { skipped: manifest.skipped || [], failed: manifest.failed || [], actions: manifest.actions || [], capped: manifest.capped || 0 },
      nav: ordered.filter(s => !pages[s].meta.template).map(s => ({ slug: s, label: pages[s].meta.navLabel || pages[s].meta.title, route: pages[s].meta.route,
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
  const index = [
    `# ${sitemap.product} — design context library`,
    '',
    `Captured ${manifest.capturedAt.slice(0, 10)} from ${sitemap.origin} · ${ordered.length} pages · read-only scrape, provenance-stamped.`,
    '',
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
    `Skipped/failed during capture: see [manifest.json](manifest.json). Wireframes built on these pages live in \`../wireframes/\` — never inside this library.`,
  ].join('\n');
  fs.writeFileSync(path.join(libDir, 'INDEX.md'), index, 'utf8');

  return { pages: ordered.length, described: ordered.filter(s => pages[s].description).length, frontier: frontierTotal, hygiene };
}

module.exports = { buildIndex, routeKey }; // routeKey exported so the mirror test can compare both copies

if (require.main === module) {
  const libDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  const r = buildIndex(libDir);
  console.log(`✅  INDEX.md + registry.json + ${r.pages} page.md files (${r.described} described, ${r.pages - r.described} pending)`);
  try { if (r.hygiene) console.log(require('./hygiene.js').formatHygiene(r.hygiene)); } catch (_) {}
}
