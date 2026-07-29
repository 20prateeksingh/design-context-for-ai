# Design Context Kit

Turn the product you design for into **ready-made context for your AI tools** — its navigation mapped, every key page captured as an editable snapshot, and a guide that tells any AI agent what each page is. Then wireframe your next feature *on top of the real product* instead of describing it from memory.

Built for designers. You don't write code — you talk to your AI assistant and it drives the tools in here.

**Fastest start with Claude Code:** open it and paste — *"Set up the design context kit from https://github.com/20prateeksingh/design-context-for-ai in a new folder."*

## Start here

1. **Copy this repo's contents** into a folder named after your product (e.g. `acme-dashboard/`). One workspace = one product.
2. **Run `tools/start.sh`** (double-click it, or run it in a terminal — or just ask your AI assistant to run it). It installs what's needed the first time, then opens the **dashboard** in your browser. That's the only step you take by hand.
3. **Follow the dashboard.** It asks three things — your product's URL, whether you sign in to use it, and what kind of product it is — then captures. If you sign in, it opens a browser window for you to log in (**your password stays in that window, never in the AI or any file**) and continues on its own when you close it. You watch the capture happen live; you never touch the terminal.
4. When it's done, the dashboard **Home** is your product as a **page atlas** — every captured page as a screenshot card — with a running **ledger** (the journal) down the side and a **context-readiness** score up top. Tabs: **Home · Map · Design language · Use it**, plus the **Journal**. The **Map** plots every page by real clicks-from-home, sized by how linked-to it is, with undownloaded pages as ghosts in the fog; click a ghost to download it, click a captured page for its full doc (screenshot, states, description, link graph, history). Prefer reading? `design-context/INDEX.md` is the same map as a document; AI tools start at `design-context/registry.json`.
5. The ledger's top **"next"** slot tells you the one move that matters — first it's **"Give your AI this toolkit"** (copy one prompt; your AI describes every page and the captions light up), then **"Make your first thing"** (wireframe a real page, or design something new in the product's own language from the **Use it** tab).

Prefer the terminal, or driving it via your AI agent?

```bash
tools/start.sh                                        # deps + server + dashboard (the easy path)
# or, step by step:
tools/setup.sh                                        # one-time: install dependencies + browser
node tools/login.js --url https://app.example.com     # log in once, close the window (only if you sign in)
node tools/capture.js --url https://app.example.com   # capture → design-context/
```

_Windows: `start.sh` is macOS/Linux; on Windows run the three step-by-step commands above in order._

## After capture — use it

**Any moment of your product, in Figma, editable, in one paste.** On any page — the Home atlas panel, the Map panel, or a page doc (and each captured state) — click **⧉ Copy for Figma** and paste into your Figma file (⌘V). It lands as editable **auto-layout layers**, not a flat image — arrange or restyle freely. No plugin, no extension, no Dev Mode, no paid seat; your library stays untouched. One caveat stated plainly: to keep the pasted text as text, the converter fetches public font files from a CDN during a copy — that single request is the only time the kit reaches the network on your behalf, and it carries none of your data.

The dashboard's **Use it** tab turns the library into next moves — every button copies a ready-to-paste prompt with your real file paths already in it. In short:

- **With Claude Code (recommended):** open Claude Code in this folder (`cd <your-workspace> && claude`) — it reads this workspace's instructions and knows every page. Ask it to *describe the pages*, *wireframe on a page*, or *what's missing?*
- **With another AI coding tool** (Cursor, Windsurf): point it at `AGENTS.md`, then tell it to read `design-context/INDEX.md`.
- **With a chat-only AI** (claude.ai, ChatGPT): use the Use-it tab's **Copy context bundle** button — it assembles a self-contained summary you paste in, no file access needed.
- **By hand:** any `design-context/pages/<slug>/page.html` opens in your browser and is an editable design baseline.

> Captured logged-in? The library holds your real account data — share the folder or a bundle accordingly, and never share `profiles/`.

## What you end up with

```
your-product/
├── design-context/          ← the captured library (starts empty)
│   ├── INDEX.md             ← START HERE — every page, described and linked
│   ├── registry.json        ← the same map for machines — point AI tools here
│   ├── ia/sitemap.json      ← your product's navigation, mapped
│   └── pages/<page>/        ← per page: page.md digest · screenshot.png ·
│                              editable page.html · verbatim content.md ·
│                              style tally · provenance meta
├── wireframes/              ← your design explorations (starts empty)
├── tools/ · skills/         ← the machinery + the AI's instructions
└── profiles/                ← your browser login (created on first login; stays on your machine)
```

Repeating pages collapse to one representative: 300 product pages that share a layout become **one** captured example, with the count recorded — small library, full picture.

## The rules the kit lives by

- **Read-only capture.** It follows links only — never clicks buttons, never submits forms. Nothing on your product can be created, deleted, sent, or paid. (One logged exception: dismissing a cookie banner.)
- **Facts with provenance.** Everything in `design-context/` was extracted deterministically from the real product. The one AI-written part — each page's one-line description — is labeled `method: ai` wherever it appears.
- **Your login stays yours.** You type your password into a normal browser window; the AI never sees it. The `profiles/` folder never leaves your machine — it's gitignored and must never be shared.
- **Design on copies.** Wireframes live in `wireframes/`, built on copies of snapshots; the captured library is never edited.

## Requirements

macOS/Linux with [Node.js](https://nodejs.org) (LTS). `tools/setup.sh` handles the rest.

## Credits

Figma paste powered by [@figit/dom-to-figma](https://www.npmjs.com/package/@figit/dom-to-figma) (MIT), vendored under `tools/vendor/`.
