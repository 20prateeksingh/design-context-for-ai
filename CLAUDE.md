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

**First run:** if `design-context/` is empty, the only sensible move is `skills/capture-product/` — offer it. Don't discuss a product you haven't captured.

## How to consume the library (you and any other AI agent)

Start at `design-context/registry.json` — every page keyed by slug with route, label, files, link graph (`linksTo`/`linkedFrom`), template info, and a labeled description. Humans start at `INDEX.md` (same content, readable). Each page folder: `page.md` (digest — facts + a "What this page is" section), `screenshot.png`, `page.html` (the editable baseline), `content.md` (verbatim copy), `computed-tokens.json`, `meta.json`.

**Provenance rule: anything marked `method: ai` (page descriptions) is orientation prose a model wrote; everything else was extracted deterministically from the real product.** `INDEX.md` / `registry.json` / `page.md` are derived views — regenerate with `node tools/build-index.js` (preserves descriptions); never hand-edit the derived parts, never edit ground truth at all.

## Hard rules

1. **The library is facts.** Everything under `design-context/` was captured deterministically from the real product, with provenance. Never edit library files, never add model-guessed values to them. Design work goes in `wireframes/`, on a **copy** of the snapshot.
2. **Capture is read-only.** `capture.js` follows links only — it never clicks buttons or submits forms. Never work around this by driving the product yourself; if a page needs interaction to reach, tell the designer it's beyond one-click capture for now.
3. **Never handle credentials.** Login happens in the browser window `login.js` opens — the designer types their password there, never into you or any file. Never ask for, read, or store a password, cookie, or token. `profiles/` never leaves this machine.
4. **Plain language.** Talk like a design collaborator, not a terminal. "I'll open a browser window — log in like you normally do, then close it," not "run the persistent-context authentication flow." One question at a time; no walls of text.
5. **Report honestly.** If a page was skipped, capped, or failed, say so with the reason from `manifest.json`. Never present a partial capture as complete.

## Typical session

- Empty `design-context/`, or "capture my product" / "set this up" → `skills/capture-product/SKILL.md` (includes the describe step that fills each page's "What this page is").
- "wireframe on ‹page›" / "redesign ‹page›" → `skills/wireframe-on-snapshot/SKILL.md`
- "re-capture" / "the product changed" → run capture again (safe: refreshes in place, `contentHash` shows what changed; descriptions survive), then re-check descriptions whose page hash changed.
- "show me the map" / "what haven't we captured?" → `node tools/map.js` → http://localhost:4173 — the coverage map: captured pages + the frontier (discovered, not downloaded). The designer selects frontier pages there (or you run `node tools/capture.js --urls "<u1>,<u2>"`); states are added on a page's panel (or `--state <slug>:<name> --url <stateUrl>`). `design-context/annotations.json` is designer-owned (notes + state URLs) — you may append to it, never prune it.
- To preview any local HTML: `node tools/shot.js <file.html> [out.png] [--full]`
