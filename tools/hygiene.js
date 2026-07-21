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
  if (contentBody.length < NEAR_EMPTY_CHARS) out.push({ kind: 'quality', severity: 'warn', target: label, issue: `near-empty content (${contentBody.length} chars)`, action: 'confirm this state has real content, or re-capture' });
  if (/\bblob:/.test(html)) out.push({ kind: 'quality', severity: 'warn', target: label, issue: 'contains blob: URLs (won\'t render offline)', action: 're-capture; blob assets don\'t inline' });
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

  // 1. DUPLICATES — identical content across top-level pages, and same-template-not-collapsed
  const byHash = {};
  for (const s of slugs) { const h = pages[s].contentHash; if (!h) continue; (byHash[h] = byHash[h] || []).push(s); }
  for (const [h, group] of Object.entries(byHash)) {
    if (group.length > 1) findings.duplicates.push({ kind: 'duplicate-content', severity: 'warn', pages: group,
      issue: `identical content (hash ${h}) across ${group.length} pages`, action: 'keep one representative; drop or fold the rest' });
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

function formatHygiene(f) {
  if (f.error) return `\n🔎 Hygiene: ${f.error}`;
  const total = f.duplicates.length + f.orphans.length + f.identicalStates.length + f.quality.length;
  const warns = [...f.duplicates, ...f.orphans, ...f.identicalStates, ...f.quality].filter(x => x.severity === 'warn').length;
  if (total === 0) return `\n🔎 Hygiene: clean — no duplicates, orphans, identical states, or quality flags.`;
  const lines = [`\n🔎 Hygiene report — ${warns} to review${total > warns ? `, ${total - warns} info` : ''} (nothing changed; confirm each):`];
  const section = (title, items, render) => { if (!items.length) return; lines.push(`\n  ${title} (${items.length}):`); for (const it of items) lines.push(`   • ${render(it)}  → ${it.action}`); };
  section('Duplicates / same-template', f.duplicates, it => `${(it.pages || []).join(', ')} — ${it.issue}`);
  section('Orphans (not linked into the map)', f.orphans, it => `${it.page} (${it.route}) — ${it.issue}`);
  section('Identical states', f.identicalStates, it => `${it.page} › ${it.state} — ${it.issue}`);
  section('Capture quality', f.quality, it => `${it.target} — ${it.issue}`);
  return lines.join('\n');
}

module.exports = { runHygiene, formatHygiene };

if (require.main === module) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  console.log(formatHygiene(runHygiene(outDir)));
}
