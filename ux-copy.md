# UX copy canon

## 2026-07-29 — landing v1.2 (populated showcase + the hero decision)

`prds/landing-page-v1.2-populated.md`. **Every locked v1 string is untouched** — re-checked
programmatically (25 locked strings, 0 missing; 9 banned words, 0 present). The showcase workspaces were
re-captured at cap-40 class, so this round's copy changes are the ones the new numbers *forced*, plus two
honest disclosures the new data made available. Nothing was reworded for taste.

**Numbers that moved, and the strings that carry them.** `landing-shots/` (xflowpay) was itself
re-captured, so two quoted values went stale and were re-read at build time:

| Where | was | now | Read from |
|---|---|---|---|
| Tour · Design language body | `×31,920` | `×32,939` | `tokens.json` `colors.top[0] = {value:"#1F2741", count:32939, pages:18}` |
| Tour · Design language alt | `42 single-page values` | `41 single-page values` | the provenance strip's own text in the reshot render |
| Tour · ledger alt | `1 more note` | `3 more notes` | the ledger's own top card in the reshot render |

**One tile caption changed, because the measurement changed.** github.com's accent was the Copilot
marketing green `#5FED83` off a 10-page capture; the fresh 40-page capture measures GitHub's link blue:

- was: `github.com · #5FED83`
- now: `github.com · #0969DA` — `tokens.json.brand.seed`, `source: "observed"`, basis 734× across 40 pages

The other six captions are unchanged: `flipkart.com · #2874F0` · `amazon.in · #2162A1` ·
`espncricinfo.com · #0860C4` · `airbnb.co.in · #DA1249` · `en.wikipedia.org · #3366CC` ·
`xflowpay.com · #5E76E3`.

**Gallery lede — one clause added**, now that the libraries are genuinely populated and the spread is
worth stating (18–41 pages; 11% down to 0.9% explored, both endpoints read off the maps' own stats lines):

- added: `Eighteen to forty-one pages in each library, and each map says out loud how little of its site that is: from eleven per cent down to nine-tenths of one.`

**Two disclosures added — both say something *against* the product, which is why they're here.**

> Added to the "measured, not chosen" note: `Which is also why six of these seven hexes sit inside a twenty-degree band of blue and only airbnb's crimson doesn't — a palette someone picked would be prettier than this, and that is rather the point.`

Measured hues: 209.5° · 211.9° · 212.4° · 217.2° · 220° · 229.2° (a 19.7° span) against airbnb at 343.5°.
v1.1's report claimed this wrinkle was "disclosed on the page" — it wasn't, only in the report. Now it is.

> New third note under the strip: `Nor does every page yield. Following links is all the kit does, so a page that only opens behind a sign-in, or that answers a link with a soft 404, doesn't come home: amazon.in's run recorded seven of those — six auth-redirect, one soft-404 — each with its reason, in the same file that lists what did come home. The maps above are what one read-only crawl reached, not a claim that every page type is reachable.`

Evidence: `landing-shots-amazon/design-context/manifest.json` → `counts.skipped: 7`, and a `skipped[]`
array naming each slug with its reason. The brief asked for this disclosure sourced to espncricinfo's
`/cricketers/:id` and `/records/*` families, which really were blocked during the population run — but
that run finished with a selective `--urls` frontier pull, and `manifest.json` describes only the most
recent run, so the blocked-family record was overwritten. The claim is therefore made on amazon's record,
which survived and which a reader can check. See the build report § F3 and finding 3.

**Unchanged and worth stating:** the hero caption (`eighteen pages downloaded, one hundred and forty-six
still ghosts in the fog. Rings are measured clicks from home.`) still matches the shipped frame exactly —
18 downloaded, 164 found, 146 on the frontier, 1 page at depth 0 and 17 at depth 1 with **none null**. The
three tour panel quotes, the headline `Seven products, seven maps.`, and all of §§1–4 and 6–8 are as v1.1
left them.

## 2026-07-29 — map root detection + two riders (`prds/v1-fix-map-root.md`)

**R2 — the Use-it tab's false "no network" claim, fixed.** `tools/dashboard-template.html:2984`, the
Figma paragraph, ended `No plugin, no Dev Mode, no network.` — flagged in the v1 landing audit
(originally line 2873) and again in v1.1, never fixed until now. A Figma copy makes exactly one
external request (public font files from a CDN), so `no network` was never true. Now reads:

`…your library stays untouched. No plugin, no Dev Mode, no paid seat.`

This matches the canon already used on the landing page and in README / `skills/capture-product/SKILL.md`
(see the `2026-07-28 — landing v1.1` entry below, "The one wording change this build forced"). Both prior
stale-claim pointers below are struck as resolved.

## 2026-07-28 — landing v1.1 (Prateek's feedback round: richer hero · no accidental crops · the map gallery)

`prds/landing-page-v1.1-feedback.md`. **Every locked v1 string above is untouched** — checked
programmatically this round (25 locked strings, 0 missing; banned words, 0 present). What follows is the
new and changed copy only.

**New section — the map gallery** (sits between the dashboard tour and the Figma section; nav gains one
item, `Any product`):

| Slot | String |
|---|---|
| Eyebrow | `ANY PRODUCT` |
| Headline | `Seven products, seven maps.` |
| Lede | `Point it at what you design for. Seven real captures in seven separate workspaces — a marketplace, a retailer, a sports site, a travel platform, an encyclopedia, a payments product, a developer platform — each dashboard wearing that product's own colour, observed rather than configured. Same kit, same one script, nothing set per product.` |

Tile captions — product host + the accent hex **measured** in that product's own pages
(`tokens.brand.seed`, `source: "observed"` in all seven):
`flipkart.com · #2874F0` · `amazon.in · #2162A1` · `espncricinfo.com · #0860C4` ·
`airbnb.co.in · #DA1249` · `en.wikipedia.org · #3366CC` · `xflowpay.com · #5E76E3` ·
`github.com · #5FED83`

The two small-print lines under the strip, both load-bearing for the honesty claim:

> `Every hex above was measured, not chosen: it is the most-used colour in that product's own captured pages that a UI accent could plausibly be, and the dashboard then wears it. Nothing was configured per product — where a product's colour can't clear the dashboard's contrast floor, the kit lightens it just enough and records that it did, which is why amazon.in's measured #2162A1 paints as #2367A9. Where no colour qualifies, no accent is recorded at all and the dashboard keeps its own indigo — absent rather than invented.`

> `These maps are shown small on purpose. At this size a captured product is only its shape — how many pages, how far from home, how much fog — which is all this section claims. Every full-size dashboard view on this page is of one product, xflowpay.com, captured by the person who built the kit.`

**Hero caption — changed** (the numbers are now the real ones for the shipped capture; 18 downloaded,
164 discovered, so 146 locked):

- was: `The Map, on a real capture of xflowpay.com — eight pages downloaded, twenty-one still ghosts in the fog. Rings are measured clicks from home.`
- now: `The Map, on a real capture of xflowpay.com — eighteen pages downloaded, one hundred and forty-six still ghosts in the fog. Rings are measured clicks from home.`

**Dashboard tour — the three panel quotes are unchanged.** Their body prose changed to match the reshot
images:

- **The Map** now shows a selected frontier ghost, so the body earns the "click one to unlock it" claim:
  `…click one, and the rail tells you what it is and what unlocking it would cost. Here a ghost covering thirteen blog pages is selected: the kit offers one example of the shape rather than all thirteen, because thirteen near-duplicates teach your AI nothing new. Eleven per cent of this product is explored, and the kit says so instead of rounding up.`
- **Design language** now shows the Palette view, whose swatches carry the counts the copy claims:
  `…every value carrying the count and page-spread behind it, as here, where the product's darkest navy is ×31,920 across all eighteen pages and the accent is ×141 across four. One toggle re-reads the same colours as a treemap of how often each appears.`
- **The working ledger** gains one clause, because the shipped shot's top slot is a real pending action:
  `…here, ten pages have landed that your AI hasn't read yet, so that is what it asks for, with the prompt ready to copy.`

### Nothing was softened to fit an image

Every number above was read out of the shipped workspace's `registry.json` / `tokens.json` at build time,
not carried over from v1. Where the product's own render disagreed with a planned line, the line changed
— never the render. The one case where that cost the brief its preferred hero product is written up in
`prds/landing-page-v1.1-feedback-BUILD-REPORT.md` (§ "The hero the brief asked for, and why it isn't the
one that shipped").

> ~~**Still stale (unchanged, still out of scope):** the Use-it tab's Figma paragraph in
> `tools/dashboard-template.html` still ends `No plugin, no Dev Mode, no network.` — the same false claim
> v1 flagged (it has drifted from line 2873 to **line 2984**). Fix it to `no paid seat` in the next build
> that touches the template. The Use-it screenshot is still deliberately kept off the landing page.~~
> **Fixed 2026-07-29** (`prds/v1-fix-map-root.md` R2): line 2984 now reads `no paid seat`, matching canon. See the `2026-07-29` entry at the top of this file.

## 2026-07-28 — diversity-sweep fix train (D1–D8)

`prds/v1-fix-diversity.md`, off `prds/v1-diversity-uat-REPORT.md`. New/changed designer-facing strings only — D5 (heading extraction) and D8 (directed gate) introduced no copy.

**D1 — hygiene mid-render finding** (`tools/hygiene.js` — content length no longer consulted; `N` = measured visible loading indicators):
- Measured (post-fix captures): `N loading indicator(s) still visible in the captured DOM — possibly captured mid-render`
- Fallback (pre-fix captures, no `meta.json.visibleLoadingMarkers` yet, demoted to info): `loading markers + thin content — possibly captured mid-render (re-capture to measure)`

**D2 — blocked headless capture** (terminal, printed once at the end of a crawl when `--headless` and the run got 0 pages or a majority `blocked`):
`⚠  Blocked pages + --headless often means the site rejects headless browsers — retry without --headless (a browser window will open).`

**D3 — zero-page capture, INDEX.md** (`build-index.js`'s new empty-registry branch; `‹why›` is `every attempted page was skipped (‹reasons›)`, `every attempted page failed to capture`, or `no capture has run yet, or it found nothing to capture`):
`**No pages are captured yet** — ‹why›. See [manifest.json](manifest.json) for the full detail.`

**D4 — dashboard attempt banner** (rides F7's file:// banner mechanism — `.filebanner`/`--fb-h`, dismissible, zero layout cost when absent; `N` = blocked count):
`Your last capture couldn't download anything — N page${N===1?' was':'s were'} blocked by the site. The wizard below re-runs it; if this keeps happening, the site may not allow automated capture.`
Appended when the last attempt used `--headless` (D2's own string, verbatim, one space before it): ` Blocked pages + --headless often means the site rejects headless browsers — retry without --headless (a browser window will open).`

**D6 — truncated screenshot** (a page taller than `SAFE_SCREENSHOT_HEIGHT` — capped at the viewport resize, never Chromium's scroll-and-stitch, so there's no seam to avoid in the first place; `shownPx`/`fullPx` from `meta.json.screenshotTruncated`):
- Hygiene, info-level: `screenshot shows the first ‹shownPx›px of a ‹fullPx›px page`
- `page.md`'s Files section: `_Screenshot shows the first ‹shownPx›px of a ‹fullPx›px page — the full page is still captured in [content.md](content.md)._`

**D7 — off-origin hosts, INDEX.md** (new section, only when `offOrigin.length > 0`; hostnames are always the decoded `hostDisplay` form — `registry.json` keeps the raw punycode as ground truth):
```
## Off-origin (linked but not captured — a different host)

N hosts linked from captured pages, on a different host the same-origin crawl never follows:

- ‹hostDisplay› (‹inbound› pages link here)
- …and ‹N-10› more — see registry.json's `offOrigin` array
```

## 2026-07-28 — busy states: honest stages, one ring (F1–F2)

`prds/ux-busy-states.md`. F1 replaces the guided-end path's one frozen message with real checkpoints;
F2 adds a ring + `disabled` to every other POST-backed control but introduces no new copy of its own —
every button below keeps its existing label verbatim, the ring is a decorative `aria-hidden` prefix.

**Guided-end staged sequence** (dashboard toast + the "End session" button's own label — same string,
both places; `capture.js`'s `ending`/`browser-closed` GUIDED_JSON phases share the first line):
```
Ending the guided session…            (shown for the instant between click and the first checkpoint)
Closing the browser…                  (phase: ending, browser-closed)
Session saved · N capture[s]          (phase: session-saved — singular at N=1)
Rebuilding the library index…         (phase: indexing)
Running the library check…            (phase: hygiene)
```
`phase:'ended'` carries no copy of its own — it falls straight through to the pre-existing "Guided
session ended — rebuilding your library…" + reload.

**Ledger-card detail line while ending** (replaces the normal "drive to any state…" hint):
`Wrapping up — this finishes on its own, no need to do anything.`

**60s watchdog fallback** (design contract belt — replaces the current stage text if 60s pass with no
new checkpoint; re-armed on every real one, so it only ever fires on a genuine stall):
`Still working — the terminal has details.`

**Abnormal mid-end exit** (child killed/crashed after `ending` started but before `ended` — dashboard
toast and the terminal-facing `error` string are the same text; `<stage>` is one of *closing the
browser* / *saving the session* / *rebuilding the index* / *running the library check*, `<sig>` is a
signal name or `exit <code>`):
`The session ended abnormally while <stage> (<sig>). Pages already captured are safely on disk — check
the terminal for details.`

**Terminal timing line** (F1's instrumentation requirement — `capture.js`, printed once per guided
session on `phase:'ended'`):
`⏱  guided end — browser <b>ms · save <c>ms · index <d>ms · hygiene <e>ms · total <f>ms`

## 2026-07-28 — fold loop + guided-public fix (F1–F4)

`prds/v1-fix-fold-loop-guided-public.md`. Guided capture's GUIDED branch (`tools/capture.js`) gained a
public/logged-out path (F3); new terminal strings below, `<url>` = the guided session's start URL.

**Profile genuinely required** (product marked logged-in, no profile — new, replaces a dead-end that
pointed at `login.js` for a site with no login):
`This product is marked as logged-in — run: node tools/login.js --url <url> (you'll log in yourself; the kit never sees your password)`

**Profile locked by another window** (changed — added the ⌘Q hint, darwin only):
`The capture profile is open in another window (login.js?). Quit it with ⌘Q — ⌘W leaves Chrome running and holding the lock and re-run.`
> Superseded (struck 2026-07-28): `The capture profile is open in another window (login.js?). Close it and re-run.` — non-darwin platforms keep the platform-neutral `Close it fully and re-run.` clause.

**No profile, public fallback** (info line, mirrors the selective-pull branch's existing
`no browser profile — capturing logged-out (fine for public pages).`, adapted to guided):
`no browser profile — guided capture runs logged-out (fine for public pages).`

**Session banner** (mode-aware): `🚀 Guided capture (logged-out) — <url>` when ephemeral, unchanged
`🚀 Guided capture — <url>` otherwise; body line reads `A browser opens in a fresh, signed-out session.`
or `A browser opens on your logged-in session.` to match.


Locked, designer-facing strings shipped in the dashboard and terminal report. Change one, review the
build brief that introduced it; this file is the single source of truth for exact wording.

## 2026-07-28 — landing (docs/index.html, the kit's public page)

`prds/landing-page-v1.md`. New canon: every string below ships on the public page at
`docs/index.html`. The page's headline and sub are locked by the brief; the principles strip is locked
verbatim; body prose is written in the same register (plain, no superlatives — "magic", "10x",
"revolutionary" are banned words).

**H1** (locked): `Your product, as design context any AI can read.`

**Sub** (locked): `A free, open-source kit that captures your product's real screens, tokens, and patterns into a local library — so your AI designs in your product's language, not from generic memory.`

**CTAs:** primary `Get the kit on GitHub` · secondary `See how it works` · the copyable one-liner
(hero and Get-started, identical in both places):
`git clone https://github.com/20prateeksingh/design-context-for-ai.git my-product && cd my-product && tools/start.sh`
Copy-button states: `Copy` → `Copied` (or `Press ⌘C` when the clipboard is refused).

**Section headlines — the final set:**

| Section | Eyebrow | Headline |
|---|---|---|
| How it works | `HOW IT WORKS` | `Three steps, and only the first one is yours.` |
| The library | `WHAT YOUR AI ACTUALLY GETS` | `A folder of facts, with an entry point for machines.` |
| The dashboard | `THE DASHBOARD` | `The part that refuses to guess.` |
| Figma | `STRAIGHT INTO FIGMA` | `Click ⧉ Copy for Figma. Paste. Editable auto-layout layers — no plugin, no Dev Mode, no paid seat.` |
| Principles | `THE RULES IT LIVES BY` | `Boring on purpose.` |
| Get started | `GET STARTED` | `Copy the repo into a folder named after your product.` |

**Three steps** (titles locked by the brief): `Run one script` · `The kit captures` · `Your AI designs grounded`

**Dashboard tour — the three panel lines** (the brief's honesty headlines, as shipped):
- The Map: `Rings are honest clicks-from-home; the fog is what you haven't captured yet.`
- Design language: `Measured from your product, or absent.`
- The working ledger: `It borrows your product's own colour — observed, never guessed.`

**Principles strip** (locked, verbatim — the kit's real invariants):
- `Local-only — captures never leave your machine.`
- `Read-only — it follows links, never clicks your product's buttons.`
- `Never touches credentials — you log in, in your own browser window.`
- `Measured or absent — nothing on the dashboard is invented.`
- `Any AI — Claude Code, Cursor, or a chat window; the prompts ship in the box.`

**No-tracking line** (locked): `This page has no analytics. Like the kit: local-only.`

**Requirements pills:** `Node 18 or newer` · `macOS or Linux` · `no account, no key, no signup`

**Footer:** `MIT` badge · `built in public — 20prateeksingh/design-context-for-ai` ·
`Figma paste powered by @figit/dom-to-figma (MIT)`

### The one wording change this build forced

The brief's Figma line ended `— no plugin, no Dev Mode, no network.` **`no network` is not true** and was
already corrected everywhere else: a copy makes one external request, a cacheable GET of public font
files from `cdn.jsdelivr.net/fontsource`, because Figma drops the pasted text when the converter cannot
embed real font bytes (`prds/figma-exit-copy-paste-BUILD-REPORT.md`, the font-loader revert). README and
`skills/capture-product/SKILL.md` already say `no paid seat`. The landing page follows that canon:

`Click ⧉ Copy for Figma. Paste. Editable auto-layout layers — no plugin, no Dev Mode, no paid seat.`

and the section body states the font request in the open rather than omitting it.

> ~~**Still stale (not fixed here — out of this brief's scope):** `tools/dashboard-template.html:2873`,
> the Use-it tab's Figma paragraph, still ends `No plugin, no Dev Mode, no network.` That is the same
> false claim, shipped in the product. Fix it to `no paid seat` in the next build that touches the
> template. The Use-it screenshot was deliberately kept OFF the landing page for this reason.~~
> **Fixed 2026-07-29** (`prds/v1-fix-map-root.md` R2) — see the `2026-07-29` entry at the top of this file.


## 2026-07-28 — hygiene-speaks-designer (F4: the ledger card)

**Card title** (`#hygcard`, top of the working ledger):
- warn &gt; 0: `Worth a look — N thing${N===1?'':'s'} in the library`
- clean: `Library check — all clean`

**Per-finding line** (`‹A›`/`‹B›` = page display labels, never slugs):

| Finding | Line (locked) |
|---|---|
| same-template (vs rep) | `‹A› uses the same layout as ‹B› — one example can stand for both.` |
| same-template (group, no rep) | `‹A›, ‹B›… share one layout — one example can stand for all of them.` |
| duplicate-content | `‹A› and ‹B› are the same capture twice.` |
| orphan (warn) | `Nothing links to ‹A› — the map can't show how you reach it.` |
| identical-state (vs base) | `The state "‹name›" on ‹A› looks identical to the page itself — the click may not have changed anything.` |
| identical-state (vs sibling) | `"‹n1›" and "‹n2›" on ‹A› are the same view captured twice.` |
| quality: near-empty | `‹A› came back nearly empty — it may have been captured mid-load.` |
| quality: blob images | `Some images on ‹A› were live-only and didn't survive the capture.` |
| quality: missing screenshot | `‹A› has no screenshot.` |
| quality: mid-render | `‹A› may have been captured while still loading.` |

**Buttons:**
- Primary: `Fold into one example` · `Fold into one` · `Say how you got there` · `Re-capture` · `Re-capture it`
- Secondary: `Keep both` · `Keep them all` · `Keep as is` · `It's fine — keep it` · `It really looks like this`
- Tertiary (every warning): `Copy the fix prompt`

**Note-input placeholders:**
- Keep-note (optional): `Why keep it? (optional — your AI reads this)`
- Reached-by (required): `e.g. from the account menu`

**Info-level footer** (collapsed, no buttons): `N more note${N===1?'':'s'} — nothing needed from you`

**file:// / no-server degradation** (POST-backed buttons hidden, `Copy the fix prompt` remains):
`Fixes need the kit's server — run tools/start.sh`

**Terminal report tail** (F1 — acked findings never vanish, they fold into one line):
`N kept on purpose (noted).`

## 2026-07-28 — readability fix train (E1–E17)

`prds/readability-fix-train.md`, off `prds/ai-readability-experiment-REPORT.md` (Fable-vetted). Every shipped `PROMPTS.*` string now carries a stable ID, canon `prds/use-it-layer.md` Appendix A.1–A.7 plus A.8–A.10 (established by earlier builds) and new A.11 (`askQuestion`, never previously numbered). Changed prompt bodies below are a canon change; unlisted IDs (A.1, A.3, A.4, A.5, A.9, A.10) are unchanged, verbatim.

**A.6 `recaptureCheck`** (E1 — was hard-coded to a wizard-only file, broken on any CLI-captured library):
`The product may have changed. Re-run the capture with the same settings as last time — use \`design-context/product.json\` if it exists, otherwise read the parameters recorded in \`design-context/manifest.json\` and rebuild the command from those. Then compare \`contentHash\` changes in \`design-context/registry.json\` and tell me which pages changed and whether their descriptions need updating.`
> Superseded (struck 2026-07-28): `The product may have changed. Re-run \`node tools/capture.js --config design-context/product.json\`, then compare \`contentHash\` changes in \`design-context/registry.json\` and tell me which pages changed and whether their descriptions need updating.`

**A.2 `wireframe`** (E7 — prepended the registry-first clause the surface was missing):
`Read \`design-context/registry.json\` for the shape of this product, then \`design-context/pages/<slug>/page.md\` and its \`screenshot.png\` for the page itself. I want to explore: ‹describe your change›. Per \`skills/wireframe-on-snapshot/SKILL.md\`: work on COPIES in \`wireframes/<slug>/round-1/\` (never edit \`design-context/\`), keep the product's real shell, make 2–3 genuinely different approaches, new elements visibly lo-fi, then render previews with \`node tools/shot.js\`.`

**A.7 `bootstrap`** (E4 — `INDEX.md` replaced by `registry.json` as the entry file, matching the other three surfaces):
`You're in a designer's workspace. Read \`AGENTS.md\` first and follow its five rules. Then read \`design-context/registry.json\` to learn this product, and ask me what I want to work on.`

**A.8 `designNew`** (E10 — the `‹concept›` placeholder made self-evidently the designer's to resolve):
`… work on a COPY in \`wireframes/new/<kebab-case name for this concept, your choice>/round-1/\` (never in \`design-context/\`) …`

**A.11 `askQuestion`** (new ID assignment only — text unchanged, first canonized 2026-07-28).

**Use-it tab lead** (E2 — state-aware, mirrors the ledger's existing `everRead` branch; was a false "your AI has read this library" claim on a 0-described library):
- `identity.described > 0`: `your AI has read this library · answers and designs will be grounded in it, not generic`
- else: `nothing has read this library yet · start with **Describe the pages** below, then answers and designs will be grounded in it, not generic`

**Chat-only context bundle — closing instruction** (E8 + E9 — was one fixed sentence; now states what the model does and doesn't have, and the provenance clause is conditional on whether any page has been described):
`You are helping a designer. The above is a captured snapshot of a real product: everything here was extracted from the live site.${described>0 ? ' The one exception is the page descriptions, labeled method: ai — model-written orientation.' : ' No page has been described yet, so every line above is raw scraped text — including the page names, which are nav strings and may be truncated or run two phrases together.'} Do not invent pages, routes, or features not listed here; build on what exists. You have only this summary — no page HTML, no screenshots, no page copy — so you can answer questions and sketch structure in text, but you cannot produce a real wireframe on the product's own markup. If the designer asks for one, say so and point them at the workspace folder, where an AI with file access builds it on the captured page. Ask the designer which page to work on.`
> Superseded (struck 2026-07-28): `You are helping a designer. The above is a captured snapshot of a real product: everything was extracted from the live site, except page descriptions (labeled method: ai — model-written orientation). Do not invent pages, routes, or features not listed here; build on what exists. Ask the designer which page to work on.`

**CLAUDE.md / AGENTS.md — hard-rule additions** (E5, E16 — not dashboard copy, but canon-worthy standing instructions): the describe-step exception to "never edit library files" (rule 1); the designer-owned `annotations.json.hygiene` block + derived `foldedInto`/`template` fields, one sentence each surface.

**INDEX.md front-matter** (E4 — new, machine-readable, first six lines): ` ```\ndescribed: N/M · states: N · frontier: N · offOrigin: N hosts · labels: scraped\n``` `
