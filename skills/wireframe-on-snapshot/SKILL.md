---
name: wireframe-on-snapshot
description: Wireframe a design change directly on top of a captured page snapshot from design-context/. Use when the designer says "wireframe on <page>", "redesign <page>", "explore a change to <page>", or wants to sketch ideas on their real product.
---

# Wireframe on Snapshot

Design changes sketched **on the real page** — the captured snapshot is the baseline, so the shell, styles, and copy around your change are the product's own, not an approximation.

## 1. Pick the page

Read `design-context/ia/sitemap.json` and offer the pages by their nav labels. If the designer named a page, match it; if no design-context/ exists, route to `capture-product` first. Never invent what the current product looks like — it's in the snapshot.

## 2. One question: the change

"What do you want to explore on this page?" Get the intent in a sentence or two. Don't interrogate; you can propose the framing back ("so: make the filters findable without opening the drawer — right?").

## 3. Work on a copy — never in the library

```
wireframes/<page-slug>/round-1/
├── 01-<approach-name>.html     ← a COPY of design-context/pages/<slug>/page.html, edited
├── 02-<approach-name>.html
└── notes.md                    ← per approach: what changed and why, 2-3 lines each
```

`design-context/` is captured fact and stays untouched. Copy `page.html`, edit the copy.

## 4. Produce 2–3 genuinely different approaches

For each approach, edit the copied DOM:

- **Keep the shell.** Nav, header, footer stay as captured unless the change is about them.
- **Change only the target area.** Reuse the product's real components/classes where they exist on the page (that's why we captured real HTML).
- **New elements are visibly lo-fi:** gray fills (`#e5e7eb`-ish), dashed 1px borders, system font, `[placeholder]`-labeled content — so invented parts can't be mistaken for shipped UI.
- Approaches must differ in **model**, not decoration (e.g. inline expansion vs dedicated panel vs progressive disclosure — not three button colors).
- **Minified/obfuscated DOM (most production sites): hide-and-replace, don't hand-edit.** Find the target region's container class, inject `<style>.CONTAINER > *:not(.keep-me):not(.lofi-wire){display:none!important}</style>`, and insert your redesigned region as a sibling `<div class="lofi-wire">`. The original markup stays in the file (hidden, recoverable); your redesign uses the page's real data (titles, prices, dates — copy them in). Rebuild a region; never regex-edit minified markup in place.
- **Reuse the page's real content.** A wireframe with the designer's actual orders/invoices/listings in it lands harder than lorem ipsum — and the data is right there in the snapshot and `content.md`.

## 5. Show, then iterate

Render each approach: `node tools/shot.js <file> --full` and show the designer the PNGs side by side with one-line rationales. Iterate on their pick in `round-2/` (new copies; never overwrite a shown round). The designer decides — recommend, don't choose.

## Notes

- If the snapshot looks stale next to the live product, offer a re-capture rather than hand-fixing the baseline.
- Full-page screenshots of long pages: crop your presentation to the changed region plus context; the designer shouldn't scroll a 10 000px image to find your edit.
