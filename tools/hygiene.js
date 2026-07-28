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
const { extractPathRefs, expectedAbsentReason } = require('./path-refs.js');

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

// F1: stable finding keys — kind + its stable identity, so the SAME finding gets the SAME key on
// every run over an unchanged library (gate: two runs on unchanged flipkart → identical key sets).
// Built from sorted page slugs / pattern / contentHash / slug/state / quality target — never from
// array order, timestamps, or anything build-twice could vary.
const sortedJoin = (arr) => arr.slice().sort().join(',');
function makeKey(kind, ...parts) { return [kind, ...parts].join('::'); }

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
  const push = (subKind, severity, issue, action) =>
    out.push({ kind: 'quality', subKind, severity, target: label, issue, action, key: makeKey('quality', subKind, label) });
  if (!fileSize(path.join(dir, 'screenshot.png'))) push('missing-screenshot', 'warn', 'missing or empty screenshot', 're-capture');
  // Near-empty = thin text AND nothing to interact with. Sparse-but-real screens (login, empty states) have
  // few words and plenty of controls — flagging those was crying wolf on healthy captures.
  if (contentBody.length < NEAR_EMPTY_CHARS && interactiveCount(html) < SPARSE_BUT_REAL)
    push('near-empty', 'warn', `near-empty content (${contentBody.length} chars)`, 'confirm this state has real content, or re-capture');
  // blob: in an ASSET-REFERENCE position only. A page whose CSP header merely mentions `blob:` (Pinterest,
  // Amazon) has nothing broken in it — the old any-occurrence match flagged those pages forever with an
  // action that couldn't help. Images are the actionable case: capture resolves them in page context, so a
  // leftover one was revoked or oversized (`data-dck-blob` marks what we tried). Video/audio streams are
  // live-only by nature — a snapshot can never carry them, so that's information, not a defect.
  const blob = blobAssetRefs(html);
  if (blob.img || blob.css) {
    const tried = /data-dck-blob=/.test(html);
    push('blob-images', 'warn',
      `${blob.img + blob.css} blob: image reference(s) — those images won't render offline${tried ? ' (capture tried to inline them; the browser had already dropped them)' : ''}`,
      're-capture (blob images inline while the tab is live; a revoked one only comes back with a fresh capture)');
  }
  if (blob.media) push('live-only-media', 'info',
    `${blob.media} video/audio element(s) stream from a live-only blob: URL — a snapshot can't carry video`,
    'nothing to do — the poster frame is what the baseline shows');
  if (contentBody.length < MIDLOAD_CHARS && /role="progressbar"|class="[^"]*(skeleton|shimmer|spinner|loading)/i.test(html))
    push('mid-render', 'warn', 'loading markers + thin content — possibly captured mid-render', 'wait for load, re-capture');
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
  const ann = readJSON(path.join(outDir, 'annotations.json'));

  // 1. DUPLICATES — same content captured twice under different routes, and same-template-not-collapsed.
  // The comparison is EXACT contentHash equality: two routes that serve the same page (a landing reachable
  // as both `/` and `/homepage`) burn two slots and show as two map nodes. Near-equal is deliberately NOT
  // compared — a "looks similar" heuristic breeds false positives, and hygiene's standing rule is report +
  // recommend, never delete: the designer decides which one to keep.
  const byHash = {};
  for (const s of slugs) { const h = pages[s].contentHash; if (!h) continue; (byHash[h] = byHash[h] || []).push(s); }
  for (const [h, group] of Object.entries(byHash)) {
    if (group.length > 1) {
      // F4 wiring: a suggested rep/members split for the "Fold into one" button — no existing
      // representative here (exact-duplicate content, not a template collapse), so the earliest-captured
      // (stable sort) page is offered as the keeper; the rest fold into it.
      const sorted = group.slice().sort();
      findings.duplicates.push({ kind: 'duplicate-content', severity: 'warn', pages: group, contentHash: h,
        issue: `duplicate content: ${andList(group)} capture the same page`, action: 'consider removing one',
        repSlug: sorted[0], members: sorted.slice(1),
        key: makeKey('duplicate-content', h, sortedJoin(group)) });
    }
  }
  // host, normalized like build-index.js's routeKey (www. stripped) — a multi-domain workspace (e.g. an
  // Amazon capture that also follows a link out to primevideo.com) can have two totally unrelated pages
  // share a literal path ("/" is both sites' homepage); patternize()/route are host-less, so conditions
  // (b)/(c) below are scoped per-host to avoid flagging two different products as "the same layout."
  const hostOf = (u) => { try { return new URL(u).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  const repSlugByHost = new Map(); // host -> Map(pattern -> representative slug)
  for (const s of slugs) if (pages[s].template) {
    const h = hostOf(pages[s].url);
    if (!repSlugByHost.has(h)) repSlugByHost.set(h, new Map());
    repSlugByHost.get(h).set(pages[s].template.pattern, s);
  }
  const byPattern = {};
  for (const s of slugs) {
    // F1: a fold and a capture-time collapse must be indistinguishable here — pages[s].template marks
    // the former (auto-collapsed at capture), pages[s].foldedInto marks the latter (a designer's later
    // fold decision, derived by build-index.js). Without the second check, a folded member kept
    // re-entering byPattern and re-reporting the exact finding the fold was performed to answer.
    if (pages[s].template || pages[s].foldedInto) continue;
    const pat = patternize(pages[s].route);
    (byPattern[pat] = byPattern[pat] || []).push(s);
  }
  // F2: close the same-template gap — a query-param template (no `:id` in the path) used to be
  // invisible here entirely (the old `if (!pat.includes(':id')) continue` skipped it outright), so a
  // standalone page sitting on the exact same route as a collapsed representative never fired. A
  // standalone group is now in scope when EITHER (a) its pattern looks dynamic (`:id`, unchanged), OR
  // (b) its literal pattern already matches an existing representative's template.pattern regardless of
  // shape, OR (c) ≥2 standalone pages share that identical literal route with at least one differing
  // contentHash — an all-identical-hash group is already fully reported by duplicate-content above, so
  // it's excluded here to avoid double-reporting the same pair under both kinds.
  for (const [pat, group] of Object.entries(byPattern)) {
    const isDynamic = pat.includes(':id');
    const byHost = new Map();
    for (const s of group) { const h = hostOf(pages[s].url); if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(s); }
    for (const [host, hgroup] of byHost) {
      const rep = (repSlugByHost.get(host) || new Map()).get(pat) || null;
      const matchesRep = !!rep;
      if (!isDynamic && !matchesRep) {
        const hashes = new Set(hgroup.map(s => pages[s].contentHash).filter(Boolean));
        if (!(hgroup.length > 1 && hashes.size > 1)) continue;
      }
      if (matchesRep || hgroup.length > 1) {
        // F4 wiring: matchesRep folds the standalone group into the EXISTING representative; otherwise
        // (a fresh dynamic/literal-route group with no representative yet) the earliest slug (stable
        // sort) is offered as the new representative and the rest fold into it.
        const sortedGroup = hgroup.slice().sort();
        findings.duplicates.push({ kind: 'same-template', severity: 'warn', pages: hgroup, pattern: pat, matchesRep,
          issue: matchesRep
            ? `${hgroup.length} page(s) match existing template ${pat} but sit as standalone pages`
            : `${hgroup.length} pages share the dynamic pattern ${pat} (same layout, not collapsed)`,
          action: 'fold into one representative (standsFor +N), or justify keeping each',
          repSlug: matchesRep ? rep : sortedGroup[0],
          members: matchesRep ? hgroup : sortedGroup.slice(1),
          key: makeKey('same-template', pat, sortedJoin(hgroup)) });
      }
    }
  }

  // 2. ORPHANS — top-level pages nothing links to, with no "reached by" note
  for (const s of slugs) {
    const p = pages[s];
    if (p.route === '/' ) continue;                                  // home is the root, not an orphan
    const inbound = (p.linkedFrom || []).length;
    if (inbound > 0) continue;
    const meta = readJSON(path.join(pagesDir, s, 'meta.json')) || {};
    const annReachedBy = ann && ann.pages && ann.pages[s] && ann.pages[s].reachedBy; // F4 wiring: an annotation-recorded reachedBy explains the orphan exactly like a meta one
    const explained = !!meta.reachedBy || !!annReachedBy || meta.method === 'guided';
    findings.orphans.push({ kind: 'orphan', severity: explained ? 'info' : 'warn', page: s, route: p.route,
      issue: explained ? 'no inbound link (reached by interaction — explained)' : 'no inbound link from any captured page, and no "reached by" note',
      action: explained ? 'ok — shows on the map as an interaction-only node' : 'add a reached-by note (how you got there), or link it from its parent page',
      key: makeKey('orphan', s) });
  }

  // 3. IDENTICAL STATES — a state whose content == base page or a sibling (tab likely didn't switch)
  for (const s of slugs) {
    const baseHash = pages[s].contentHash;
    const states = collectStates(pagesDir, s);
    const seen = {};
    for (const st of states) {
      const h = st.meta.contentHash;
      if (!h) continue;
      if (h === baseHash) findings.identicalStates.push({ kind: 'identical-state', variant: 'vs-base', severity: 'warn', page: s, state: st.name,
        issue: `state "${st.name}" is identical to the base page — the tab/state likely didn't change`, action: 'verify the deep-link/interaction switched the view; re-capture',
        key: makeKey('identical-state', `${s}/${st.name}`) });
      else if (seen[h]) findings.identicalStates.push({ kind: 'identical-state', variant: 'vs-sibling', severity: 'warn', page: s, state: st.name, sibling: seen[h],
        issue: `state "${st.name}" is identical to state "${seen[h]}"`, action: 'these two states are the same — keep one',
        key: makeKey('identical-state', `${s}/${st.name}`) });
      else seen[h] = st.name;
    }
  }

  // 4. QUALITY — over every page and state artifact
  for (const s of slugs) {
    findings.quality.push(...qualityChecks(path.join(pagesDir, s), s));
    for (const st of collectStates(pagesDir, s)) findings.quality.push(...qualityChecks(st.dir, `${s} › ${st.name}`));
  }

  // 5. E14: path-resolution check — the same backtick-path resolver E13's test-prompts.js uses, run
  // here over the WORKSPACE's own CLAUDE.md/AGENTS.md (not the package template). Unlike test-prompts.js's
  // canonical-shape check (run before any real capture exists), this runs post-capture, so
  // design-context/... paths already exist for real — a plain existence check is enough. Info-level:
  // a stale doc shouldn't block a build (this is exactly F1's bug class, caught here if it recurs).
  const workspaceRoot = path.join(outDir, '..');
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const text = fileText(path.join(workspaceRoot, file));
    if (!text) continue;
    for (const ref of extractPathRefs(text)) {
      if (fs.existsSync(path.join(workspaceRoot, ref))) continue;
      // F4: designer-owned, appears-later files (annotations.json, product.json, ux-copy.md) are
      // referenced conditionally ("if it exists") by design — a pristine workspace hasn't created them
      // yet, and that's correct, not broken. Only a genuinely bad reference still fires below.
      if (expectedAbsentReason(ref)) continue;
      findings.quality.push({
        kind: 'quality', subKind: 'broken-path-ref', severity: 'info', target: file,
        issue: `${file} references \`${ref}\`, which doesn't exist in this workspace`,
        action: 'fix or remove the reference, or re-copy from the template',
        key: makeKey('broken-path-ref', file, ref),
      });
    }
  }

  // F1: acknowledgments — designer-owned, live in annotations.json (`hygiene.acks`), survive every
  // rebuild. Hygiene still FINDS acked findings (never silently un-finds — an ack is a note, not a
  // suppression of fact); it only marks them so the ledger card and terminal tail can set them aside.
  const acks = (ann && ann.hygiene && ann.hygiene.acks) || {};
  for (const arr of [findings.duplicates, findings.orphans, findings.identicalStates, findings.quality]) {
    for (const it of arr) {
      const a = acks[it.key];
      if (a) { it.acknowledged = true; if (a.note) it.ackNote = a.note; }
    }
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
  const all = [...f.duplicates, ...f.orphans, ...f.identicalStates, ...f.quality];
  const ackedCount = all.filter(x => x.acknowledged).length;
  // F1: acked findings drop out of the per-section listing (they were reviewed and kept on purpose)
  // but are never un-found — they fold into one tail line instead of vanishing silently.
  const unacked = all.filter(x => !x.acknowledged);
  const total = unacked.length;
  const warns = unacked.filter(x => x.severity === 'warn').length;
  const ackedTail = ackedCount ? `\n  ${ackedCount} kept on purpose (noted).` : '';
  if (total === 0) return ackedCount
    ? `\n🔎 Hygiene: clean — no duplicates, orphans, identical states, or quality flags.${ackedTail}`
    : `\n🔎 Hygiene: clean — no duplicates, orphans, identical states, or quality flags.`;
  const lines = [`\n🔎 Hygiene report — ${warns} to review${total > warns ? `, ${total - warns} info` : ''} (nothing changed; confirm each):`];
  const section = (title, items, render) => { const shown = items.filter(x => !x.acknowledged); if (!shown.length) return; lines.push(`\n  ${title} (${shown.length}):`); for (const it of shown) lines.push(`   • ${render(it)}  → ${it.action}`); };
  section('Duplicates / same-template', f.duplicates, renderDuplicate);
  section('Orphans (not linked into the map)', f.orphans, it => `${it.page} (${it.route}) — ${it.issue}`);
  section('Identical states', f.identicalStates, it => `${it.page} › ${it.state} — ${it.issue}`);
  section('Capture quality', f.quality, it => `${it.target} — ${it.issue}`);
  if (ackedTail) lines.push(ackedTail);
  return lines.join('\n');
}

// F2: stale-ack repair — a fresh same-template group (no pre-existing representative) keys itself with
// EVERY member's slug, the soon-to-be rep included (matchesRep is false at finding time). The instant a
// fold records that same rep+members, matchesRep flips true and the rep permanently drops out of the
// group hygiene ever re-collects (F1, above, also now excludes every folded member outright) — so an ack
// stored under the "rep included" key can never be matched again, on any future run. Detect that exact
// shape per recorded fold and drop it; no other ack is touched.
function pruneStaleAcks(ann) {
  const folds = (ann && ann.hygiene && Array.isArray(ann.hygiene.folds)) ? ann.hygiene.folds : [];
  const acks = (ann && ann.hygiene && ann.hygiene.acks) || {};
  const removed = [];
  for (const fold of folds) {
    if (!fold.rep || !Array.isArray(fold.members) || !fold.members.length) continue;
    const staleKey = makeKey('same-template', fold.pattern || '', sortedJoin([fold.rep, ...fold.members]));
    if (Object.prototype.hasOwnProperty.call(acks, staleKey)) { delete acks[staleKey]; removed.push(staleKey); }
  }
  return removed;
}

module.exports = { runHygiene, formatHygiene, renderDuplicate, makeKey, sortedJoin, pruneStaleAcks };

if (require.main === module) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'design-context');
  console.log(formatHygiene(runHygiene(outDir)));
}
