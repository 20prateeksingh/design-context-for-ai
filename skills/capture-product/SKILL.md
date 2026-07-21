---
name: capture-product
description: Point the kit at the designer's product and capture its navigation map + editable page snapshots into design-context/. Use when the designer says "capture my product", "set up my design context", "snapshot my app", or wants to start wireframing on a product that has no library yet.
---

# Capture Product

Produce a design-context library for the designer's product: `ia/sitemap.json` (their nav, mapped) + one folder per page (screenshot, editable HTML, verbatim copy, style tally, meta). Read-only, deterministic, provenance-stamped.

## 0. Prefer the dashboard — it runs onboarding for you

The best first-run path is **not** this conversation: tell the designer to run **`tools/start.sh`** (or offer to run it) and follow the dashboard. It asks the URL + sign-in + product-type once, opens the login window only if relevant, and shows the capture live — no terminal, no questions here. Point them there first. Use the steps below when the host has no browser, the designer prefers chatting, or you're iterating on an already-captured library.

**If `design-context/product.json` exists, the questions in §1 are already answered** — read it (`url`, `loggedIn`, `productType`, `presets`) and do **not** re-ask. Pass it straight through: `node tools/capture.js --config design-context/product.json`. Only ask what's missing.

## 1. Kickoff — two questions, one at a time (skip any already in product.json)

Ask **sign-in first** — it decides how you ask for the URL.

1. **Logged-in or public?** — "should I capture the product as *you* see it (logged in), or the public view?" Ask this **per product**, even when a saved session exists — the profile may be logged into other products but not this one, and a logged-out capture of an account-shaped product is mostly login redirects. If they want logged-in → do §3 login **before** starting any capture.
2. **The product's URL** — framed by the answer:
   - **Logged-in:** ask for *the address they land on after signing in* (e.g. `app.example.com` or `example.com/dashboard`), not a marketing homepage. A plain homepage like `github.com` often won't reach the login — the app URL does, and it's the surface the capture (and the pre-login `pages/login/` capture) should target.
   - **Public:** just the product URL.

Defaults you apply silently: depth 1, cap 25, visible browser. Offer depth 2 only in plain terms if their product is list-heavy: "want me to also grab one example of each repeating page type — like one invoice detail, one listing?"

## 2. Setup check (run, don't narrate)

- `node --version` works and `tools/node_modules/` exists → good. Otherwise run `tools/setup.sh` and tell the designer: "installing the capture tools — one minute."
- Never proceed on a broken setup; fix or report.

## 3. Login — the designer's step, never yours

When the designer chose logged-in capture (§1), when `profiles/default/` doesn't exist, or when capture reports `auth-redirect` / lands on a login page. **Stop any running capture first** — the login window and the capture can't share the browser profile:

> "I'll open a browser window on your product. Log in the way you always do — I never see your password, it stays in the browser. When you're in, close the window and tell me."

Run: `node tools/login.js --url <URL>` and wait for them to confirm. Never ask for credentials, cookies, or tokens as text. If they can't log in, stop and say what's blocking. Before capturing, make sure the login window is actually closed — a still-open window locks the profile (capture.js will say so plainly if it happens).

## 4. Capture

```
node tools/capture.js --url <URL> [--depth 2]
```

Runs with a visible browser so the designer can watch. While it runs, you may narrate briefly ("it found your nav — 12 pages, capturing each"). If it exits with a login redirect → step 3. If a site blocks or challenges the browser, say so honestly; don't retry endlessly.

## 5. Describe the library — write the screen docs

Capture auto-generates the consumption layer: `INDEX.md` (human front door), `registry.json` (machine front door for AI agents), and a `page.md` digest per page. The part only you can fill: **each page.md has a section between `ai:begin`/`ai:end` markers** — write a **screen document** there, grounded strictly in that page's captured artifacts (`content.md`, `screenshot.png` — look at it, `meta.json` link graph). Never invent. Announce the step ("writing a guide to each page"); fan out subagents for big libraries (7–8 pages each). Then re-run `node tools/build-index.js` — the first paragraph becomes the page's one-liner in INDEX.md and registry.json; the full doc stays in page.md.

The screen-doc shape (mirrors a mature product-context format):

```
{One sentence: what this page is — standalone first paragraph, becomes the registry one-liner.}

### Purpose            {1–3 sentences: what the user can do here}
### Location           {Path + how it's reached (nav label, linking pages)}
### Layout             {compact ASCII sketch of the page's regions}
### Information displayed        {| Element | Content | Location | — from the screenshot}
### Actions visible (not performed)
  > One-click capture is read-only — actions are listed from the captured UI, NOT clicked;
  > outcomes only stated where a captured link proves the destination.
### State captured     {the single state this snapshot shows + states the UI implies but weren't captured}
### Transitions (from the captured link graph)   {| From | Action | To | — evidence only}
### Notes              {template stands-for counts, empty-state reference value, duds, quirks}
```

Everything in this section is labeled `method: ai` — orientation and interpretation, never ground truth. Documenting *performed* actions and unreached states is the guided pass's job, not yours.

## 6. The win summary — read the files, then translate

Read `design-context/manifest.json` and `ia/sitemap.json`. Report in designer language:

- "Captured **N pages** of <product>" + the nav map as a short list (labels, not slugs).
- Templates: "your product has ~X <pattern> pages that all share one layout — I captured one representative" (from `collapsed` counts).
- Anything skipped/failed/capped, with reasons, per manifest. Never hide gaps.
- Show 1–2 `screenshot.png`s so they see it worked.
- Point them at `INDEX.md` as the browsable map of everything captured — and tell them their AI tools should start at `registry.json`.
- Point them at the dashboard's **Home** (`tools/start.sh` → http://localhost:4173) — their product as a page atlas with a running ledger. The single next move to name is the ledger's **"Give your AI this toolkit"** threshold: one copied prompt makes the AI describe every page and the dormant captions light up. (The **Use it** tab holds the rest — wireframe, design-something-new, what's-missing, context bundle.)

Then offer the map: "run `node tools/map.js` and open http://localhost:4173, then the Map tab — your product plotted by clicks-from-home; the ghosts in the fog are pages I found but didn't download, click to pull them in." And the next move: "want to wireframe on one of these?" (→ `wireframe-on-snapshot`).

Iteration from the map: the designer may select frontier pages there (server does the capture), or ask you — then run `node tools/capture.js --urls "<u1>,<u2>"`. New pages need the describe step (§5) — check for `_(not yet described)` sections after any selective pull. States with a URL: `node tools/capture.js --state <slug>:<name> --url <stateUrl>`.

## Notes

- The capture never clicks buttons or submits forms — safe to run on a real account. The one sanctioned click is a cookie-banner dismissal, and it's logged in `manifest.json → actions`.
- Re-running is safe and refreshes the library in place (`contentHash` in each meta.json tells you what changed).
- Pages that need interaction to reach (modals, wizards, empty/error states) are not captured by one-click — name that limit when relevant instead of pretending coverage.
