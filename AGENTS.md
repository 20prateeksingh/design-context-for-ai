# Instructions for AI agents working in this folder

This is a designer's workspace for ONE product. Full behavior spec: **[CLAUDE.md](CLAUDE.md)** (read it if your host loads project instructions; the essentials are inlined below because they break most often on hosts that don't).

1. **Consume the context before designing.** If `design-context/` is empty, capture first: run `tools/start.sh` and let the designer follow the dashboard's onboarding (or use `skills/capture-product`). The visual map: `tools/start.sh` (or `node tools/map.js`) → http://localhost:4173 (captured pages + undownloaded frontier; an empty library shows the onboarding wizard instead). Start at `design-context/registry.json` (machine map: every captured page with route, files, link graph, labeled description) or `design-context/INDEX.md` (same, human-readable). Each page folder has `page.md` (what it is), `screenshot.png` (how it looks), `page.html` (editable real markup), `content.md` (verbatim copy). **Never invent what the current product looks like — it's captured here.**
2. **Provenance.** Anything marked `method: ai` is model-written orientation prose. Everything else was extracted deterministically from the real product. Never write model-guessed values into `design-context/` — it is captured fact and stays untouched.
3. **Design on copies.** Wireframes go in `wireframes/<page>/round-N/`, built on a COPY of the snapshot. Keep the product's real shell; make new elements visibly lo-fi (gray, dashed, `[placeholder]`-labeled). Never overwrite a round already shown to the designer.
4. **Capture is read-only.** `tools/capture.js` follows links only — never make it (or any browser you drive) click buttons or submit forms on the designer's product.
5. **Never handle credentials.** Login happens in the browser window `tools/login.js` opens; the designer types their password there. Never ask for or store passwords, cookies, or tokens. `profiles/` never leaves this machine.

If you were pasted this file as a prompt (host without instruction auto-load): follow the five rules above, then read `design-context/INDEX.md` and ask the designer what they want to work on.
