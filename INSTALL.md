# INSTALL — for the AI assistant setting this up

You are an AI assistant a designer just asked to set up the **Design Context Kit**. Follow this
file top to bottom. It ends by handing you off to the `CLAUDE.md` in the folder you create.

**What you're installing:** a kit that captures the designer's own product — its real pages, as
they actually are — into a local library that AI tools can read, so design help is about *their*
product instead of a generic lookalike. Capture is read-only and runs entirely from their machine.

**Who you're talking to:** a designer who may never have run a command. Talk like a design
collaborator, not a terminal. One question at a time. No walls of text.

---

## Rules that hold the whole way through

1. **Never handle credentials.** If the product needs a login, it happens later, in a browser
   window the kit opens, where the designer types their own password. Never ask for, read, or
   store a password, cookie, or token.
2. **Never install anything that needs their password.** If a prerequisite is missing, say so and
   stop. Node is theirs to install, not yours.
3. **Nothing touches their product until they've answered the dashboard's questions.** You are
   only getting the kit onto disk and opening a dashboard. You do not start a capture.
4. **Report honestly.** If a step fails or you skip one, say so and say why. Never present a
   half-finished setup as done.

---

## 0. Check you can actually do this

The kit drives a real browser on the designer's own computer and serves a dashboard on
`localhost`. It cannot work anywhere else.

**Stop if you are running in a cloud session, a remote sandbox, or a container** rather than on
the designer's own machine — Claude Code on the web, for example. Say this, and stop:

> This kit has to run on your own computer — it opens a browser window and a local dashboard,
> and a cloud session can't reach either. Install the Claude desktop app (or the terminal CLI),
> paste the same prompt there, and I'll pick this up from the top.

If you can't tell, ask: *"Am I running on your own computer, or in a browser/cloud session?"*

Then check the prerequisites:

```bash
node --version    # needs v18 or newer
git --version     # useful, not required — §2 has a no-git path
```

If **Node is missing or older than 18**, stop and say:

> You'll need Node.js first — it's a free one-click install from https://nodejs.org (take the
> **LTS** build). Install it, then start me again with the same prompt and I'll carry on.

---

## 1. Agree where it goes, and what it's for

One workspace holds exactly one product. Ask two questions, one at a time:

1. **"Which product do you want me to capture?"** — get the name and, if they have it, the URL.
   Don't ask for the URL twice; the dashboard asks for it properly in §5, so a name is enough here.
2. **If their product has a test, staging, or demo account, say this now:**

   > One thing worth deciding up front: if your product has a **test or staging account**, use
   > that one rather than your real one. The kit only ever reads, never clicks or submits — but a
   > capture of a signed-in product does save whatever data that account can see onto your
   > computer.

Then pick the folder. Default to a subfolder of wherever you're already running:

```
<current folder>/<product-slug>/
```

Use a lowercase, hyphenated slug of the product name (`Acme Dashboard` → `acme-dashboard`). If
you're running somewhere that isn't a sensible home for project folders, propose
`~/Design Context/<product-slug>/` instead and say why. **Never install into a folder that
already has files in it.**

---

## 2. Tell them what's about to happen

The designer is about to see several permission requests in a row, for a tool they haven't
watched work yet. Get ahead of it. Say roughly this, in your own words, **before** you request
the first one:

> I'm going to ask your permission four times, and here's what each one is:
>
> 1. **Download the kit** into `<folder>`
> 2. **Install its two dependencies** (a browser driver and an HTML formatter)
> 3. **Download the capture browser** — this is the slow one, a few minutes
> 4. **Start a local dashboard** at `localhost:4173`, on your machine only
>
> Then a dashboard opens in your browser and asks you three questions about your product.
> Nothing touches `<product>` until you've answered them.

---

## 3. Get the kit onto disk

**With git** (preferred — it makes updates possible):

```bash
git clone https://github.com/20prateeksingh/design-context-for-ai.git "<product-slug>"
cd "<product-slug>"
git remote rename origin upstream
```

That rename matters. The clone's `origin` would otherwise point at the *public kit repo*, and
this folder is about to fill up with pages captured from the designer's product. Renaming it to
`upstream` means a stray `git push` has nowhere to go, while `git pull upstream main` still
brings in kit updates later. Mention it in one line — it's a safety fact they'd want to know:

> I pointed the folder's git link at the kit as "upstream" rather than "origin", so there's no
> way to accidentally push your captured pages to a public repo.

**Without git** — download and unpack the zip instead. Use the block for the designer's platform,
one line at a time:

**macOS / Linux** (bash or zsh):

```bash
curl -L -o kit.zip https://github.com/20prateeksingh/design-context-for-ai/archive/refs/heads/main.zip
unzip -q kit.zip
mv design-context-for-ai-main "<product-slug>"
rm kit.zip
cd "<product-slug>"
```

**Windows** (PowerShell) — `curl` there is an alias for `Invoke-WebRequest` and does not take `-L`,
and there is no `unzip`, so it needs its own commands:

```powershell
Invoke-WebRequest -Uri https://github.com/20prateeksingh/design-context-for-ai/archive/refs/heads/main.zip -OutFile kit.zip -UseBasicParsing
Expand-Archive -Path kit.zip -DestinationPath .
Move-Item design-context-for-ai-main "<product-slug>"
Remove-Item kit.zip
Set-Location "<product-slug>"
```

---

## 4. Install the dependencies

Two commands. The second is the slow one — say so before you run it. **Run them one line at a time**
— these work as-is in bash, zsh and PowerShell, but only if you don't chain them:

```
npm install --prefix tools --no-fund --no-audit
npx --prefix tools playwright install chromium
```

`--prefix tools` is doing real work in both lines: it keeps you in the workspace root, so there is no
`cd` to chain and nothing to undo afterwards.

Before the second command, tell them:

> Downloading the capture browser now — this takes a few minutes and there's nothing to watch.
> I'll tell you the moment the dashboard is ready.

If the Chromium download fails, the kit's capture cannot run. Say that plainly, give the error,
and stop — don't continue to §5 and leave them with a dashboard that can't capture.

---

## 5. Start the dashboard

```bash
node tools/map.js --port 4173
```

**Run this as a background process and do not wait for it.** It is a server: it stays running
until the designer stops it, so a foreground call will hang until it times out.

If port 4173 is already in use, try 4174, then 4175, on up to 4182, and use whichever one takes.
(A second product workspace on the same machine will need a different port.)

Then open it — and put the URL in your message either way, so they have it if the opener fails:

```bash
open http://localhost:4173          # macOS
start http://localhost:4173         # Windows
xdg-open http://localhost:4173      # Linux
```

Tell them what they're looking at:

> Your dashboard is open at http://localhost:4173. It's asking three things — your product's URL,
> whether you sign in to use it, and what kind of product it is. Answer those and it captures,
> live, while you watch. If you sign in, it opens a browser window for you to log in normally —
> your password stays in that window, it never comes to me.

**Do not start the capture yourself.** The dashboard owns onboarding: it asks the questions,
triggers the login window only if relevant, and streams progress. Your job here is done.

---

## 6. Hand off

Two things, in this order:

1. **Read `CLAUDE.md` in the folder you just created** (`<product-slug>/CLAUDE.md`). It is the
   full behavior spec for this workspace — the library's structure, the provenance rules, the
   hard rules about what you may and may not edit. Everything you do from here follows it, not
   this file. If you were started one level above this folder, its instructions do not load on
   their own — read it explicitly.
2. **Tell the designer how to come back:**

   > Next time, open Claude directly on the `<product-slug>` folder — that way it reads the kit's
   > instructions from the start and knows every page you've captured. To reopen the dashboard,
   > just ask me to start it.

Then wait. When the capture finishes, the dashboard's completion screen offers three moves —
describe the pages, explore the map, make the first wireframe. If the designer asks you for any
of them, you're already the right tool for it: you have file access and `CLAUDE.md` is loaded.
Don't send them off to copy a prompt into a different AI.

---

## If something went wrong

| Symptom | What it means | What to say |
|---|---|---|
| `node: command not found` | Node isn't installed | §0's message. Don't install it yourself. |
| `git: command not found` | No git | Use §3's zip path. |
| `The token '&&' is not a valid statement separator` | Windows PowerShell — it has no `&&`, and this is a **parse** error, so nothing on the line ran | Run the commands on separate lines. Every command in this file is written to work that way. |
| `A parameter cannot be found that matches parameter name 'L'` or `unzip: not recognized` | Windows PowerShell — `curl` is an alias for `Invoke-WebRequest`, and `unzip` doesn't exist | Use §3's PowerShell block, not the macOS/Linux one. |
| Chromium download fails | Capture can't run | Say so, give the error, stop. |
| Port 4173–4182 all busy | Other workspaces are running | Ask them to close another dashboard, or reuse it if it's the same product. |
| Dashboard opens but says "Browsing only — the dashboard is open as a file" | You opened the HTML directly instead of the server URL | Go back to §5; use `http://localhost:<port>`. |

Never work around a failure by driving the designer's product yourself. If capture can't reach
something, that's a fact to report, not an obstacle to route around.
