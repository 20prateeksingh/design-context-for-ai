# Design Context Kit

Turn the product you design for into **ready-made context for your AI tools** — its navigation mapped, every key page captured as an editable snapshot, and a guide that tells any AI agent what each page is. Then wireframe your next feature *on top of the real product* instead of describing it from memory.

Built for designers. You don't write code — you talk to your AI assistant and it drives the tools in here.

## Start here

1. **Copy this repo's contents** into a folder named after your product (e.g. `acme-dashboard/`). One workspace = one product.
2. **Open Claude Code** (or your AI agent) in that folder and say **"capture my product."** It will ask for your product's URL and whether to capture logged-in, open a browser window for you to log in (your password stays in the browser — never in the AI or any file), then capture your product's pages read-only.
3. When it's done, run `node tools/map.js` and open **http://localhost:4173** — your product as an interactive map: every captured page a node, every *discovered-but-not-downloaded* page greyed out on the frontier. Click a grey node to download it; click a captured page to see its screenshot and add **state URLs** (empty, error, filtered…). Prefer reading? `design-context/INDEX.md` is the same map as a document; AI tools start at `design-context/registry.json`.
4. Say **"wireframe on ‹page›"** to start designing on a captured page.

Prefer the terminal?

```bash
tools/setup.sh                                        # one-time: install dependencies + browser
node tools/login.js --url https://app.example.com     # log in once, close the window
node tools/capture.js --url https://app.example.com   # capture → design-context/
```

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
