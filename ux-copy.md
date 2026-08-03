# UX copy canon

## 2026-08-04 — em dashes swept out of the landing page's user-facing text (46 replacements, `docs/index.html` only)

**This supersedes every string quoted in the dated sections below wherever an em dash appears in
landing-page copy. Those sections are not edited** — each records what its own round shipped, and
rewriting them would make a past round claim copy it never shipped. Read them as history; read this
section for what ships now.

**Why.** `wiki/concepts/blog-writing-voice.md` records *"No em dashes. Ever."* as Prateek's standing
instruction (2026-08-03). The landing page carried **93**. Either the rule was blog-scoped or the page
was 93 violations behind it; Prateek's ruling on 2026-08-04 was to sweep the page.

**What changed, by kind.** Every em dash in visible prose, `<title>`, the meta description, alt text,
`figcaption` and `aria-label` was replaced with a colon, a comma, parentheses, a period, or a small
rewrite, chosen per sentence rather than mechanically. **93 → 39.**

**What deliberately did not change, and why the number is not zero:**

1. **Source comments (25).** HTML, CSS and JS notes in `docs/index.html`. Engineering prose, invisible
   to users, and this repo's own wiki and briefs use em dashes throughout.
2. **Quoted product strings inside alt text (14).** Five `alt` attributes *transcribe* what the
   dashboard actually renders — `'DEEP FOG…4205 MORE — TEMPLATES STAND FOR MOST'`, `'Locked — not
   downloaded yet'`, `'Everything below is method: heuristic — …'`, `'Library check — all clean — …'`,
   `'not linked from home — 2 pages'`. Rewriting them would make the alt text describe text that does
   not exist. **The em dashes are in the product's UI, not on this page.**

> **Open question:** `tools/dashboard-template.html` therefore still generates em-dashed UI strings,
> which is why the alt text above cannot be cleaned. Sweeping the dashboard is a larger job and it
> invalidates all 15 screenshots in `docs/assets/`, so it was not folded into a copy sweep. Prateek's
> call whether the rule reaches the product UI at all.

### The locked lines that had to be re-worded

Six lines carried a `locked` marker and an em dash. The lock was honoured by recording the change
here rather than by leaving the page inconsistent. **Reversible on Prateek's word.**

| Was (locked) | Now |
|---|---|
| `Local-only — captures never leave your machine.` | `Local-only:` + `captures never leave your machine.` |
| `Read-only — it follows links, never clicks your product's buttons.` | `Read-only:` + `it follows links, never clicks your product's buttons.` |
| `Never touches credentials — you log in, in your own browser window.` | `Never touches credentials:` + `you log in, in your own browser window.` |
| `Measured or absent — nothing on the dashboard is invented.` | `Measured or absent:` + `nothing on the dashboard is invented.` |
| `Any AI — Claude Code, Cursor, or a chat window; the prompts ship in the box.` | `Any AI:` + `Claude Code, Cursor, or a chat window; the prompts ship in the box.` |
| **Sub** `…into a local library — so your AI designs…` | `…into a local library, so your AI designs…` |

On the five principles the em dash was a **key/value separator in markup**, not prose punctuation:
`<span class="k">` + `<span class="v">— text</span>`. The colon moved onto the label, where it belongs
semantically, so no CSS changed and the rendered meaning is identical.

**The no-tracking line was unaffected** — `This page has no analytics. Like the kit: local-only.` has
no em dash and still ships verbatim.

### Other notable strings now shipping without em dashes

- **Title:** `Design Context Kit: your product, as design context any AI can read`
- **Figma H2:** `Click ⧉ Copy for Figma. Paste. Editable auto-layout layers. No plugin, no Dev Mode, no paid seat.`
- **Ledger quote line:** `It borrows your product's own colour: observed, never guessed.`
- **Network disclosure** (the F2 string below, its one em dash only): `Neither uploads your page: the
  conversion happens in your own browser, and no data of yours is sent to either host.` Substance
  untouched. `README.md` was checked and carries **none** of the swept strings, so nothing diverged.
- **Footer:** `built in public: 20prateeksingh/design-context-for-ai`

## 2026-08-02 — the network disclosure is rewritten: it described a converter that is no longer the one that runs (`prds/pre-ship-fixes.md`, F2)

**This supersedes the `2026-07-30 — README discloses the one outbound request` entry below.** That
entry's string was true when written and is now false. `73e3492` made Figma's own `capture.js` the
**primary** converter, loaded at click time from `mcp.figma.com`, with the vendored MIT bundle demoted
to fallback — so the claim that the font-CDN request is *"the only time the kit reaches the network on
your behalf"* understates the kit's egress by one host, and that host was named in **zero**
user-facing documents. A factual, privacy-adjacent misstatement is the worst possible thing to be
wrong about in a product whose whole pitch is honesty, and it is the first thing a designer's employer
checks.

The old string had been deliberately synchronised **word-for-word** across three surfaces, so all
three had to change together. Found by grepping the phrase repo-wide rather than trusting the brief's
list of files — which named `README.md` and `ux-copy.md` but not the landing page:

- `README.md` — the Figma-paste paragraph in "After capture — use it"
- `docs/index.html` — the Figma section's `<p class="note">`, i.e. the **public** page
- this file — a dated quotation, left standing as history (see below)

**Retired string** (all live surfaces):

> ~~One caveat stated plainly: to keep the pasted text as text, the converter fetches public font files from a CDN during a copy — that single request is the only time the kit reaches the network on your behalf, and it carries none of your data.~~

**New, `README.md`** — a two-item list rather than one sentence, because there are now two moments and
compressing them into one clause is how the first version went stale:

> **Two network moments, stated plainly, because a copy is the one thing here that reaches outside your machine:**
> - **A copy loads Figma's own converter from `mcp.figma.com`** at the moment you click. It is Figma's code, fetched fresh each time rather than shipped inside the kit, and it runs in your browser like any other script on the page.
> - **If that host can't be reached** — you're offline, or your network blocks it — the copy falls back to the converter bundled under `tools/vendor/`, which fetches public font files from a CDN so your pasted text stays text instead of disappearing. The success message names whichever converter ran, so you always know which one you got.
>
> Neither path uploads your page or your library. The conversion happens entirely on your machine, and no data of yours is sent to either host.

**New, `docs/index.html`** — the same substance in one sentence, because the note sits under a diagram
and a list would break the section:

> Arrange or restyle freely; your Figma library stays untouched. Two network moments, stated plainly: a copy loads Figma's own converter from `mcp.figma.com` at the moment you click, and if that host can't be reached it falls back to the converter bundled with the kit, which fetches public font files from a CDN so your pasted text stays text. Neither uploads your page — the conversion happens in your own browser, and no data of yours is sent to either host.

Three wording calls worth keeping:

- **"loads … from `mcp.figma.com`", not "fetches a script".** The host is the fact a security reviewer
  is looking for, so it is named in prose, not left implicit in a URL.
- **The fallback is described by its trigger, not its name.** A designer does not need to know the
  words *dom-to-figma* to understand "if that host can't be reached". The engine names live in
  Credits, which is also corrected in this round — it credited only the MIT bundle, which is now the
  understudy.
- **"no data of yours is sent to either host" replaces "it carries none of your data".** The old
  phrasing was scoped to a single request; the new one is scoped to both, which is the claim that has
  to hold.

The retired string is left **quoted intact** in the 2026-07-30 entry below rather than edited out:
this file is a dated ledger, and rewriting what a past build shipped would destroy the only record
that the claim was ever made. So a repo-wide grep for the old phrase still returns that one
historical line, by design.

### The same round, F3 — the README's Windows note, and the last two static `⌘V`s

**This closes the loop the `2026-08-01b` entry left open.** That entry made the dashboard's `⌘V`
strings branch on `IS_MAC`, and correctly noted that markdown cannot branch. The two static files
that carry the same string were never revisited, so they shipped a Mac keystroke to Windows readers.
Both are now shortcut-free rather than platform-branched — the same call the success toast made, for
the same reason: not naming a keystroke cannot go stale.

**`README.md`** — the Figma-paste sentence:

> **New:** `click ⧉ Copy for Figma and paste into your Figma file.`
> Superseded (struck 2026-08-02): ~~`click ⧉ Copy for Figma and paste into your Figma file (⌘V).`~~

**`skills/capture-product/SKILL.md`** — the §6 wrap-up line, quoted from prompt canon **A.10**. This
one was the worst of the three, because the reader is the **assistant**: a wrong keystroke here gets
repeated to a Windows designer in conversation, where no grep will ever find it. So the fix also
states *why*, to stop it being re-added:

> **New:** `… one click copies that snapshot to the clipboard and it pastes into Figma as editable auto-layout layers. Don't name a paste shortcut — the designer may be on Windows, where ⌘V is wrong; the dashboard's own copy is platform-aware and this file can't be.`
> Superseded (struck 2026-08-02): ~~`… it pastes into Figma (⌘V) as editable auto-layout layers.`~~

**`README.md`'s Windows note** — rewritten, three things wrong with it. It contained the same `&&`
that parse-errors in PowerShell (so the note written *for* Windows readers did not run there); it
said *"the Windows path hasn't been through a cold-start test yet"*, which stopped being true on
2026-08-02; and the capture command it pointed at omitted `--logged-out`, without which the first
real command a terminal designer runs **fails on any public site**.

> **New:** `Windows: both .sh scripts are macOS/Linux only — setup.sh included. Run these three lines instead, one at a time (Windows PowerShell has no &&, and chaining them is a parse error that stops the line before anything in it runs): … The node commands above then work exactly as shown. Windows has been through a cold-start run of both routes — the AI-assisted one and this one — and capture, the dashboard, design-language extraction and folder paths containing spaces all came through clean. What it doesn't get is the double-click convenience: the .sh scripts need Git Bash, and even there they won't open your browser for you, so open the dashboard URL yourself.`
> Superseded (struck 2026-08-02): ~~`… Substitute npm install --prefix tools and then cd tools && npx playwright install chromium … The Windows path hasn't been through a cold-start test yet, so the AI-assisted route above is the better bet there.`~~

Two calls worth recording:

- **The untested claim is replaced, not just deleted.** Saying nothing would leave a Windows reader
  guessing; a blanket *"hasn't been tested"* costs trust for no reason once it has been. So the new
  copy names what was actually exercised and, in the same breath, the one thing Windows genuinely
  doesn't get — the double-click. Specific caveats buy trust where blanket ones spend it.
- **`Requirements` had to move with it.** It still read *"macOS/Linux with Node.js"*, which flatly
  contradicts a note claiming Windows works. Now `macOS, Linux or Windows`, pointing Windows readers
  at the three commands instead of at `setup.sh`.

## 2026-08-01 — dark capture and modern color (`prds/dark-capture-and-modern-color.md`)

Off a live capture of `tailwindcss.com` that came back as a white page with a three-color palette.
Two unrelated engine defects, one screen. Every string below is terminal or JSON — no dashboard copy
changed in this round, and `dashboard-template.html` was not touched.

### `--color-scheme` (D1)

The flag itself, in `capture.js`'s usage block:

> **New:** `[--color-scheme light|dark]  which face of a product that keys off `prefers-color-scheme` to capture. Also readable from design-context/product.json's `colorScheme`. UNSET = whatever the browser does by default (light).`

and, as the last line of the multi-line usage error, deliberately phrased from the designer's side of
the screen rather than the browser's — *the face you actually see*, not *the emulated media feature*:

> **New:** `add --color-scheme dark to capture a dark product in the face you actually see`

The crawl banner names it only when it was asked for, so an ordinary capture's banner is byte-identical
to before:

> **New (fragment):** `(depth 2, cap 25, dark scheme, read-only)`

A value that is not one of the three accepted words is refused out loud and the capture continues on
the default — never guessed at, never silently mapped to `dark` because it looked dark-ish:

> **New:** `⚠  color scheme "aubergine" is not light | dark | no-preference — ignoring it and capturing the browser default.`

### The two disclosures on the token path (D2)

`tokens.json`'s `note` gains ONE sentence, and only when at least one color really was gamut-mapped —
absent on every workspace with nothing to disclose, which is also what keeps 17 libraries byte-identical:

> **New (appended to `tokens.json.note`):** `Some colors are outside sRGB and have been gamut-mapped (chroma reduced in OKLCh, CSS Color 4 §13.2) to give a copyable hex — those swatches are slightly less saturated than the product ships; see colors.gamutMapped.`

And the counter that is the actual point of the round — being unsupported used to cost nothing, so an
unknown color function has to name itself on stdout as well as in the file:

> **New:** `⚠  21,796 color observations in 88 unknown form(s) could not be parsed — lab, oklab, oklch (see tokens.json → colors.unparseable)`

New `tokens.json` keys, both present only when non-zero: `colors.gamutMapped` (count) and
`colors.unparseable` (`{values, observations, functions, examples}`). Per-swatch, an entry carries
`gamutMapped: true` only when chroma reduction actually moved the 8-bit hex — see the BUILD-REPORT for
why "technically outside sRGB" is the wrong bar for a disclosure.

### `lofi-bake` (D3)

The bake's stats line gains one key, again only when something really could not be read:

> **New (stats key):** `colorsLeftUnbaked: ["<the raw color function>", …]`

and the console path now has a prerequisite, so it says so instead of failing on an undefined:

> **New:** `lofiBake: tools/color.js must be loaded first (it defines window.__dckColor)`

## 2026-07-30 — beta marker (B1–B2) and the twelfth prompt (§R)

`prds/beta-marker.md`, off Prateek's 2026-07-29 field test: *"Can we add a beta tag to our product and
our website because technically our software is still in beta?"* Two new strings.

### The beta marker (B1/B2)

> **New:** `Beta`

One word, two surfaces, same wording so it reads as one claim rather than two: the dashboard's `#betachip`
(`tools/dashboard-template.html`, next to the brand in `#shell`, single-sourced as `BETA_LABEL` inside
`boot()`) and the landing page's `.beta-mark` (`docs/index.html`, next to the `.mark` in the header band).
Both render the word in the same neutral `--dim`/`--line-2` chip language — status, not a problem, so it
is never mistaken for the `--warn`-colored `file://` banner or a hygiene finding. Neither surface's other
identity strings ("AI Design context", "Design Context Kit") were touched — B3 only single-sources the
*beta* marker; the product name stays exactly as fragmented as it already was (that's Prateek's open
decision, tracked separately — see the BUILD-REPORT's B3 section for the full occurrence map).

### A.12 — Learn what pattern mining will do (§R rider)

`prds/beta-marker.md` §R. A twelfth copyable prompt has lived in the Components bento's dormant teaser
(`tools/dashboard-template.html`) since the pattern-mining slot was added — an inline string literal,
outside the `PROMPTS` object, absent from this file and from `tools/test-prompts.js`'s coverage, and the
only copyable chip in the product that didn't share the other eleven's shape (`prds/prompt-readability.md`,
`fbf2559`). Promoted into `PROMPTS.patternMining`, reshaped to the same shape, and now covered by
`test-prompts.js` (12 prompts, count asserted).

> **New:**
````
Explain what 'pattern mining' would add to this design-context library.

- It would analyze the captured `page.html` files for repeating components — buttons, cards, rows — so new designs reuse the product's real parts.
- Describe what the Components section would then show.
- Don't run anything yet — just explain.
````

Unlike A.1–A.11's reshape, this is a **first canonization**, not a reshape of a previously-locked string —
so its wording was checked against the Components card's own current copy ("Components — the product's
repeating parts" / "Mined components are in `patterns.json`") rather than preserved byte-for-byte from the
pre-existing inline literal. It matched; only the layout and two backtick spans (`page.html`) changed, to
match the other eleven prompts' own convention of backticking filenames. No `‹placeholder›`, so the
`FILL THIS IN:` marker line doesn't apply — the shared-shape assertions in `test-prompts.js` that only run
`if (text.includes('‹'))` simply don't fire for this prompt, which is what "holds" means for one with no
placeholder.

## 2026-07-30 — dashboard interaction round: the hygiene card's expand/collapse labels

`prds/dashboard-interaction-round.md`, I2. One string exists in two states; nothing else in this round
touches copy (I1 is a routing fix, no new text).

> **New:** `Show details ▸` (collapsed) / `Hide details ▾` (expanded)

The hygiene card's toggle button, `#hygtoggle`'s `.hygchev` span. The locked title string —
`Worth a look — N thing(s) in the library` / `Library check — all clean` — does not change and is not
touched by this entry; it is what stays visible in the collapsed row, which is how the card keeps the
"loud, never silent" rule while collapsed. "Show/Hide details" was chosen over a bare chevron alone
because the button has no visible text otherwise for a screen reader that does not surface
`aria-expanded`, and over "Expand/Collapse" because "details" names what is behind the toggle (the
findings) rather than describing the mechanism.

## 2026-07-30 — map performance and direction (P1–P5): the ring claim gets its bound, and the links say which way they go

`prds/map-performance-and-direction.md`. Three strings change and one is added. P1–P3 are geometry,
paint and file plumbing and change no copy at all.

### The ring claim now carries its bound (P5)

> **Superseded:** ~~`rings are honest clicks-from-home`~~
> **Current:** `rings are honest clicks-from-home, as far as this capture went`

`#mapstats`. Nothing about the encoding changed and the old sentence was not a lie — but it was
*unbounded*, and the bound is real: `clickDepth` is `min(true depth, crawl depth)`. Measured across all
nine libraries at the time of writing, the crawl stopped at depth **2** in seven of them and depth **1**
in two (`kit-dashboard`, `testing-grounds-kit`), and in seven of nine the deepest ring on the map is
exactly the crawl's own limit. So the ring axis is partly reporting a CLI flag, and a reader has no way
to tell the difference between "nothing is three clicks away" and "we stopped looking at two".

The correction is six words, not a redesign, and that is deliberate: the claim was already the honest
one available. Two readings were rejected — *rings are clicks-from-home up to the crawl depth* (accurate
and unreadable; "crawl depth" is not a phrase a designer owns) and dropping "honest" (the word is doing
work — it distinguishes this axis from the decorative fog, and the M2 round is what earned it).

**A depth-1 library reads correctly too**, which is the case worth checking: on `kit-dashboard` the map
is a single ring, and *as far as this capture went* is exactly what one ring means.

### Direction is now stated, not just drawn (P4)

New `#maplegend` row: `a link brightens toward where it points`, with a gradient swatch.

The stroke ramp is the cue (see the build report for the measured brightness gain); this row is the key
to it, and it belongs in the legend rather than in `#mapnote` for two reasons. `#mapnote` is the map's
one deliberately pill-less line, so it is the one place text can land on a bright disc thumbnail — the
map-legibility round already logged a real 1.51:1 contrast failure there on airbnb — and it is already
three clauses long. The legend is a surface with a hairline, it already explains every other spatial
encoding, and it puts the key in the same screenshot as the thing it explains.

### The hover peek states both directions

> **Superseded:** ~~`linked from N pages`~~
> **Current:** `N in · M out`

`#peek`'s footer. The peek was the one place a reader could check a link count, and it reported only
inbound — so on a page whose single visible edge went *out* to home, the peek could not settle the
question the strokes had raised. `N in · M out` is the phrasing the home pill has used since v2.5.1, so
this is one form in two places rather than a second form. It is also shorter than the line it replaces,
so the footer row is unchanged in height.

Locked (frontier) nodes keep `linked from N pages`: they have no captured `linksTo`, so an `M out` there
would be a zero that means "not downloaded", not "links nowhere".

## 2026-07-30 — map legibility (M1–M4 + §R rider): one ruling reversed, zero strings changed

`prds/map-legibility-round.md`. **No user-visible string in the dashboard changed in this round** — M1
(disc sizing), M2 (clustering), M3 (region boundaries + member hover) and M4 (hover links) are all
geometry and paint. The legend still reads `explored — size = how linked-to`, and it is still true: size
is still inbound-link count, over a narrower range. `#mapstats` still prints *rings are honest
clicks-from-home*, and this round is the first build in which that sentence is literally true rather
than nearly true (radial drift was up to 86px; one xflowpay disc read back to the wrong ring). The
§R rider is CSS only.

**One recorded ruling is reversed, and the entry exists to record it.**

> **2026-07-28 ruling (reversed):** offered three ways to stop the `Everything else` catch-all from
> swallowing the pointer, Prateek rejected option 1 — "make the catch-all inert" — because it *"hides
> real district stats"*, and chose smaller-area-wins instead. That shipped as the §R largest-first paint
> order.
>
> **2026-07-30 ruling (current):** the catch-all is **pointer-inert**. It keeps its background fill; it
> loses hover, the `#maphot` wash and the district card.
>
> **What changed is the reading of the stats, not the preference.** `computeRegions()` builds the
> catch-all from every nav section that has exactly ONE member, so its card was reporting
> `explored = <number of one-page sections>`, `fog = 0`, `states = N` — an aggregate over sections that
> have nothing to do with each other. That is a count of "sections with one page", not a district's
> stats, so the 2026-07-28 objection turns out not to apply to what the card actually said. The arc
> label already carries the headline count, and every one of those pages still has its own disc, its own
> hover peek and its own rail panel. Nothing readable was lost.
>
> **The §R largest-first paint order stays.** Two *named* districts can still nest, and §R is what gives
> the pointer to the smaller one. Inert-catch-all solves the motivating case more directly; it does not
> replace the rule, and removing it would reopen the nested-named-regions case.
>
> Targeted by the region's `merged` flag, never by matching the string `Everything else` — the name is a
> label, the flag is the fact.

**Copy that is now load-bearing in a new way** (unchanged text, new obligation):

| string | where | what now depends on it |
|---|---|---|
| `rings are honest clicks-from-home` | `#mapstats` | every captured disc is clamped to its own ring band, so the claim is exact. Do not widen `BAND_MAX` past half the ring pitch without re-reading this line. |
| `explored — size = how linked-to` | `#maplegend` | still inbound count, now over 32–62px and normalised against **captured pages only**. A ghost can no longer shrink a real page. |
| `hover a region for its district` | `#maplegend` | true of named districts only. The catch-all has no hover — and no boundary — by design. |

## 2026-07-30 — busy states everywhere: a reduced-motion-safe ring, and a progress pill inside the capture window (B1–B2)

`prds/busy-states-everywhere.md`. B1 is a CSS/JS fix, not new copy (the ring's existing labels are
untouched). B2 is new: a read-only status pill injected into the capture browser window itself for
the three modes that were silent before (`crawl`, `--urls`, `--state`) — guided capture already had
one. Same visual family as the guided pill (dark rounded pill, bottom-center, a dot + one status
line) but output-only: no button, no input, nothing to click. `capture.js` builds the line from three
parts, always in this order — the "don't touch this" notice never scrolls out of the line, and the
progress fragment is the only part that changes as the run proceeds:

```
Design Context Kit — driving this window, please don't click · <status fragment>
```

**Status fragment, one of** (`<label>` is the page's slug or `pslug › stateName`; never the raw URL —
matches the guided pill's own choice not to show URLs):
```
starting capture…                          (before the first page's target is known)
capturing <n> of <total> — <label>         (crawl's queue, or a --urls pull — both know their total up front)
capturing <label>                          (depth-2 template follow-ups — the total isn't known until
                                             each group is discovered, so no "n of total" is shown; see
                                             the brief's honesty gate — a count here would be a guess)
```

`--state` (always exactly one target) reads as `capturing 1 of 1 — <pslug› ‹stateName>`.

**Why not the guided pill's copy verbatim:** guided is interactive (a person is driving, the pill asks
them things) — the sentence "please don't click" would be actively wrong there. The two pills share a
look, not a script, because they make opposite promises about who's in control.

**Dashboard-side agreement:** `runCapture`'s existing toast — `Capturing ${urls.length} page(s) — watch
the browser window…` — already promises something will be visible in the window and names no specific
mechanism, so B2 fulfills that promise without any wording change on the dashboard side.

## 2026-07-30 — the assisted entry point: `INSTALL.md`, and the desktop app as the recommended client

The paste-into-chat entry point asked the agent to *infer* the install procedure from a human-facing
README (`Set up the design context kit from <repo URL> in a new folder`), and pointed at a
`GETTING_STARTED.md` that has never existed in this package. Replaced with a fetchable,
agent-facing file. Two framing changes ride along: the recommended client becomes the **Claude
desktop app** (P1 is terminal-averse, and the desktop app is the one surface where capture and
consumption happen in the same window), and Claude Code **on the web** is named as unsupported
rather than left to fail.

**The bootstrap prompt** (locked — identical on the landing page and in the README):
`Read https://raw.githubusercontent.com/20prateeksingh/design-context-for-ai/main/INSTALL.md and follow it.`

**Landing, Get-started section — the assisted lede** (replaces the `Using Claude Code? …` lede and
its dead `GETTING_STARTED.md` link): names the desktop app first, the CLI second, discloses that
either needs a Claude subscription while the kit needs no account, and adds a note line pointing at
`INSTALL.md` (for the assistant) vs the README (for the person), closing with the web-surface
exclusion.

**README — `Fastest start`**: the prompt above, plus `INSTALL.md` is written for the assistant; you
don't need to read it.

**README — recommended client** (was `With Claude Code (recommended): cd <your-workspace> && claude`,
a shell command sitting under a "you don't write code" promise): splits into
`With the Claude desktop app (recommended, no terminal)` — carrying the **open it on this folder, not
the folder above** instruction — and `With the Claude Code CLI` beneath it.

**README — Windows note** (factual correction, not a new claim): the old note routed Windows users
to "the three step-by-step commands", the first of which is `tools/setup.sh` — also a `.sh` script.
Now names the two `npm`/`npx` substitutes and `node tools/map.js --port 4173`, and states plainly
that the Windows path has not been through a cold-start test.

**CLAUDE.md / AGENTS.md / `skills/capture-product` — standing instructions** (canon-worthy per the
E5/E16 precedent):
- **CLAUDE.md §0 "If you just got here"** — the working directory may be the folder above; tell the
  designer to reopen on this folder (subfolder instructions load on demand and are not restored
  after a compaction); re-read this file when unsure late in a session; don't let `/init` regenerate
  it, and change `AGENTS.md` in the same edit.
- **`Starting the dashboard`** — `node tools/map.js --port 4173`, **backgrounded**: it is a server, so
  a foreground call blocks until timeout. `tools/start.sh` is reclassified as the *designer's*
  double-click path, explicitly not for an agent to run. This closes a real defect: every agent-facing
  surface previously said "run `tools/start.sh` (or offer to run it)", which hangs the caller.
- **AGENTS.md closing rider** — resolve paths against the folder holding `tools/` and
  `design-context/` when started one level up.

**Hard rules 1 and 3 gain an enforcement clause** (same round, same E5/E16 precedent — standing
instructions, not dashboard copy). `.claude/settings.json` now **denies** every file-editing tool on
the library's ground truth and derived views, and denies read *and* write inside `profiles/`. The
rules' wording is unchanged; each gains a sentence saying the rule is enforced rather than asked, so
a refused edit reads as the rule working instead of a malfunction — with the recovery named
(`node tools/build-index.js`, a subprocess, is unaffected) and the two deliberate omissions stated
(`page.md` for rule 1's describe exception, `annotations.json` for the designer's own notes).
Deliberately **not** mirrored into `AGENTS.md`: that file exists for hosts that don't load Claude
Code settings, so a note about Claude-specific enforcement would be noise there. The rule itself is
already identical in both.

**`.claude/skills/` stubs — the drift note is the copy that matters:** both skills are now invokable
(`/capture-product`, `/wireframe-on-snapshot`), but the stub bodies say outright that
`skills/<name>/SKILL.md` is canonical and name why (the path is referenced from `CLAUDE.md`,
`AGENTS.md`, the dashboard prompts, and at runtime by `tools/lofi-check.js`, `tools/lofi-bake.js` and
`tools/capture.js`). `CLAUDE.md`'s tree carries the same instruction: **edit the file under `skills/`,
never the stub.**

## 2026-07-30 — README discloses the one outbound request (`prds/small-open-items-round.md`, S3)

> **SUPERSEDED 2026-08-02** — see the `pre-ship-fixes` F2 entry at the top of this file. The string
> quoted below was accurate on `5799f11` and became false on `73e3492`, when `capture.js` from
> `mcp.figma.com` became the primary converter and this font-CDN request stopped being the only one.
> It is quoted here as history; do not copy it onto any surface.

`grep -ci "cdn\|font\|no network"` on `README.md` returned 0 — the kit's honesty thesis is its whole pitch,
and the Figma-paste font-CDN request had already been through two claims audits on other surfaces (the
landing page's own line, corrected in the "The one wording change this build forced" entry below, 2026-07-28;
the Use-it tab's line, corrected in the `2026-07-29 — landing v1.2` entry's R2), but the README — the actual
front door for anyone cloning the repo — said nothing.

Added to the Figma-paste paragraph in `README.md`'s "After capture — use it" section, immediately after the
existing `No plugin, no extension, no Dev Mode, no paid seat; your library stays untouched.` sentence, **word-for-word
identical** to `docs/index.html`'s Figma-section body (canon since v1, `8b0a582`, unchanged since):

`One caveat stated plainly: to keep the pasted text as text, the converter fetches public font files from a
CDN during a copy — that single request is the only time the kit reaches the network on your behalf, and it
carries none of your data.`

Whole file re-read for contradicting claims — none found. The rules section's `Read-only capture` (`Nothing
on your product can be created, deleted, sent, or paid`) is a claim about the user's *product* during
capture, not about the kit's own egress, so the font-CDN disclosure doesn't contradict it. No other `network`/
`local-only` claim exists anywhere else in `README.md`.

## 2026-07-30 — landing v1.3 (the warm reshoot: wikipedia hero + described tiles)

`prds/landing-page-v1.3-warm.md`. **Every locked v1 string is untouched** — re-checked programmatically by
`gates.js` (0 locked strings missing, 0 banned words present). The describe run took all six showcase
workspaces to 100% described, and `779ffbb` (covered-shapes) shipped a new map encoding; between them they
forced this round's copy. As in v1.2, nothing was reworded for taste.

**The hero changed product.** v1.2 kept xflowpay because wikipedia lost one of five criteria —
`1 of its 37 discs wears the product's accent` — and the cause was `described: 0`, since the accent rim
marks a page whose description has been written. That cause is gone: 41/41 described, 33 of 36 discs
rimmed. Criterion 5 is now *contested* rather than won (xflow still leads on proportion, 100% vs 91.7%,
and on accent pixels at its own tier); the flip was decided on the full table in the v1.3 build report § F1.

- was: `The Map, on a real capture of xflowpay.com — eighteen pages downloaded, one hundred and forty-six still ghosts in the fog. Rings are measured clicks from home.`
- now: `The Map, on a real capture of en.wikipedia.org — forty-one pages downloaded, 4,593 still ghosts in the fog. Rings are measured clicks from home.`

Read from `landing-shots-wikipedia/design-context/registry.json`: `identity.downloaded: 41`,
`identity.found: 4634`, `frontier.total: 4593`. The hero alt text was rewritten to describe that frame —
two rings labelled one/two clicks, three purple `×N` discs (largest `×2.9k`), 14 ghosts, the
`DEEP FOG…4205 MORE` chip, and the `0.8% of the known world explored` footer.

**One string was not stale but FALSE, and the describe run is what falsified it.** The ledger's top slot is
state-dependent: with pages unread it asks for the describe run; with none unread it moves on. `landing-shots`
went 8/18 → 18/18, so the panel no longer says what the page said it says.

| Where | was | now | Read from |
|---|---|---|---|
| Tour · ledger body | `here, ten pages have landed that your AI hasn't read yet, so that is what it asks for, with the prompt ready to copy` | `it changes as the work lands — … here every page has been read, so it has moved on and asks for the first design instead` | the rail's own top card in the reshot render |
| Tour · ledger alt | `NEXT · NEW PAGES WAITING — Let your AI read your 10 new pages`, `Copy the describe prompt` | `NEXT · YOUR AI KNOWS YOUR PRODUCT NOW — Make your first thing`, `Copy a wireframe prompt` / `Ask a question` | same render |
| Gallery lede | `down to nine-tenths of one` | `down to four-fifths of one` | wikipedia's stats line, `0.9%` → `0.8%` (frontier grew to 4,593) |

**All seven tile alt texts rewritten** — each now states how many discs wear the accent and how many carry
a `×N` badge, because that encoding is new and visible at tile scale. Badge counts read from each running
dashboard by `badge-probe.js`: flipkart 6 · amazon 13 · espncricinfo 20 · airbnb 8 · wikipedia 3 ·
xflowpay 1 · github 8. espncricinfo's says out loud that its map `carries a visible scatter of purple among
the blue` — 20 badges on 37 discs, checked against the tile at its shipped display size rather than at
full resolution, where the badges read much louder than a reader will ever see them.

**One note corrected, one claim added.** The gallery's closing note claimed `Every full-size dashboard view
on this page is of one product, xflowpay.com` — the hero swap made that false, so it now names the hero
separately. The brief's optional "AI has read this library" line is added in the same note, phrased so it
cannot be read as *bright ring = read*:

> `Every map here has also been read: all 256 pages across the seven libraries carry a description, written by an AI and labelled method: ai in the library so it is never mistaken for a captured fact. That is what the accent rim marks — a page whose description exists — which is why these maps are warm where earlier versions of this page were pale. A purple ×N disc is described too; it simply also stands for a template shape, so it wears that badge instead.`

The qualifier is load-bearing, not hedging: espncricinfo is 37/37 described but only 18 of its 37 discs are
rimmed, because 19 wear the badge instead. Without the last sentence the line would imply those 19 are
unread. Claims-audit row and evidence in the build report § F3.

**Unchanged and worth stating:** all seven tile caption hexes (`flipkart.com · #2874F0` ·
`amazon.in · #2162A1` · `espncricinfo.com · #0860C4` · `airbnb.co.in · #DA1249` ·
`en.wikipedia.org · #3366CC` · `xflowpay.com · #5E76E3` · `github.com · #0969DA`) — all re-verified against
`tokens.json.brand.seed`, all still `source: "observed"`. The Design-language body (`×32,939` across
eighteen pages, accent `×141` across four) and its alt (`41 single-page values`, 21 swatches,
`#E4E9FF ×5 · 5p`) re-read and unchanged. The `tour-map` alt is unchanged — every claim in it
(`13 pages share this layout`, `linked from 18 pages`, `Get one example`, `Download all 13`) re-verified
verbatim against the reshot render. Both v1.2 disclosures (the 19.7° blue band; amazon's seven
non-yielding pages) re-verified and kept. Headline, sub, principles strip and §§1–4, 6–8 as v1.2 left them.

## 2026-07-30 — prompt readability: all 11 copied prompts reshaped to one human-readable shape

`prds/prompt-readability.md`, off Prateek's field test 2026-07-29: *"When I copy a prompt from the UI
and paste it in my chat here, the prompts are not very human-readable."* The 11 `PROMPTS.*` strings had
only ever been graded on whether a **model** could follow them (`prds/ai-readability-experiment-REPORT.md`
scored them **B**, every invariant held). They were never assessed as **what a human reads in their own
chat window before hitting send** — the only way they are ever actually used.

**This is a reshaping, not a rewrite.** Every one of the 11 keeps its instruction set exactly: no path,
filename, flag, prohibition or § number was reworded, dropped, merged or added. Proven by set-equality
per prompt (`tools/test-prompts.js`, now 182 assertions, holds the pre-reshape token sets frozen off
commit `779ffbb`), so the strings below supersede their predecessors on **layout only**.

The shared shape, applied to all 11:
- **Line 1** — the ask, one short sentence, in the designer's voice.
- **Blank line, then the body** as 2–5 short `-` lines, one instruction each, no nesting.
- **The `FILL THIS IN: ` line last**, for the four prompts with a `‹placeholder›` (A.2, A.8, A.9, A.11).
  One fixed marker across every prompt that has one. A.9's placeholder is bound inside a command token,
  so its marker line points at the command rather than carrying the placeholder alone.
- **No markdown emphasis** anywhere. A.8's `**…**` is gone — chat inputs rendered it as literal asterisks.

**A.1 `describeLibrary`**
````
Describe the pages in this library that are still missing a description.

- Open this folder's design context: read `design-context/registry.json`.
- Then, for every page whose `page.md` still says '(not yet described)', write the screen doc between its ai:begin/ai:end markers per `skills/capture-product/SKILL.md` §5.
- Ground each description only in that page's `content.md`, `screenshot.png`, and `meta.json`.
- Never invent features; never edit anything outside the markers.
- Then run `node tools/build-index.js`.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Open this folder's design context. Read \`design-context/registry.json\`, then for every page whose \`page.md\` still says '(not yet described)', write the screen doc between its ai:begin/ai:end markers per \`skills/capture-product/SKILL.md\` §5 — grounded only in that page's \`content.md\`, \`screenshot.png\`, and \`meta.json\`. Never invent features; never edit anything outside the markers. Then run \`node tools/build-index.js\`.~~

**A.2 `wireframe`**
````
I want to explore a change on this page.

- Read `design-context/registry.json` for the shape of this product, then `design-context/pages/<slug>/page.md` and its `screenshot.png` for the page itself.
- Per `skills/wireframe-on-snapshot/SKILL.md`: work on COPIES in `wireframes/<slug>/round-1/` — never edit `design-context/`.
- Keep the product's real shell. Make 2–3 genuinely different approaches, new elements visibly lo-fi.
- Then render previews with `node tools/shot.js`.
- FILL THIS IN: the change I want to explore — ‹describe your change›
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Read \`design-context/registry.json\` for the shape of this product, then \`design-context/pages/<slug>/page.md\` and its \`screenshot.png\` for the page itself. I want to explore: ‹describe your change›. Per \`skills/wireframe-on-snapshot/SKILL.md\`: work on COPIES in \`wireframes/<slug>/round-1/\` (never edit \`design-context/\`), keep the product's real shell, make 2–3 genuinely different approaches, new elements visibly lo-fi, then render previews with \`node tools/shot.js\`.~~

**A.3 `whatsMissing`**
````
Tell me what's missing from this library and what's worth unlocking.

- Read `design-context/registry.json` — especially `frontier` (discovered-but-not-downloaded pages) and each page's `states`.
- Tell me, as my design partner: which locked pages and which missing states matter most for understanding this product, and why.
- Don't capture anything yet — recommend.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Read \`design-context/registry.json\` — especially \`frontier\` (discovered-but-not-downloaded pages) and each page's \`states\`. Tell me, as my design partner: which locked pages and which missing states matter most for understanding this product, and why. Don't capture anything yet — recommend.~~

**A.4 `addState`**
````
I want to add a page state to the library — I can reach it via URL.

- Run `node tools/capture.js --state <slug>:<state-name> --url "<the url>"`.
- Confirm it landed under `design-context/pages/<slug>/states/`.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~I can reach a page state via URL. Run \`node tools/capture.js --state <slug>:<state-name> --url "<the url>"\` and confirm it landed under \`design-context/pages/<slug>/states/\`.~~

**A.5 `auditTokens`**
````
Audit this product's visual language for me.

- Read `design-context/tokens.json`.
- These are OBSERVED values (method: heuristic), not authored tokens.
- As a design-systems reviewer: where is this product consistent, where is it drifting (near-duplicate colors, off-scale spacing), and what would you consolidate first?
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Read \`design-context/tokens.json\`. These are OBSERVED values (method: heuristic), not authored tokens. As a design-systems reviewer: where is this product consistent, where is it drifting (near-duplicate colors, off-scale spacing), and what would you consolidate first?~~

**A.6 `recaptureCheck`**
````
The product may have changed — re-capture it and tell me what moved.

- Re-run the capture with the same settings as last time — use `design-context/product.json` if it exists, otherwise read the parameters recorded in `design-context/manifest.json` and rebuild the command from those.
- Then compare `contentHash` changes in `design-context/registry.json`.
- Tell me which pages changed and whether their descriptions need updating.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~The product may have changed. Re-run the capture with the same settings as last time — use \`design-context/product.json\` if it exists, otherwise read the parameters recorded in \`design-context/manifest.json\` and rebuild the command from those. Then compare \`contentHash\` changes in \`design-context/registry.json\` and tell me which pages changed and whether their descriptions need updating.~~

**A.7 `bootstrap`**
````
You're in a designer's workspace — get oriented before we start.

- Read `AGENTS.md` first and follow its five rules.
- Then read `design-context/registry.json` to learn this product.
- Then ask me what I want to work on.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~You're in a designer's workspace. Read \`AGENTS.md\` first and follow its five rules. Then read \`design-context/registry.json\` to learn this product, and ask me what I want to work on.~~

**A.8 `designNew`**
````
I want to design something NEW for this product.

- Read `design-context/registry.json`, `tokens.json`, and the pages most like what I'm making.
- Per `skills/wireframe-on-snapshot/SKILL.md` §7: start from the captured page whose shell this new page would share, and work on a COPY in `wireframes/new/<kebab-case name for this concept, your choice>/round-1/` — never in `design-context/`.
- Keep the product's real shell. Make 2–3 genuinely different approaches, new elements visibly lo-fi. Render previews with `node tools/shot.js`.
- If the library is too thin to know this product's grammar for some part, tag that region `ASSUMED: …` and explain it in `notes.md` — never invent house style.
- FILL THIS IN: what I want to design — ‹describe it›
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Read \`design-context/registry.json\`, \`tokens.json\`, and the pages most like what I'm making. I want to design something NEW: ‹describe it›. **Per \`skills/wireframe-on-snapshot/SKILL.md\` §7:** start from the captured page whose shell this new page would share, work on a COPY in \`wireframes/new/<kebab-case name for this concept, your choice>/round-1/\` (never in \`design-context/\`), keep the product's real shell, make 2–3 genuinely different approaches, new elements visibly lo-fi. If the library is too thin to know this product's grammar for some part, tag that region \`ASSUMED: …\` and explain it in \`notes.md\` — never invent house style. Render previews with \`node tools/shot.js\`.~~

**A.9 `guided`**
````
Run a guided capture of this product with me.

- Run `node tools/capture.js --guided --url ‹where to start›`.
- A browser window opens on my logged-in profile — I'll drive.
- Watch the folder: each capture lands under `design-context/pages/…` with `method: guided`.
- When I close the window, run `node tools/build-index.js` and tell me what the hygiene check found.
- FILL THIS IN: the URL in the command above — ‹where to start›
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Run \`node tools/capture.js --guided --url ‹where to start›\`. A browser window opens on my logged-in profile — I'll drive. Watch the folder: each capture lands under \`design-context/pages/…\` with \`method: guided\`. When I close the window, run \`node tools/build-index.js\` and tell me what the hygiene check found.~~

**A.10 `figma`**
````
How do I get a captured page into Figma?

- Open the dashboard, go to the page you want, and click ⧉ Copy for Figma.
- Paste into your Figma file (⌘V).
- It lands as editable auto-layout layers — arrange or restyle freely; the library stays untouched.
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Open the dashboard, go to the page you want, click ⧉ Copy for Figma, and paste into your Figma file (⌘V). It lands as editable auto-layout layers — arrange or restyle freely; the library stays untouched.~~

**A.11 `askQuestion`**
````
I have a question about this product.

- Read `design-context/registry.json` and `INDEX.md` to learn this product.
- Answer only from what's in the library — the captured pages, their descriptions, and the observed tokens.
- If the answer isn't in the library, say so plainly rather than guessing.
- FILL THIS IN: my question — ‹your question›
````
> Superseded (struck 2026-07-30 — the single-paragraph form; reshaped, not reworded): ~~Read \`design-context/registry.json\` and \`INDEX.md\` to learn this product. I have a question about it: ‹your question›. Answer only from what's in the library — the captured pages, their descriptions, and the observed tokens. If the answer isn't in the library, say so plainly rather than guessing.~~

## 2026-07-29 — cumulative capture record (M1–M2)

`prds/v1-fix-manifest-record.md`. Two new/corrected locked strings, both surfacing counts that vary at
runtime — plural forms are part of the canon, not an implementation detail.

**Hygiene — new info-level line (M1)**, sourced from `registry.skips` (the cumulative ledger
`build-index.js` derives from `design-context/capture-log.json`, restoring disclosure of pages a
site refused across ALL past runs, not just the latest one):
`N page(s) was/were blocked or auth-walled during capture` — action: `see design-context/capture-log.json for the full record`.
Singular: `1 page was blocked or auth-walled during capture`. Plural: `N pages were blocked or auth-walled during capture`.

**Map arc label — pluralization fix (M2)**: was permanently plural regardless of count (`— N pages`,
visible as `— 1 PAGES` on a 1-null workspace, uppercased by `.maparclbl`'s CSS). Now matches the
pluralization idiom already used one line above it and elsewhere on the map (`1 click` / `N clicks`):
- was: `not linked from home — ${unreachCount} pages`
- now: `not linked from home — ${unreachCount} page${unreachCount===1?'':'s'}`

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

## 2026-08-01 — Figma exit moves to capture.js (F1–F5)

`prds/figma-exit-capture-js.md`. The designer-facing **⧉ Copy for Figma** now runs Figma's own
capture.js, with the vendored dom-to-figma bundle kept as a real fallback. Two engines means the
success state can no longer be one fixed sentence: falling back is a genuine loss of fidelity
(radial-gradient, `transform: rotate()`, `::after` content and inline SVG are all dropped by
dom-to-figma), so it is announced rather than discovered at paste time.

**Copy-for-Figma success toast** (F3 — was one engine-blind sentence; now names the engine):
- capture.js: `Copied — editable layers via Figma capture. Paste into your Figma file.`
- dom-to-figma fallback: `Copied — offline fallback. Some effects may be simplified.`
> Superseded (struck 2026-08-01): `Copied — paste into Figma (⌘V). It lands as editable layers.`

Both strings deliberately name **no paste shortcut**. The old one hard-coded `⌘V`, which is simply
wrong on Windows — where this build and its gates ran, and where the kit's launch path now falls
back to Edge. Naming no shortcut is cheaper than branching on platform and cannot go stale.

> **Still hard-coded elsewhere (found, not fixed by this round):** `⌘V` survives in prompt **A.10**
> (`figma`, the copy-a-prompt string) and in the Use-it tab's prose paragraph. Both are wrong on
> Windows for the same reason. A.10 is canon with a stable ID and this brief's house rule was
> *canon verbatim*, so neither was touched here — they need their own decision.
>
> **CLOSED 2026-08-02** — the two dashboard strings on 2026-08-01b (see below), and the last two
> *static* copies, which no `IS_MAC` branch could reach, in the `pre-ship-fixes` F3 entry at the top
> of this file. One `⌘` remains in the shipped tree: `docs/index.html`'s copy-button fallback
> (`Press ⌘C`), which is a JS string and so was left to a round allowed to change code.

### 2026-08-01b — the two remaining `⌘V` hard-codes, made platform-aware

The entry above recorded these as *found, not fixed*, because the round's house rule was **canon
verbatim**. Prateek's call, same day: make them platform-agnostic. Both now branch on the existing
`IS_MAC` constant (`tools/dashboard-template.html:1107`) rather than asserting a Mac shortcut.

**A.10 `figma`** (the copy-a-prompt string — addressed to the designer, not to a model):
`- Paste into your Figma file (${IS_MAC ? '⌘V' : 'Ctrl+V'}).`
> Superseded (struck 2026-08-01): `- Paste into your Figma file (⌘V).`

**Use-it tab — "Take any page straight into Figma"** paragraph:
`… click ⧉ Copy for Figma and paste into your Figma file (${IS_MAC ? '⌘V' : 'Ctrl+V'}). …`
> Superseded (struck 2026-08-01): `… paste into your Figma file (⌘V). …`

Both are rendered in the designer's own browser, so the branch resolves against the machine actually
reading the string. The Copy-for-Figma **success toast** stays deliberately shortcut-free — a
transient confirmation does not need to teach a keystroke, and not naming one cannot go stale.
