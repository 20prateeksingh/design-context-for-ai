# Design Context Kit

Turn the product you design for into **ready-made context for your AI tools** — its navigation mapped, every key page captured as an editable snapshot, and a guide that tells any AI agent what each page is. Then wireframe your next feature *on top of the real product* instead of describing it from memory.

Built for designers. You don't write code — you talk to your AI assistant and it drives the tools in here.

**Fastest start — let an AI set it up.** In the [Claude desktop app](https://code.claude.com/docs/en/desktop-quickstart) (no terminal) or the Claude Code CLI, paste:

> *"Read https://raw.githubusercontent.com/20prateeksingh/design-context-for-ai/main/INSTALL.md and follow it."*

It installs the kit, opens the dashboard, and is then the AI that reads your library — same window, no second tool. [`INSTALL.md`](INSTALL.md) is written for the assistant; you don't need to read it. (Claude Code **on the web** can't do this — the kit needs a browser and a local server on your own machine.)

## Start here

1. **Copy this repo's contents** into a folder named after your product (e.g. `acme-dashboard/`). One workspace = one product.
2. **Run `tools/start.sh`** (double-click it, or run it in a terminal). It installs what's needed the first time, then opens the **dashboard** in your browser. That's the only step you take by hand. Working with an AI assistant instead? Give it the prompt above and skip this step — it handles 1 and 2 for you.
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
node tools/capture.js --url https://example.com --logged-out   # a public site: no login, no profile
```

_Windows: both `.sh` scripts are macOS/Linux only — `setup.sh` included. Run these three lines instead, **one at a time** (Windows PowerShell has no `&&`, and chaining them is a parse error that stops the line before anything in it runs):_

```
npm install --prefix tools --no-fund --no-audit
npx --prefix tools playwright install chromium
node tools/map.js --port 4173
```

_The `node` commands above then work exactly as shown. Windows has been through a cold-start run of both routes — the AI-assisted one and this one — and capture, the dashboard, design-language extraction and folder paths containing spaces all came through clean. What it doesn't get is the double-click convenience: the `.sh` scripts need Git Bash, and even there they won't open your browser for you, so open the dashboard URL yourself._

## After capture — use it

**Any moment of your product, in Figma, editable, in one paste.** On any page — the Home atlas panel, the Map panel, or a page doc (and each captured state) — click **⧉ Copy for Figma** and paste into your Figma file. It lands as editable **auto-layout layers**, not a flat image — arrange or restyle freely. No plugin, no extension, no Dev Mode, no paid seat; your library stays untouched.

Two network moments, stated plainly, because a copy is the one thing here that reaches outside your machine:

- **A copy loads Figma's own converter from `mcp.figma.com`** at the moment you click. It is Figma's code, fetched fresh each time rather than shipped inside the kit, and it runs in your browser like any other script on the page.
- **If that host can't be reached** — you're offline, or your network blocks it — the copy falls back to the converter bundled under `tools/vendor/`, which fetches public font files from a CDN so your pasted text stays text instead of disappearing. The success message names whichever converter ran, so you always know which one you got.

Neither path uploads your page or your library. The conversion happens entirely on your machine, and no data of yours is sent to either host.

The dashboard's **Use it** tab turns the library into next moves — every button copies a ready-to-paste prompt with your real file paths already in it. In short:

- **With the Claude desktop app (recommended, no terminal):** open it on **this folder** — it reads this workspace's instructions and knows every page. Ask it to *describe the pages*, *wireframe on a page*, or *what's missing?* Open it on the folder itself, not the folder above: that's how the kit's instructions load in full.
- **With the Claude Code CLI:** same thing from a terminal — `cd <your-workspace>`, then `claude`.
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
│                              style tally · provenance meta ·
│                              thumb.png (what the dashboard draws — derived)
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

macOS, Linux or Windows, with [Node.js](https://nodejs.org) (LTS). On macOS/Linux `tools/setup.sh` handles the rest; on Windows use the three commands in the note above, since the `.sh` scripts need Git Bash.

## Credits

Figma paste is powered by Figma's own `capture.js`, loaded at copy time from `mcp.figma.com` — Figma's code, hotlinked and never redistributed here. The offline fallback is [@figit/dom-to-figma](https://www.npmjs.com/package/@figit/dom-to-figma) (MIT), vendored under `tools/vendor/`.
