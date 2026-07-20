---
name: wireframe-on-snapshot
description: Wireframe a design change directly on top of a captured page snapshot from design-context/. Use when the designer says "wireframe on <page>", "redesign <page>", "explore a change to <page>", or wants to sketch ideas on their real product.
---

# Wireframe on Snapshot

Design changes sketched **on the real page** — the captured snapshot is the baseline, so the structure, layout, and content around your change are the product's own, not an approximation. But the deliverable is a **wireframe**: the whole page is reduced to lo-fi before you design, so reviewers react to structure, not polish.

## 1. Pick the page

Read `design-context/ia/sitemap.json` and offer the pages by their nav labels. If the designer named a page, match it; if no design-context/ exists, route to `capture-product` first. Never invent what the current product looks like — it's in the snapshot.

## 2. One question: the change

"What do you want to explore on this page?" Get the intent in a sentence or two. Don't interrogate; you can propose the framing back ("so: make the filters findable without opening the drawer — right?").

## 3. Work on a copy — never in the library

```
wireframes/<page-slug>/round-1/
├── 01-<approach-name>.html     ← a COPY of design-context/pages/<slug>/page.html, edited
├── 02-<approach-name>.html
└── notes.md                    ← per approach: model + what changed and why, plus the swap-test lines
```

`design-context/` is captured fact and stays untouched. Copy `page.html`, edit the copy.

## 4. Put the copy in wireframe mode FIRST — before any design edit

**Golden rule: the shell is a fixed reference frame, not part of the exploration — carried structurally, but at wireframe fidelity.** A brand-fidelity shell (real logo, brand colors, promo cards) next to gray sketch boxes makes every new element look broken by contrast. Reduce the *whole page* to lo-fi, then design in that same language.

Inject this once into every copy, just before `</body>` (verbatim — both blocks):

```html
<style id="lofi-mode">
  /* LOFI MODE — the whole captured page at wireframe fidelity */
  html { filter: grayscale(1) !important; }
  img, svg, video, canvas, picture { filter: contrast(0) brightness(1.15) !important; }
</style>
<style id="lofi-kit">
  /* LOFI KIT — the shared vocabulary for everything you draw. Use these, don't hand-roll. */
  .lofi-region { position: relative; border: 1px dashed #9ca3af; border-radius: 6px; }
  .lofi-tag    { position: absolute; top: -9px; right: 8px; z-index: 9; background: #374151; color: #fff;
                 font: 600 10px/1 system-ui; letter-spacing: .06em; text-transform: uppercase;
                 padding: 4px 6px; border-radius: 3px; }
  .lofi-box    { background: repeating-linear-gradient(45deg, #ececec 0 6px, #e0e0e0 6px 12px);
                 border: 1px dashed #9ca3af; border-radius: 6px; min-height: 48px; }
  .lofi-img    { position: relative; overflow: hidden; background: #d1d5db;
                 border: 1px dashed #9ca3af; border-radius: 6px; }
  .lofi-img::before { content: ""; position: absolute; inset: 0; background:
                 linear-gradient(to top right, transparent calc(50% - .5px), #9ca3af calc(50% - .5px),
                 #9ca3af calc(50% + .5px), transparent calc(50% + .5px)),
                 linear-gradient(to top left, transparent calc(50% - .5px), #9ca3af calc(50% - .5px),
                 #9ca3af calc(50% + .5px), transparent calc(50% + .5px)); }
  .lofi-line   { height: 10px; border-radius: 5px; background: #d1d5db; margin: 6px 0; }
  .lofi-line.short { width: 55%; }
  .lofi-steps  { display: flex; align-items: center; gap: 8px; }
  .lofi-steps .dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: #6b7280; }
  .lofi-steps .dot.todo { background: #fff; border: 2px dashed #9ca3af; }
  .lofi-steps .bar { flex: 1; height: 2px; background: #9ca3af; }
  .lofi-steps .bar.todo { background: repeating-linear-gradient(90deg, #9ca3af 0 6px, transparent 6px 12px); }
</style>
```

- One injection, no per-page tuning: the page goes grayscale end to end; logos, photos, and icons flatten to gray shapes. Structure, spacing, nav labels, and the product's real content stay exactly as captured.
- The kit primitives are the **only** visual language for invented parts: hatched `.lofi-box` for regions you're blocking out, `.lofi-img` for image placeholders, `.lofi-line`(+`.short`) stacks for placeholder text, `.lofi-steps` for any stepper/timeline/progress element. Same vocabulary every approach, every round — consistency is most of what makes a lo-fi read as deliberate.
- **Never redraw the shell, never drop it, never leave it in brand color.** Nav, header, footer stay as captured (now lo-fi). If the change itself is about the shell, still inject lofi-mode — then edit the shell region like any other target area.
- Gotcha: `filter` on `html` re-anchors `position:fixed` elements to the page instead of the viewport — harmless (usually better) in full-page screenshots; if a page's chrome lands oddly in the render, screenshot at viewport height instead of `--full`.
- **Hi-fi is a different request.** If the designer explicitly asks for a shipped-look mock, skip lofi-mode — but name it a prototype, not a wireframe, and confirm that's what they want.

## 5. Produce 2–3 genuinely different approaches

For each approach, edit the lofi-mode copy:

- **Change only the target area.** Reuse the product's real components/classes where they exist on the page (that's why we captured real HTML).
- **Clone-and-edit before fabricating.** Start a new region by **cloning an adjacent captured element** (a card, a row, a section) and gutting its content — it inherits the product's spacing, radii, and type for free. Fabricate from scratch only when nothing similar exists on the page, and then pull padding/radius/type sizes from `design-context/tokens.json` (the product's own spacing ladder and type ramp) instead of inventing values. A new region that sits on the product's rhythm is what separates "considered" from "pasted on".
- **Mark invented parts, quietly.** Every invented region gets `class="lofi-region"` (or the dashed border) + one `.lofi-tag` chip of 1–3 words (`NEW`, `NEW: TIMELINE`). That's provenance — with the whole page gray it's the only thing distinguishing invented from captured — but it's the **only annotation allowed in the canvas**. No bracketed sentences, no caps commentary, no "[kept as-is, not repositioned in this pass]" — every editorial remark goes in `notes.md`, never in the artifact. The wireframe is the design; the notes are the conversation about it.
- **Draw, don't describe.** Never render a region as a gray paragraph *describing* what it would hold — if the approach introduces it, draw it. Secondary views the approach implies (the other tabs, an empty/error state, a modal) get their own frame: duplicate the relevant region below the main page under a `.lofi-tag` label (`TAB: PAYMENTS`, `STATE: EMPTY`), stacked in the same HTML file. A described-not-drawn region isn't a wireframe, it's a memo.
- **Approaches must differ in model, not decoration** (e.g. inline expansion vs dedicated panel vs progressive disclosure — not three button colors). **Swap-test, written in notes.md before presenting:** for each pair, one line — "A vs B — swapping their layouts breaks / doesn't break them, because …". If swapping doesn't break them, they're the same model: merge, and replace one with a genuinely different model.
- **Lo-fi ≠ sparse.** Keep the captured page's density: fill new tables/cards/lists with the page's real rows and values. A wireframe with the designer's actual orders/invoices/listings in it lands harder than lorem ipsum — and the data is right there in the snapshot and `content.md`. A half-empty region reads as unfinished, not calm.
- **Minified/obfuscated DOM (most production sites): hide-and-replace, don't hand-edit.** Find the target region's container class, inject `<style>.CONTAINER > *:not(.keep-me):not(.lofi-wire){display:none!important}</style>`, and insert your redesigned region as a sibling `<div class="lofi-wire">`. The original markup stays in the file (hidden, recoverable); your redesign uses the page's real data (titles, prices, dates — copy them in). Rebuild a region; never regex-edit minified markup in place.

### Pre-render checklist (every approach, before screenshotting)

- [ ] `lofi-mode` + `lofi-kit` style blocks present — no brand color anywhere in the render
- [ ] Shell carried as captured: structure + labels intact, nothing redrawn or dropped
- [ ] Invented parts: `.lofi-region` + one short `.lofi-tag` chip — no prose annotations anywhere in the canvas
- [ ] Everything the approach introduces is drawn; secondary views are frames, not descriptions
- [ ] New regions cloned from captured elements or built on `tokens.json` values
- [ ] Real page data reused; density ≥ the captured page
- [ ] Swap-test lines written in notes.md

### Post-render check (look at your own PNG before presenting)

Open each screenshot and actually look at it: wrapped or colliding labels, clipped elements, overlapping tag chips, a region that rendered half-empty, anything that reads as broken rather than lo-fi. Fix and re-shoot before the designer ever sees it — presenting a render you haven't looked at is how clipped elements reach the designer.

## 6. Show, then iterate

Render each approach: `node tools/shot.js <file> --full` and show the designer the PNGs side by side with one-line rationales. Iterate on their pick in `round-2/` (new copies; never overwrite a shown round). The designer decides — recommend, don't choose.

## Notes

- If the snapshot looks stale next to the live product, offer a re-capture rather than hand-fixing the baseline.
- Full-page screenshots of long pages: crop your presentation to the changed region plus context; the designer shouldn't scroll a 10 000px image to find your edit.
