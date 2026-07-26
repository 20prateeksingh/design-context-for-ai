#!/usr/bin/env node
/**
 * hygiene.js — post-capture lint over a captured library.
 *
 * The automated crawl auto-templatizes (collapses same-shape pages) and auto-wires the link
 * graph. Guided capture (human-driven) does NEITHER, so manually-added pages/states can be
 * duplicates, orphans, or bad snapshots. This pass re-applies those checks and REPORTS them —
 * it never deletes or silently merges (consistent with "templatization loud, never silent").
 *
 * Findings (each with a recommended action the designer confirms):
 *   • duplicates      — same-template pages captured as separate top-level pages, or identical content
 *   • orphans         — top-level pages with no inbound link and no "reached by" note
 *   • identicalStates — a state whose content == its base page (or a sibling state): the tab likely didn't switch
 *   • quality         — near-empty, mid-load (spinner/skeleton), blob: URLs (won't render offline), missing screenshot
 *
 * Usage:  node hygiene.js [design-context-dir]     (defaults to ../design-context)
 * API:    const { runHygiene, formatHygiene } = require('./hygiene.js')
 */

const fs = require('fs');
const path = require('path');

const NEAR_EMPTY_CHARS = 200;   // content.md shorter than this = suspiciously thin
const MIDLOAD_CHARS = 500;      // + loading markers below this = probably captured mid-render
const SPARSE_BUT_REAL = 5;      // …unless the DOM has this many controls: a real screen, just short (see below)

// Interactive elements in the captured DOM. A login screen is ~147 chars of text and a complete, working
// page — thin text alone doesn't mean "bad capture", so the near-empty flag is suppressed when the page
// carries real controls. Counted off the serialized page.html (regex, no DOM dependency — hygiene stays
// dependency-free); these are elements that were present in the rendered DOM at capture time.
const INTERACTIVE_TAG = /<(?:button|input|select|textarea|form)\b|<a\b[^>]*\shref\s*=/gi;
function interactiveCount(html) { const m = html.match(INTERACTIVE_TAG); return m ? m.length : 0; }

// blob: URLs that an offline page.html actually tries to LOAD, split by what they're loading. Text that
// merely contains "blob:" — a Content-Security-Policy meta header, inline JSON — is not a broken asset.
const ASSET_TAG = /<(img|video|audio|source|iframe)\b[^>]*>/gi;
function blobAssetRefs(html) {
  const out = { img: 0, media: 0, css: 0 };
  for (const m of html.match(ASSET_TAG) || []) {
    if (!/\s(?:src|srcset|poster)\s*=\s*["']?blob:/i.test(m)) continue;
    if (/^<img\b/i.test(m)) out.img++; else out.media++;
  }
  out.css = (html.match(/url\(\s*['"]?blob:/gi) || []).length;   // background-image: url(blob:…)
  return out;
}

// crude, dependency-free route → pattern (mirror of capture.js's intent): id-like segments → :id
const looksLikeId = (seg) =>
  /^\d+$/.test(seg) || /[0-9a-f]{8,}/i.test(seg) || /_[A-Za-z0-9]{4,}_/.test(seg) ||
  (seg.length >= 12 && /\d/.test(seg) && /[A-Za-z]/.test(seg));
function patternize(route) {
  try {
    const segs = (route || '/').split('?')[0].split('/').filter(Boolean).map(s => looksLikeId(s) ? ':id' : s.toLowerCase());
    return '/' + segs.join('/');
  } catch { return route || '/'; }
}

// "a and b" / "a, b and c" — the finding names the pages inside its own sentence.
function andList(items) { return items.length < 2 ? (items[0] || '') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function fileText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }

// Walk pages/<slug>/states/<name>/ and return [{slug, name, dir, meta}]
function collectStates(pagesDir, slug) {
  const statesDir = path.join(pagesDir, slug, 'states');
  if (!fs.existsSync(statesDir)) return [];
  return fs.readdirSync(statesDir)
    .filter(n => fs.statSync(path.join(statesDir, n)).isDirectory())
    .map(name => {
      const dir = path.join(statesDir, name);
      return { slug, name, dir, meta: readJSON(path.join(dir, 'meta.json')) || {} };
    });
}

function qualityChecks(dir, label) {
  const out = [];
  const html = fileText(path.join(dir, 'page.html'));
  const content = fileText(path.join(dir, 'content.md'));
  const contentBody = content.replace(/^#.*$/m, '').replace(/^Source:.*$/m, '').trim();
  if (!fileSize(path.join(dir, 'screenshot.png'))) out.push({ kind: 'quality', severity: 'warn', target: label, issue: 'missing or empty screenshot', action: 're-capture' });
  // Near-empty = thin text AND nothing to interact with. Sparse-but-real screens (login, empty states) have
  // few words and plenty of controls — flagging those was crying wolf on healthy captures.
  if (contentBody.length < NEAR_EMPTY_CHARS && interactiveCount(html) < SPARSE_BUT_REAL)
    out.push({ kind: 'quality', severity: 'warn', target: label, issue: `near-empty content (${contentBody.length} chars)`, action: 'confirm this state has real content, or re-capture' });
  // blob: in an ASSET-REFERENCE position only. A page whose CSP header merely mentions `blob:` (Pinterest,
  // Amazon) has nothing broken in it — the old any-occurrence match flagged those pages forever with an
  // action that couldn't help. Images are the actionable case: capture resolves them in page context, so a
  // leftover one was revoked or oversized (`data-dck-blob` marks what we tried). Video/audio streams are
  // live-only by nature — a snapshot can never carry them, so that's information, not a defect.
  const blob = blobAssetRefs(html);
  if (blob.img || blob.css) {
    const tried = /data-dck-blob=/.test(html);
    out.push({ kind: 'quality', severity: 'warn', target: label,
      issue: `${blob.img + blob.css} blob: image reference(s) — those images won't render offline${tried ? ' (capture tried to inline them; the browser had already dropped them)' : ''}`,
      action: 're-capture (blob images inline while the tab is live; a revoked one only comes back with a fresh capture)' });
  }
  if (blob.media) out.push({ kind: 'quality', severity: 'info', target: label,
    issue: `${blob.media} video/audio element(s) stream from a live-only blob: URL — a snapshot can't carry video`,
    action: 'nothing to do — the poster frame is what the baseline shows' });
  if (contentBody.length < MIDLOAD_CHARS && /role="progressbar"|class="[^"]*(skeleton|shimmer|spinner|loading)/i.test(html))
    out.push({ kind: 'quality', severity: 'warn', target: label, issue: 'loading markers + thin content — possibly captured mid-render', action: 'wait for load, re-capture' });
  return out;
}

function runHygiene(outDir) {
  outDir = outDir || path.join(__dirname, '..', 'design-context');
  const pagesDir = path.join(outDir, 'pages');
  const registry = readJSON(path.join(outDir, 'registry.json'));
  const findings = { duplicates: [], orphans: [], identicalStates: [], quality: [] };
  if (!registry || !registry.pages) { findings.error = 'no registry.json — run build-index first'; return findings; }
  const pages = registry.pages;
  const slugs = Object.keys(pages);

  // 1. DUPLICATES — same content captured twice under different routes, and same-template-not-collapsed.
  // The comparison is EXACT contentHash equality: two routes that serve the same page (a landing reachable
  // as both `/` and `/homepage`) burn two slots and show as two map nodes. Near-equal is deliberately NOT
  // compared — a "looks similar" heuristic breeds false positives, and hygiene's standing rule is report +
  // recommend, never delete: the designer decides which one to keep.
  const byHash = {};
  for (const s of slugs) { const h = pages[s].contentHash; if (!h) continue; (byHash[h] = byHash[h] || []).push(s); }
  for (const [h, group] of Object.entries(byHash)) {
    if (group.length > 1) findings.duplicates.push({ kind: 'duplicate-content', severity: 'warn', pages: group, contentHash: h,
      issue: `duplicate content: ${andList(group)} capture the same page`, action: 'consider removing one' });
  }
  const templatePatterns = new Set(slugs.filter(s => pages[s].template).map(s => pages[s].template.pattern));
  const byPattern = {};
  for (const s of slugs) {
    if (pages[s].template) continue;               // already a collapsed representative
    const pat = patternize(pages[s].route);
    (byPattern[pat] = byPattern[pat] || []).push(s);
  }
  for (const [pat, group] of Object.entries(byPattern)) {
    if (!pat.includes(':id')) continue;            // only dynamic patterns are template candidates
    if (templatePatterns.has(pat) || group.length > 1)
      findings.duplicates.push({ kind: 'same-template', severity: 'warn', pages: group, pattern: pat,
        issue: templatePatterns.has(pat)
          ? `${group.length} page(s) match existing template ${pat} but sit as standalone pages`
          : `${group.length} pages share the dynamic pattern ${pat} (same layout, not collapsed)`,
        action: 'fold into one representative (standsFor +N), or justify keeping each' });
  }

  // 2. ORPHANS — top-level pages nothing links to, with no "reached by" note
  for (const s of slugs) {
    const p = pages[s];
    if (p.route === '/' ) continue;                                  // home is the root, not an orphan
    const inbound = (p.linkedFrom || []).length;
    if (inbound > 0) continue;
    const meta = readJSON(path.join(pagesDir, s, 'meta.json')) || {};
    const explained = !!meta.reachedBy || meta.method === 'guided';
    findings.orphans.push({ kind: 'orphan', severity: explained ? 'info' : 'warn', page: s, route: p.route,
      issue: explained ? 'no inbound link (reached by interaction — explained)' : 'no inbound link from any captured page, and no "reached by" note',
      action: explained ? 'ok — shows on the map as an interaction-only node' : 'add a reached-by note (how you got there), or link it from its parent page' });
  }

  // 3. IDENTICAL STATES — a state whose content == base page or a sibling (tab likely didn't switch)
  for (const s of slugs) {
    const baseHash = pages[s].contentHash;
    const states = collectStates(pagesDir, s);
    const seen = {};
    for (const st of states) {
      const h = st.meta.contentHash;
      if (!h) continue;
      if (h === baseHash) findings.identicalStates.push({ kind: 'identical-state', severity: 'warn', page: s, state: st.name,
        issue: `state "${st.name}" is identical to the base page — the tab/state likely didn't change`, action: 'verify the deep-link/interaction switched the view; re-capture' });
      else if (seen[h]) findings.identicalStates.push({ kind: 'identical-state', severity: 'warn', page: s, state: st.name,
        issue: `state "${st.name}" is identical to state "${seen[h]}"`, action: 'these two states are the same — keep one' });
      else seen[h] = st.name;
    }
  }

  // 4. QUALITY — over every page and state artifact
  for (const s of slugs) {
    findings.quality.push(...qualityChecks(path.join(pagesDir, s), s));
    for (const st of collectStates(pagesDir, s)) findings.quality.push(...qualityChecks(st.dir, `${s} › ${st.name}`));
  }

  return findings;
}

// One line for a duplicates-section finding. duplicate-content already names its pages in the sentence
// ("duplicate content: home and homepage capture the same page"), so it isn't prefixed with them again.
// capture.js's flattenHygiene mirrors this — keep the two in step.
function renderDuplicate(it) {
  return it.kind === 'duplicate-content' ? it.issue : `${(it.pages || []).join(', ')} — ${it.issue}`;
}

function formatHygiene(f) {
  if (f.error) return `\n🔎 Hygiene: ${f.error}`;
  const total = f.duplicates.length + f.orphans.length + f.identicalStates.length + f.quality.length;
  const warns = [...f.duplicates, ...f.orphans, ...f.identicalStates, ...f.quality].filter(x => x.severity === 'warn').length;
  if (total === 0) return `\n🔎 Hygiene: clean — no duplicates, orphans, identical states, or quality flags.`;
  const lines = [`\n🔎 Hygiene report — ${warns} to review${total > warns ? `, ${total - warns} info` : ''} (nothing changed; confirm each):`];
  const section = (title, items, render) => { if (!items.length) return; lines.push(`\n  ${title} (${items.length}):`); for (const it of items) lines.push(`   • ${render(it)}  → ${it.action}`); };
  section('Duplicates / same-template', f.duplicates, renderDuplicate);
  section('Orphans (not linked into the map)', f.orphans, it => `${it.page} (${it.route}) — ${it.issue}`);
  section('Identical states', f.identicalStates, it => `${it.page} › ${it.state} — ${it.issue}`);
  section('Capture quality', f.quality, it => `${it.target} — ${it.issue}`);
  return lines.join('\n');
}

module.exports = { runHygiene, formatHygiene, renderDuplicate };

if (require.main === module) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  console.log(formatHygiene(runHygiene(outDir)));
}
