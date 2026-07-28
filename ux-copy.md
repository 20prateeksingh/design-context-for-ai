# UX copy canon

Locked, designer-facing strings shipped in the dashboard and terminal report. Change one, review the
build brief that introduced it; this file is the single source of truth for exact wording.

## 2026-07-28 — hygiene-speaks-designer (F4: the ledger card)

**Card title** (`#hygcard`, top of the working ledger):
- warn &gt; 0: `Worth a look — N thing${N===1?'':'s'} in the library`
- clean: `Library check — all clean`

**Per-finding line** (`‹A›`/`‹B›` = page display labels, never slugs):

| Finding | Line (locked) |
|---|---|
| same-template (vs rep) | `‹A› uses the same layout as ‹B› — one example can stand for both.` |
| same-template (group, no rep) | `‹A›, ‹B›… share one layout — one example can stand for all of them.` |
| duplicate-content | `‹A› and ‹B› are the same capture twice.` |
| orphan (warn) | `Nothing links to ‹A› — the map can't show how you reach it.` |
| identical-state (vs base) | `The state "‹name›" on ‹A› looks identical to the page itself — the click may not have changed anything.` |
| identical-state (vs sibling) | `"‹n1›" and "‹n2›" on ‹A› are the same view captured twice.` |
| quality: near-empty | `‹A› came back nearly empty — it may have been captured mid-load.` |
| quality: blob images | `Some images on ‹A› were live-only and didn't survive the capture.` |
| quality: missing screenshot | `‹A› has no screenshot.` |
| quality: mid-render | `‹A› may have been captured while still loading.` |

**Buttons:**
- Primary: `Fold into one example` · `Fold into one` · `Say how you got there` · `Re-capture` · `Re-capture it`
- Secondary: `Keep both` · `Keep them all` · `Keep as is` · `It's fine — keep it` · `It really looks like this`
- Tertiary (every warning): `Copy the fix prompt`

**Note-input placeholders:**
- Keep-note (optional): `Why keep it? (optional — your AI reads this)`
- Reached-by (required): `e.g. from the account menu`

**Info-level footer** (collapsed, no buttons): `N more note${N===1?'':'s'} — nothing needed from you`

**file:// / no-server degradation** (POST-backed buttons hidden, `Copy the fix prompt` remains):
`Fixes need the kit's server — run tools/start.sh`

**Terminal report tail** (F1 — acked findings never vanish, they fold into one line):
`N kept on purpose (noted).`

## 2026-07-28 — readability fix train (E1–E17)

`prds/readability-fix-train.md`, off `prds/ai-readability-experiment-REPORT.md` (Fable-vetted). Every shipped `PROMPTS.*` string now carries a stable ID, canon `prds/use-it-layer.md` Appendix A.1–A.7 plus A.8–A.10 (established by earlier builds) and new A.11 (`askQuestion`, never previously numbered). Changed prompt bodies below are a canon change; unlisted IDs (A.1, A.3, A.4, A.5, A.9, A.10) are unchanged, verbatim.

**A.6 `recaptureCheck`** (E1 — was hard-coded to a wizard-only file, broken on any CLI-captured library):
`The product may have changed. Re-run the capture with the same settings as last time — use \`design-context/product.json\` if it exists, otherwise read the parameters recorded in \`design-context/manifest.json\` and rebuild the command from those. Then compare \`contentHash\` changes in \`design-context/registry.json\` and tell me which pages changed and whether their descriptions need updating.`
> Superseded (struck 2026-07-28): `The product may have changed. Re-run \`node tools/capture.js --config design-context/product.json\`, then compare \`contentHash\` changes in \`design-context/registry.json\` and tell me which pages changed and whether their descriptions need updating.`

**A.2 `wireframe`** (E7 — prepended the registry-first clause the surface was missing):
`Read \`design-context/registry.json\` for the shape of this product, then \`design-context/pages/<slug>/page.md\` and its \`screenshot.png\` for the page itself. I want to explore: ‹describe your change›. Per \`skills/wireframe-on-snapshot/SKILL.md\`: work on COPIES in \`wireframes/<slug>/round-1/\` (never edit \`design-context/\`), keep the product's real shell, make 2–3 genuinely different approaches, new elements visibly lo-fi, then render previews with \`node tools/shot.js\`.`

**A.7 `bootstrap`** (E4 — `INDEX.md` replaced by `registry.json` as the entry file, matching the other three surfaces):
`You're in a designer's workspace. Read \`AGENTS.md\` first and follow its five rules. Then read \`design-context/registry.json\` to learn this product, and ask me what I want to work on.`

**A.8 `designNew`** (E10 — the `‹concept›` placeholder made self-evidently the designer's to resolve):
`… work on a COPY in \`wireframes/new/<kebab-case name for this concept, your choice>/round-1/\` (never in \`design-context/\`) …`

**A.11 `askQuestion`** (new ID assignment only — text unchanged, first canonized 2026-07-28).

**Use-it tab lead** (E2 — state-aware, mirrors the ledger's existing `everRead` branch; was a false "your AI has read this library" claim on a 0-described library):
- `identity.described > 0`: `your AI has read this library · answers and designs will be grounded in it, not generic`
- else: `nothing has read this library yet · start with **Describe the pages** below, then answers and designs will be grounded in it, not generic`

**Chat-only context bundle — closing instruction** (E8 + E9 — was one fixed sentence; now states what the model does and doesn't have, and the provenance clause is conditional on whether any page has been described):
`You are helping a designer. The above is a captured snapshot of a real product: everything here was extracted from the live site.${described>0 ? ' The one exception is the page descriptions, labeled method: ai — model-written orientation.' : ' No page has been described yet, so every line above is raw scraped text — including the page names, which are nav strings and may be truncated or run two phrases together.'} Do not invent pages, routes, or features not listed here; build on what exists. You have only this summary — no page HTML, no screenshots, no page copy — so you can answer questions and sketch structure in text, but you cannot produce a real wireframe on the product's own markup. If the designer asks for one, say so and point them at the workspace folder, where an AI with file access builds it on the captured page. Ask the designer which page to work on.`
> Superseded (struck 2026-07-28): `You are helping a designer. The above is a captured snapshot of a real product: everything was extracted from the live site, except page descriptions (labeled method: ai — model-written orientation). Do not invent pages, routes, or features not listed here; build on what exists. Ask the designer which page to work on.`

**CLAUDE.md / AGENTS.md — hard-rule additions** (E5, E16 — not dashboard copy, but canon-worthy standing instructions): the describe-step exception to "never edit library files" (rule 1); the designer-owned `annotations.json.hygiene` block + derived `foldedInto`/`template` fields, one sentence each surface.

**INDEX.md front-matter** (E4 — new, machine-readable, first six lines): ` ```\ndescribed: N/M · states: N · frontier: N · offOrigin: N hosts · labels: scraped\n``` `
