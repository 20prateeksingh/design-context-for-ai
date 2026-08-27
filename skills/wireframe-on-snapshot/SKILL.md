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

**Fidelity is inferred, asked only on ambiguity.** Fidelity follows the designer's own word: wireframe / redesign / explore / sketch → lofi (the default); mock / prototype / hi-fi → the hi-fi path (§4's note). Only if the wording is genuinely ambiguous, fold one clause into the same question — never a second question.

## 3. Work on a copy — never in the library

```
wireframes/<page-slug>/round-1/
├── 01-<approach-name>.html     ← a COPY of design-context/pages/<slug>/page.html, edited
├── 02-<approach-name>.html
└── notes.md                    ← per approach: model + what changed and why, plus the swap-test lines
```

`design-context/` is captured fact and stays untouched. Copy `page.html`, edit the copy.

A fresh exploration of an already-wireframed page (a different goal, not the next iteration) still takes the next round number, and its `notes.md` opens by saying so: `This round is a new exploration (‹goal›), not an iteration of round-‹N›.`

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
  .lofi-spine { position: relative; padding-left: 28px; }
  .lofi-spine::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px;
                        width: 2px; background: #9ca3af; }
  .lofi-spine .node { position: relative; padding-bottom: 20px; }
  .lofi-spine .node:last-child { padding-bottom: 0; }
  .lofi-spine .node::before { content: ""; position: absolute; left: -28px; top: 4px;
                              width: 12px; height: 12px; border-radius: 50%; background: #6b7280; }
  .lofi-spine .node.todo::before { background: #fff; border: 2px dashed #9ca3af; }
</style>
```

- One injection, no per-page tuning: the page goes grayscale end to end; logos, photos, and icons flatten to gray shapes. Structure, spacing, nav labels, and the product's real content stay exactly as captured.
- The kit primitives are the **only** visual language for invented parts: hatched `.lofi-box` for regions you're blocking out, `.lofi-img` for image placeholders, `.lofi-line`(+`.short`) stacks for placeholder text, `.lofi-steps` for any stepper/timeline/progress element. Same vocabulary every approach, every round — consistency is most of what makes a lo-fi read as deliberate.
- **Never redraw the shell, never drop it, never leave it in brand color.** Nav, header, footer stay as captured (now lo-fi). If the change itself is about the shell, still inject lofi-mode — then edit the shell region like any other target area.
- Gotcha: `filter` on `html` re-anchors `position:fixed` elements to the page instead of the viewport — harmless (usually better) in full-page screenshots; if a page's chrome lands oddly in the render, screenshot at viewport height instead of `--full`.
- **Hi-fi is a different request** and is NOT yet supported end-to-end: today you'd get the captured parts in brand color and every invented part still in gray lofi primitives — exactly the half-real hybrid this section warns against — and the `NEW:`/`ASSUMED:` vocabulary has no color equivalent yet. Name it, park it, and tell the designer the generated-designs round will carry it.
- **Status that survives grayscale.** When the captured page distinguishes states by hue alone (e.g. a green "delivered" vs an amber "returned" with no other visual difference), `grayscale(1)` flattens that to one gray and the page loses its only status signal. Keep the real hex **and** add a shape difference (filled dot / ring / double ring) so the states stay distinguishable lo-fi — and note the substitution in `notes.md`.

## 5. Produce 2–3 genuinely different approaches

For each approach, edit the lofi-mode copy:

- **Change only the target area.** Reuse the product's real components/classes where they exist on the page (that's why we captured real HTML).
- **Clone-and-edit before fabricating.** Start a new region by **cloning an adjacent captured element** (a card, a row, a section) and gutting its content — it inherits the product's spacing, radii, and type for free. Fabricate from scratch only when nothing similar exists on the page, and then pull padding/radius/type sizes from `design-context/tokens.json` (the product's own spacing ladder and type ramp) instead of inventing values. A new region that sits on the product's rhythm is what separates "considered" from "pasted on".
- **Mark invented parts, quietly.** Every invented region gets `class="lofi-region"` (or the dashed border) + one `.lofi-tag` chip of 1–3 words (`NEW`, `NEW: TIMELINE`). A leading category prefix — `NEW:`, `ASSUMED:`, `TAB:`, `STATE:` — is structural, not content, so it doesn't count toward the three: `STATE: ON THE WAY` is a three-word chip, and a real state name always fits. That's provenance — with the whole page gray it's the only thing distinguishing invented from captured — but it's the **only annotation allowed in the canvas**. No bracketed sentences, no caps commentary, no "[kept as-is, not repositioned in this pass]" — every editorial remark goes in `notes.md`, never in the artifact. The wireframe is the design; the notes are the conversation about it.
- **Draw, don't describe.** Never render a region as a gray paragraph *describing* what it would hold — if the approach introduces it, draw it. Secondary views the approach implies (the other tabs, an empty/error state, a modal) get their own frame: duplicate the relevant region below the main page under a `.lofi-tag` label (`TAB: PAYMENTS`, `STATE: EMPTY`), stacked in the same HTML file. A described-not-drawn region isn't a wireframe, it's a memo.
- **Approaches must differ in model, not decoration** (e.g. inline expansion vs dedicated panel vs progressive disclosure — not three button colors). **Swap-test, written in notes.md before presenting:** for each pair, one line — "A vs B — swapping their layouts breaks / doesn't break them, because …". If swapping doesn't break them, they're the same model: merge, and replace one with a genuinely different model.
- **Lo-fi ≠ sparse.** Keep the captured page's density: fill new tables/cards/lists with the page's real rows and values. A wireframe with the designer's actual orders/invoices/listings in it lands harder than lorem ipsum — and the data is right there in the snapshot and `content.md`. A half-empty region reads as unfinished, not calm.
- **Minified/obfuscated DOM (most production sites): hide-and-replace, don't hand-edit.** Find the target region's container class, inject `<style>.CONTAINER > *:not(.keep-me):not(.lofi-wire){display:none!important}</style>`, and insert your redesigned region as a sibling `<div class="lofi-wire">`. The original markup stays in the file (hidden, recoverable); your redesign uses the page's real data (titles, prices, dates — copy them in). Rebuild a region; never regex-edit minified markup in place.

### Pre-render checklist (every approach, before screenshotting)

**Machine-verified — run this instead of re-reading the rules it covers:**

```
node tools/lofi-check.js <file>
```

Covers: the `lofi-mode` + `lofi-kit` blocks (byte-verbatim against this file) and brand color in the
render · the `.lofi-region` ↔ `.lofi-tag` pairing and any prose annotation in the canvas · the
swap-test lines in `notes.md` · and, for §7 work, the `ASSUMED:` chips and the `<title>`. It also
warns on clipping inside your drawn regions. Structural failures exit 1; heuristics exit 0 and can
have false positives — read them, don't obey them. It reports and recommends; it never edits anything.

**Yours to judge — the checker is blind to these four, so you still have to look:**

- [ ] Shell carried as captured: structure + labels intact, nothing redrawn or dropped
- [ ] Everything the approach introduces is drawn; secondary views are frames, not descriptions
- [ ] New regions cloned from captured elements or built on `tokens.json` values
- [ ] Real page data reused; density ≥ the captured page

### Post-render check (look at your own PNG before presenting)

Open each screenshot and actually look at it: wrapped or colliding labels, clipped elements, overlapping tag chips, a region that rendered half-empty, anything that reads as broken rather than lo-fi. Fix and re-shoot before the designer ever sees it — presenting a render you haven't looked at is how clipped elements reach the designer.

## 5b. notes.md is also the dashboard's caption source

Everything you build under `wireframes/` appears in the dashboard's Home tab, in the **Your designs**
band — one card per approach file, newest round first. Two lines of that card are read out of this
round's `notes.md`, so write it for both readers:

- **State the round's intent in the opening prose**, labeled: `Goal:`, `Brief:`, `Intent:`,
  `Direction:` — or after the baseline sentence (`Baseline: … (untouched). Intent: …`). That line
  becomes the round's caption everywhere it is shown.
- **Give every approach one line that names its file**, in any of the shapes the parser reads: a
  bullet (`- **02-attention-first** — …`), a heading (`## 02 — Attention first (`02-attention-first.html`)`),
  or a table row. A render-output line (`- `01-x.html` → `01-x.preview.png``) is skipped on purpose —
  it mentions the file without saying anything about the design.
- **Render a preview** (`node tools/shot.js <file> --full`, §6) — that PNG is the card face. If one is
  missing the dashboard renders it for you, but only when the designer has the server running.

This is a nicety, not a contract: a round with no `notes.md` still shows up, just captioned by
filename alone. Never write notes FOR the band — write them for the designer, and the band follows.

## 6. Show, then iterate

Render each approach: `node tools/shot.js <file> --full` and show the designer the PNGs side by side with one-line rationales. Iterate on their pick in `round-2/` (new copies; never overwrite a shown round). The designer decides — recommend, don't choose.

A paste is a render: before presenting a Figma-bound artifact, paste it yourself (or ask the designer to) and LOOK at the frame — payload audits can't see appearance. The dashboard's copy reports what it measured (a bake residue it could not read is named in the toast), but a number is not a look.

## 7. Designing a page the product doesn't have yet

Same discipline as §§3–6 — lofi mode, the kit primitives, provenance tags, real data, swap tests,
rounds. What changes: there is no snapshot *of this page* to work on, so you build one out of the
pages next to it.

**7.1 Find the shell donor first.** A new page in a real product is never new all the way down: it
sits inside a header, a nav, a breadcrumb, a footer. Pick the captured page whose shell this page
would share — usually a sibling in the same section — and work on a copy of **its** `page.html`. You
inherit the real shell *and* its real CSS for free, which is most of what makes the result look like
the product.

```
wireframes/new/<concept-slug>/round-1/
├── 01-<approach-name>.html     ← a COPY of the donor page's page.html, content column replaced
├── 02-<approach-name>.html
├── *.preview.png               ← node tools/shot.js <file> --full
└── notes.md                    ← per approach: model + rationale + swap tests + the assumption log
```

`<concept-slug>` is kebab-case, like a page slug (`order-tracking`, not `Order Tracking`).

**Never start from a blank HTML file.** A page built from `tokens.json` alone gets the colors right
and everything else wrong — no shell, no real type stack, no real grid, no breadcrumb. If genuinely
no captured page shares this page's shell, say so and offer to capture one first; that is a better
next step than designing in a vacuum.

**7.2 Replace the content column, not a region.** §5's hide-and-replace rule scales up: find the
donor's main content container, hide its children
(`<style>.CONTAINER > *:not(.lofi-wire){display:none!important}</style>`), and build your page as a
`.lofi-wire` sibling. Hide the parts of the shell that belong to the donor and not to you — a filters
rail, a page-specific promo card — and say so in `notes.md`. Keep header, nav, breadcrumb and footer.

**7.3 Extend the breadcrumb.** The donor's breadcrumb still says the donor's name. Clone its last
crumb element and change the label, so the page announces what it is
(`Home > My Account > My Orders > Track order`). This is a two-line edit and it is the difference
between a screen and a page.

**7.4 Set the `<title>`.** The Figma converter names the pasted frame from `document.title`. Leave it
alone and every wireframe lands in Figma with the donor page's title, indistinguishable from the
captured original. Set it to something a designer can find: `Track order · <product>`.

**Getting it into Figma.** Lofi mode is a CSS filter, which is *paint-time* — converters read computed
styles, not pixels, so an unbaked lofi wireframe exports in full brand colour. The dashboard handles
this for you: **⧉ Copy for Figma** on a wireframe's panel detects the filter at runtime and bakes it to
real greys inside the conversion frame before either converter reads a style, and leaves a hi-fi
wireframe in colour. Run `tools/lofi-bake.js` yourself only when you are converting *outside* the
dashboard — pasting from your own browser tab, or handing someone a `.baked.html`. Either way, pin the
conversion width to the capture viewport (1440), never the operator's window.

**7.5 Assemble the vocabulary before you draw, and write down where each piece came from.** There is
no single source page, so name the source of each pattern you reuse — in `notes.md`, as a table:
what you needed, which captured page it came from, and the measured values. Do this before designing;
it is what stops the page drifting into generic.

**A component cannot be imported across pages.** Each snapshot carries only its own inlined CSS, so
writing another page's class name into your donor produces an unstyled element. Reuse means *measure
the source page's computed styles and re-implement*: open the source page, read the real padding,
radius, type and color off the element you want, and rebuild it. Pull anything you still cannot source
from `tokens.json`'s observed ladders — never from your own taste.

**7.6 Ground the data, and never invent plausible-looking identifiers.** Use the library's real
content: real product names, real prices, real dates, real addresses, real status strings. Where the
library records a count but not the contents ("Minutes Basket - 5 Items"), draw `.lofi-line`
placeholders rather than inventing five product names. The same goes for order IDs, tracking numbers,
courier names, and timestamps: a placeholder bar is honest, `OD4127839912` is a lie that survives into
someone's deck.

**7.7 Tag every assumption; keep the prose out of the canvas.** A new page always outruns the library.
Each region the library cannot ground gets `class="lofi-region"` plus **one** `.lofi-tag` chip
starting with `ASSUMED:` — `ASSUMED: STEP NAMES`, `ASSUMED: LIVE DATA`, `ASSUMED: ITEM NAMES`. That
chip is the whole in-canvas annotation; the explanation goes in `notes.md` under an "What the library
could not tell me" heading, one line per assumption. Distinguish the two kinds and say which is which:
invented **structure** (a layout the product has never shown) is normal design work; invented
**content** (data the library does not contain) is a liability and should be listed item by item.

**7.8 Approaches must still differ in model, and still get swap-tested.** 2–3 approaches, written
swap-test lines in `notes.md` before you present. For a from-scratch page the model is usually *what
the page is organised around* — one shipment with many events vs many items with one shipment; a
timeline vs a summary; a single flow vs a set of tabs.

**7.9 Draw the state the page exists for.** New pages are usually built for a live or in-progress
state, and that is exactly the state the library does not have (capture is read-only, and it catches
whatever the account happened to be showing). Design the grounded state as the main artifact, then
give the live state its own frame below it, tagged — and say plainly in `notes.md` that the frame's
content is invented. If the state is reachable by URL, offer the capture instead:
`node tools/capture.js --state <slug>:<state-name> --url "<url>"`.

#### Pre-render checklist — additions for a new page

**Machine-verified** by the same `node tools/lofi-check.js <file>` run: every ungrounded region carries
an `ASSUMED: …` chip *and* `notes.md` carries the matching log — both directions, because a log with an
untagged canvas is the exact failure this check was built for. Plus the `<title>` against every captured
page's title.

**Yours to judge — the checker cannot decide these:**

- [ ] Built on a copy of a real donor page; shell, nav, breadcrumb, footer intact
- [ ] Breadcrumb extended and `<title>` set to this page's name — *the `<title>` half is machine-verified; the crumb is not*
- [ ] `notes.md` carries the vocabulary table (what · which captured page · measured values)
- [ ] Every ungrounded region tagged `ASSUMED: …`; invented content listed line by line in `notes.md` — *the chip is machine-verified; the line-by-line list is not*
- [ ] No invented identifiers (order IDs, tracking numbers, courier names) — placeholders instead
- [ ] The state the page exists for is drawn as its own frame, not described

## Notes

- If the snapshot looks stale next to the live product, offer a re-capture rather than hand-fixing the baseline.
- Full-page screenshots of long pages: crop your presentation to the changed region plus context; the designer shouldn't scroll a 10 000px image to find your edit.
