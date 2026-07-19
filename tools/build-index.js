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

  // 2. link graph among captured pages: exact URL match, then template-pattern match
  const byUrl = new Map();
  for (const [slug, p] of Object.entries(pages)) { byUrl.set(normalize(p.meta.url), slug); byUrl.set(normalize(p.meta.finalUrl), slug); }
  const byPattern = new Map();
  for (const [slug, p] of Object.entries(pages)) if (p.meta.template) byPattern.set(p.meta.pattern, slug);
  const patternOf = (u) => { try { const segs = new URL(u).pathname.split('/').filter(Boolean); return '/' + segs.map(s => (/^\d+$/.test(s) || /^[0-9a-f]{12,}$/i.test(s) || (/\d/.test(s) && s.length >= 8 && /^[A-Za-z0-9_-]+$/.test(s))) ? ':id' : s).join('/'); } catch { return null; } };

  for (const [slug, p] of Object.entries(pages)) {
    const to = new Set();
    for (const link of p.meta.linksOut || []) {
      const n = normalize(link);
      if (byUrl.has(n) && byUrl.get(n) !== slug) { to.add(byUrl.get(n)); continue; }
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
  const pushGroup = (pattern, items) => frontier.push({
    id: 'f' + (gi++), kind: 'frontier-group', pattern, count: items.length,
    urls: items.slice(0, 30).map(i => i.url), via: [...new Set(items.flatMap(i => [...i.via]))].slice(0, 6),
    underTemplate: repByWild.get(wildNorm(pattern)) || null });
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
    url: f.url, urls: [f.url], label: f.label, via: [...f.via].slice(0, 6), underTemplate: repByWild.get(wildNorm(f.pattern)) || null }));
  if (leftover.length > MAX_SINGLES) pushGroup('(assorted one-off pages)', leftover.slice(MAX_SINGLES));
  const frontierTotal = [...fro.values()].length;

  // 3. per-page page.md (regenerated; AI section preserved)
  const navOrder = sitemap.pages.map(x => x.slug);
  const ordered = [...navOrder.filter(s => pages[s]), ...Object.keys(pages).filter(s => !navOrder.includes(s))];
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
      `# ${m.navLabel || m.title || slug}`,
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
      route: m.route, url: m.finalUrl, label: m.navLabel || null, title: m.title || null,
      template: m.template ? { pattern: m.pattern, standsFor: m.collapsed + 1 } : null,
      files: { pageMd: `pages/${slug}/page.md`, screenshot: `pages/${slug}/screenshot.png`, html: `pages/${slug}/page.html`, content: `pages/${slug}/content.md`, tokens: `pages/${slug}/computed-tokens.json`, meta: `pages/${slug}/meta.json` },
      linksTo: p.linksTo, linkedFrom: p.linkedFrom, contentHash: m.contentHash,
      states: p.states, designerNotes: p.notes,
      // description = the ai section's FIRST paragraph (one-liner); the full screen doc stays in page.md
      description: p.description ? { text: p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(), method: 'ai', fullDoc: `pages/${slug}/page.md` } : null,
    }]; })),
    frontier: { total: frontierTotal, note: 'discovered during capture, not downloaded; select on map.html or pass to capture.js --urls', nodes: frontier },
  };
  fs.writeFileSync(path.join(libDir, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  // 4b. tokens.json + dashboard.html — Map · Overview · Design Tokens (self-contained; live via tools/map.js)
  const tokens = aggregateTokens(pagesDir, ordered);
  fs.writeFileSync(path.join(libDir, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf8');
  const tplPath = path.join(__dirname, 'dashboard-template.html');
  if (fs.existsSync(tplPath)) {
    const mapData = {
      product: sitemap.product, origin: sitemap.origin, generatedAt: manifest.capturedAt,
      nodes: ordered.map(slug => { const p = pages[slug]; const m = p.meta; return {
        id: slug, kind: m.template ? 'template' : 'page',
        label: m.navLabel || (m.title || slug).slice(0, 40), route: m.route,
        desc: p.description ? p.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null,
        screenshot: `pages/${slug}/screenshot.png`, pageHtml: `pages/${slug}/page.html`, pageMd: `pages/${slug}/page.md`,
        capturedAt: m.capturedAt, standsFor: m.template ? m.collapsed + 1 : null,
        states: p.states, notes: p.notes,
      }; }),
      frontier,
      edges: [
        ...ordered.flatMap(slug => pages[slug].linksTo.map(t => ({ a: slug, b: t.replace(' (template)', ''), kind: 'link' }))),
        ...frontier.flatMap(f => (f.underTemplate ? [f.underTemplate] : f.via.slice(0, 3)).map(v => ({ a: v, b: f.id, kind: 'frontier' }))),
      ],
    };
    const overview = {
      health: { skipped: manifest.skipped || [], failed: manifest.failed || [], actions: manifest.actions || [], capped: manifest.capped || 0 },
      nav: ordered.filter(s => !pages[s].meta.template).map(s => ({ slug: s, label: pages[s].meta.navLabel || pages[s].meta.title, route: pages[s].meta.route,
        desc: pages[s].description ? pages[s].description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null })),
      templates: ordered.filter(s => pages[s].meta.template).map(s => ({ slug: s, pattern: pages[s].meta.pattern, standsFor: pages[s].meta.collapsed + 1,
        screenshot: `pages/${s}/screenshot.png`, desc: pages[s].description ? pages[s].description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : null })),
      recent: ordered.map(s => ({ slug: s, label: pages[s].meta.navLabel || pages[s].meta.title || s, at: pages[s].meta.capturedAt }))
        .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8),
      statesTotal: ordered.reduce((n, s) => n + pages[s].states.filter(x => x.captured).length, 0),
      notes: ordered.filter(s => pages[s].notes).map(s => ({ slug: s, notes: pages[s].notes })),
      standsForTotal: ordered.reduce((n, s) => n + (pages[s].meta.template ? pages[s].meta.collapsed + 1 : 1), 0),
    };
    const dash = { map: mapData, overview, tokens: { ...tokens, raw: undefined } }; // raw stays in tokens.json, not the page
    const html = fs.readFileSync(tplPath, 'utf8')
      .replace('/*__DASHDATA__*/null', JSON.stringify(dash).replace(/</g, '\\u003c'));
    fs.writeFileSync(path.join(libDir, 'dashboard.html'), html, 'utf8');
    const stale = path.join(libDir, 'map.html'); if (fs.existsSync(stale)) fs.unlinkSync(stale); // superseded
  }

  // 5. INDEX.md — the human front door
  const line = (slug) => { const p = pages[slug]; const m = p.meta;
    const desc = p.description ? p.description.split(/(?<=\.)\s/)[0].replace(/\|/g, '\\|') : '_pending_';
    const tpl = m.template ? ` ⧉×${m.collapsed + 1}` : '';
    return `| **${m.navLabel || m.title || slug}**${tpl} | \`${m.route}\` | ${desc} | [📸](pages/${slug}/screenshot.png) [HTML](pages/${slug}/page.html) [MD](pages/${slug}/page.md) |`; };
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

  return { pages: ordered.length, described: ordered.filter(s => pages[s].description).length, frontier: frontierTotal };
}

module.exports = { buildIndex };

if (require.main === module) {
  const libDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  const r = buildIndex(libDir);
  console.log(`✅  INDEX.md + registry.json + ${r.pages} page.md files (${r.described} described, ${r.pages - r.described} pending)`);
}
