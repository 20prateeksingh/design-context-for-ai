# Design Context Kit

Turn the product you design for into **ready-made context for your AI tools** — its navigation mapped, every key page captured as an editable snapshot, and a guide that tells any AI agent what each page is. Then wireframe your next feature *on top of the real product* instead of describing it from memory.

Built for designers. You don't write code — you talk to your AI assistant and it drives the tools in here.

## Start here

1. **Copy this repo's contents** into a folder named after your product (e.g. `acme-dashboard/`). One workspace = one product.
2. **Run `tools/start.sh`** (double-click it, or run it in a terminal — or just ask your AI assistant to run it). It installs what's needed the first time, then opens the **dashboard** in your browser. That's the only step you take by hand.
3. **Follow the dashboard.** It asks three things — your product's URL, whether you sign in to use it, and what kind of product it is — then captures. If you sign in, it opens a browser window for you to log in (**your password stays in that window, never in the AI or any file**) and continues on its own when you close it. You watch the capture happen live; you never touch the terminal.
4. When it's done, the dashboard becomes your product as an interactive **map** (Overview · Map · Tokens): every captured page a node, every *discovered-but-not-downloaded* page greyed out on the frontier. Click a grey node to download it; click a captured page to add **state URLs** (empty, error, filtered…). Prefer reading? `design-context/INDEX.md` is the same map as a document; AI tools start at `design-context/registry.json`.
5. Ask your AI assistant to **"describe the library"** (it writes a guide for each page), then **"wireframe on ‹page›"** to start designing on a captured page.

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
