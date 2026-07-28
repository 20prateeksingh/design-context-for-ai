# Design Context Kit — agent instructions

This folder is a designer's standalone workspace for ONE product. You are helping that **designer** capture their product as a design-context library and design on top of it. They may not be technical. Read this fully before acting.

## What lives here

```
./
├── skills/capture-product/       ← capture the product → design-context/
├── skills/wireframe-on-snapshot/ ← design on a captured page
├── tools/                        ← setup.sh · login.js · capture.js · build-index.js · shot.js
├── profiles/                     ← the designer's logged-in browser session (NEVER share/commit)
├── design-context/               ← THIS product, captured: facts + consumption layer (see below)
└── wireframes/<page>/            ← design work built ON the library (never inside it)
```

**First run:** if `design-context/` is empty, the best move is the **dashboard's onboarding** — tell the designer to run `tools/start.sh` (or offer to run it), then follow the dashboard: it asks URL + sign-in + product-type, triggers login only if relevant, and shows the capture live — no terminal questions. `skills/capture-product/` is the chat-driven equivalent for hosts without a browser or when the designer prefers chatting. Either way, the wizard writes `design-context/product.json` and the skill reads the same file — the two front doors can't drift. Don't discuss a product you haven't captured.

## How to consume the library (you and any other AI agent)

**Open `design-context/registry.json` first — before any other file in this folder.** It is the machine map: every page keyed by slug with route, label, files, link graph (`linksTo`/`linkedFrom`), template info, and a labeled description. `INDEX.md` is the same content rendered for humans; read it only if you also need the prose framing. Additive dashboard-v2 fields ride alongside (never mutate existing ones): per-page `inboundCount` + `clickDepth` (measured clicks from the home page), and top-level `identity` (name + observed meta description), `readiness` (composite context-readiness score + breakdown), `events` (the journal feed — capture, tokens, describe, states, wireframe rounds — derived from embedded timestamps), and `offOrigin` (hosts linked from this product that were never crawled — see below). The dashboard (Home atlas + ledger · Map · Design language · Use it · Journal) is the human front door. Each page folder: `page.md` (digest — facts + a "What this page is" section), `screenshot.png`, `page.html` (the editable baseline), `content.md` (verbatim copy), `computed-tokens.json`, `meta.json`.

A page's `label` is a scraped nav string, not an authored title — it can be truncated or run two strings together. Treat it as a hint, never quote it as product copy, and if one reads as junk propose a `displayLabel` in `annotations.json` (designer-owned — propose, don't write).

`frontier` only ever lists pages on the captured host. If the product's real app lives on another subdomain (`app.`, `dashboard.`), it is not in this library and not in the readiness score — check `offOrigin` and say so before treating the library as the whole product.

**Provenance rule: anything marked `method: ai` (page descriptions) is orientation prose a model wrote; everything else was extracted deterministically from the real product.** `INDEX.md` / `registry.json` / `page.md` are derived views — regenerate with `node tools/build-index.js` (preserves descriptions); never hand-edit the derived parts, never edit ground truth at all.

## Hard rules

1. **The library is facts.** Everything under `design-context/` was captured deterministically from the real product, with provenance. Never edit library files, never add model-guessed values to them. **The one exception is the describe step:** you write each page's screen doc *between* its `ai:begin`/`ai:end` markers in `page.md` (see `skills/capture-product/SKILL.md` §5). Everything outside those markers, in every file, stays untouched. Design work goes in `wireframes/`, on a **copy** of the snapshot.
2. **Capture is read-only.** `capture.js` follows links only — it never clicks buttons or submits forms. Never work around this by driving the product yourself; if a page needs interaction to reach, tell the designer it's beyond one-click capture for now.
3. **Never handle credentials.** Login happens in the browser window `login.js` opens — the designer types their password there, never into you or any file. Never ask for, read, or store a password, cookie, or token. `profiles/` never leaves this machine.
4. **Plain language.** Talk like a design collaborator, not a terminal. "I'll open a browser window — log in like you normally do, then close it," not "run the persistent-context authentication flow." One question at a time; no walls of text.
5. **Report honestly.** If a page was skipped, capped, or failed, say so with the reason from `manifest.json`. Never present a partial capture as complete.

## Typical session

- Empty `design-context/`, or "capture my product" / "set this up" → prefer `tools/start.sh` → the dashboard runs onboarding; else `skills/capture-product/SKILL.md` (includes the describe step that fills each page's "What this page is"). The dashboard hands off to the describe step on its completion screen.
- "wireframe on ‹page›" / "redesign ‹page›" → `skills/wireframe-on-snapshot/SKILL.md`
- "re-capture" / "the product changed" → run capture again (safe: refreshes in place, `contentHash` shows what changed; descriptions survive), then re-check descriptions whose page hash changed.
- "show me the map" / "what haven't we captured?" → `node tools/map.js` → http://localhost:4173 — the coverage map: captured pages + the frontier (discovered, not downloaded). The designer selects frontier pages there (or you run `node tools/capture.js --urls "<u1>,<u2>"`); states are added on a page's panel (or `--state <slug>:<name> --url <stateUrl>`). `design-context/annotations.json` is designer-owned (notes + state URLs, plus a `hygiene` block of acks/folds) — you may append to it, never prune it, and never write its `hygiene` block unasked; `registry.json` may carry derived `foldedInto`/`template` fields from a fold — that re-shelves a page under a representative, it never deletes it.
- To preview any local HTML: `node tools/shot.js <file.html> [out.png] [--full]`

<!-- design-context-kit surfaces v1 · if the hygiene check reports a newer upstream, re-copy CLAUDE.md, AGENTS.md and skills/ from the template before trusting this file. -->
