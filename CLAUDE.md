# Design Context Kit — agent instructions

This folder is a designer's standalone workspace for ONE product. You are helping that **designer** capture their product as a design-context library and design on top of it. They may not be technical. Read this fully before acting.

## 0. If you just got here

**Your working directory may not be this folder.** If an assistant cloned the kit here on the designer's behalf (see `INSTALL.md`), you were probably started one level *above* it. Every path in this file is relative to **this** folder — the one holding `tools/`, `skills/` and `design-context/`. Resolve against it, not against wherever you launched.

**Tell the designer to reopen here next time — once, plainly.** Instructions in a subfolder load only when files in that subfolder are read, and they are not restored after a context compaction. A long session started one level up will quietly lose these rules mid-run:

> Next time, open Claude directly on this folder — that way it reads the kit's instructions from the start and knows every page you've captured.

**If you are deep in a long session and unsure of a rule below, re-read this file.** It is the spec; your recollection of it is not. That goes double after a compaction.

**Don't regenerate this file.** `/init` will offer to rewrite it from the folder contents — it is hand-authored, and `AGENTS.md` is its hand-synced short form for hosts that don't auto-load project instructions. If a rule changes, change it in **both** files.

**First contact, no capture yet?** `design-context/` empty means the designer has nothing yet — go to the first-run guidance below. Don't discuss a product you haven't captured.

## What lives here

```
./
├── skills/capture-product/       ← capture the product → design-context/
├── skills/wireframe-on-snapshot/ ← design on a captured page
├── .claude/skills/               ← discovery stubs so the two above are invokable (/capture-product,
│                                   /wireframe-on-snapshot). Thin pointers — never the content.
├── .claude/settings.json         ← shared allow/deny rules (see Hard rules 1 and 3)
├── tools/                        ← setup.sh · login.js · capture.js · build-index.js · shot.js
├── profiles/                     ← the designer's logged-in browser session (NEVER share/commit)
├── design-context/               ← THIS product, captured: facts + consumption layer (see below)
└── wireframes/<page>/            ← design work built ON the library (never inside it); the dashboard's
                                   Home tab shows every wireframe here in its "Your designs" band
```

The two skills are invokable — `/capture-product` and `/wireframe-on-snapshot` — but their content lives at `skills/capture-product/SKILL.md` and `skills/wireframe-on-snapshot/SKILL.md`, which is what `CLAUDE.md`, `AGENTS.md`, the dashboard's prompts, `tools/lofi-check.js` and `tools/capture.js` all reference by path. **Edit the file under `skills/`, never the stub under `.claude/skills/`.**

**First run:** if `design-context/` is empty, the best move is the **dashboard's onboarding** — start it and point the designer at it, then follow the dashboard: it asks URL + sign-in + product-type, triggers login only if relevant, and shows the capture live — no terminal questions. `skills/capture-product/` is the chat-driven equivalent for hosts without a browser or when the designer prefers chatting. Either way, the wizard writes `design-context/product.json` and the skill reads the same file — the two front doors can't drift. Don't discuss a product you haven't captured.

## Starting the dashboard

```bash
node tools/map.js --port 4173     # run this in the BACKGROUND — it never exits on its own
```

It is a server, not a command: a foreground call blocks until it times out. Start it detached, then put the URL (`http://localhost:4173`) in your message to the designer — an empty library opens the onboarding wizard, a populated one opens the dashboard. If 4173 is taken, try 4174–4182 and use whichever takes; a second product workspace on this machine needs its own port.

`tools/start.sh` does the same plus a first-run dependency install, and is the path for a designer working *without* an assistant (double-click it, or run it in a terminal). **Don't run it yourself** — it stays in the foreground by design and will hang you.

Fresh clone, dependencies not installed yet: `npm install --prefix tools --no-fund --no-audit`, then `cd tools && npx playwright install chromium` (slow — tell the designer before you start it). `map.js` has no dependencies of its own, so the dashboard can open before the capture browser finishes downloading; capture can't run until it does.

## How to consume the library (you and any other AI agent)

**Open `design-context/registry.json` first — before any other file in this folder.** It is the machine map: every page keyed by slug with route, label, files, link graph (`linksTo`/`linkedFrom`), template info, and a labeled description. `INDEX.md` is the same content rendered for humans; read it only if you also need the prose framing. Additive dashboard-v2 fields ride alongside (never mutate existing ones): per-page `inboundCount` + `clickDepth` (measured clicks from the home page), and top-level `identity` (name + observed meta description), `readiness` (composite context-readiness score + breakdown), `events` (the journal feed — capture, tokens, describe, states, wireframe rounds — derived from embedded timestamps), and `offOrigin` (hosts linked from this product that were never crawled — see below). The dashboard (Home · Map · Design language · Use it · Journal) is the human front door. Its Home tab is one identity band — the product, and **every** metric on the tab, captured and generated — over two collapsible sibling sections with identical anatomy: **Captured pages** (the atlas) and **Your designs**, one card per generated wireframe, with the round's intent and each approach's rationale parsed from that round's `notes.md`. That band is **derived, not live**: `build-index.js` scans the sibling `wireframes/` tree and bakes it into `dashboard.html`. `tools/map.js` re-derives it automatically when the tree is newer than the page, so a round you just wrote shows up on the next load — but with **no server running** (a `dashboard.html` opened over `file://`) you must run `node tools/build-index.js` yourself or the band stays as it was. That band is dashboard-only: it is baked into `dashboard.html`, never into `registry.json`, because a wireframe is design work and the registry is captured fact. Each page folder: `page.md` (digest — facts + a "What this page is" section), `screenshot.png`, `page.html` (the editable baseline), `content.md` (verbatim copy), `computed-tokens.json`, `meta.json`. It also holds `thumb.png` — a small raster the dashboard draws instead of the multi-megapixel screenshot, derived deterministically from it by `tools/build-index.js`. It is a rendering convenience, never a source: **look at `screenshot.png`, never at `thumb.png`.**

A page's `label` is a scraped nav string, not an authored title — it can be truncated or run two strings together. Treat it as a hint, never quote it as product copy, and if one reads as junk propose a `displayLabel` in `annotations.json` (designer-owned — propose, don't write).

`frontier` only ever lists pages on the captured host. If the product's real app lives on another subdomain (`app.`, `dashboard.`), it is not in this library and not in the readiness score — check `offOrigin` and say so before treating the library as the whole product.

**Provenance rule: anything marked `method: ai` (page descriptions) is orientation prose a model wrote; everything else was extracted deterministically from the real product.** `INDEX.md` / `registry.json` / `page.md` are derived views — regenerate with `node tools/build-index.js` (preserves descriptions); never hand-edit the derived parts, never edit ground truth at all.

## Hard rules

1. **The library is facts.** Everything under `design-context/` was captured deterministically from the real product, with provenance. Never edit library files, never add model-guessed values to them. **The one exception is the describe step:** you write each page's screen doc *between* its `ai:begin`/`ai:end` markers in `page.md` (see `skills/capture-product/SKILL.md` §5). Everything outside those markers, in every file, stays untouched. Design work goes in `wireframes/`, on a **copy** of the snapshot. **This one is enforced, not just asked:** `.claude/settings.json` denies every file-editing tool on the library's ground truth and derived views, so if an edit there is refused, that is the rule working — regenerate with `node tools/build-index.js` (a subprocess, unaffected) or re-capture, and never route around it. `page.md` and `annotations.json` are deliberately left editable, because rule 1's exception and the designer-owned notes both need them.
2. **Capture is read-only.** `capture.js` follows links only — it never clicks buttons or submits forms. Never work around this by driving the product yourself; if a page needs interaction to reach, tell the designer it's beyond one-click capture for now.
3. **Never handle credentials.** Login happens in the browser window `login.js` opens — the designer types their password there, never into you or any file. Never ask for, read, or store a password, cookie, or token. `profiles/` never leaves this machine — and `.claude/settings.json` denies your file tools any read or write inside it, so you cannot open it even by accident. `login.js` and `capture.js` reach it as subprocesses; you don't.
4. **Plain language.** Talk like a design collaborator, not a terminal. "I'll open a browser window — log in like you normally do, then close it," not "run the persistent-context authentication flow." One question at a time; no walls of text.
5. **Report honestly.** If a page was skipped, capped, or failed, say so with the reason from `manifest.json`. Never present a partial capture as complete.

## Typical session

- Empty `design-context/`, or "capture my product" / "set this up" → start the dashboard (see **Starting the dashboard** below) → it runs onboarding; else `skills/capture-product/SKILL.md` (includes the describe step that fills each page's "What this page is"). The dashboard hands off to the describe step on its completion screen.
- "wireframe on ‹page›" / "redesign ‹page›" → `skills/wireframe-on-snapshot/SKILL.md`
- "capture this product" with a subdomain-first URL (`en.wikipedia.org`, `app.example.com`) → pass `--product <name>` too, or the workspace is named after the subdomain label (`en`, `app`) and that name reaches the dashboard title, the avatar and `INDEX.md`.
- "re-capture" / "the product changed" → run capture again (safe: refreshes in place, `contentHash` shows what changed; descriptions survive), then re-check descriptions whose page hash changed.
- "where are my wireframes?" / "show me what we designed" / "get this into Figma" → the dashboard's Home tab, **Your designs** band (below the atlas). Each wireframe's panel has **⧉ Copy for Figma**, which bakes a lofi artifact to real greys in the conversion frame first — so you do not need `tools/lofi-bake.js` for a copy made from the dashboard. Each card opens a panel with the round notes, the other approaches in that round, and the wireframe itself; a captured page's own panel lists the rounds built on it. A round whose approach has no `*.preview.png` gets one rendered on demand by `tools/map.js` — so run the dashboard rather than apologising for a missing preview.
- "show me the map" / "what haven't we captured?" → `node tools/map.js` → http://localhost:4173 — the coverage map: captured pages + the frontier (discovered, not downloaded). The designer selects frontier pages there (or you run `node tools/capture.js --urls "<u1>,<u2>"`); states are added on a page's panel (or `--state <slug>:<name> --url <stateUrl>`). `design-context/annotations.json` is designer-owned (notes + state URLs, plus a `hygiene` block of acks/folds) — you may append to it, never prune it, and never write its `hygiene` block unasked; `registry.json` may carry derived `foldedInto`/`template` fields from a fold — that re-shelves a page under a representative, it never deletes it.
- To preview any local HTML: `node tools/shot.js <file.html> [out.png] [--full]`

<!-- design-context-kit surfaces v3 · if the hygiene check reports a newer upstream, re-copy CLAUDE.md, AGENTS.md, skills/ and .claude/ from the template before trusting this file. -->
