# Vendored third-party code

## `dom-to-figma.iife.js`

Powers the dashboard's **⧉ Copy for Figma** exit — converts a captured snapshot's
DOM into Figma's clipboard paste format entirely in the browser, so a designer can
paste any captured page or state into Figma as editable auto-layout layers (no
plugin, no Dev Mode, no paid seat). The one external request a copy makes is the
converter fetching public font files from `cdn.jsdelivr.net/fontsource` to embed
real fonts (so Figma keeps the pasted text); fully-offline text needs those fonts
vendored locally — a documented follow-up.

- **Package:** [`@figit/dom-to-figma`](https://www.npmjs.com/package/@figit/dom-to-figma) — **v0.2.0, pinned**
- **License:** MIT (see `LICENSE-dom-to-figma`)
- **Global:** `DomToFigma` (IIFE build), API used: `createFigmaConverter()` →
  `.convert({element, width, height, name})` → `{bytes, toClipboardItem(), toClipboardHtml()}`
- **Build recipe** (from the v0.2.0 npm tarball's `dist/figma.mjs`):

  ```
  esbuild dist/figma.mjs --bundle --format=iife --global-name=DomToFigma --minify
  ```

`build-index.js` copies this file to `design-context/_dom-to-figma.js` beside
`dashboard.html` as a derived asset (regenerated every build, never hand-edited).
The dashboard lazy-loads it on the first Copy-for-Figma click, so first paint is
unaffected.

**Format-break posture (accepted, maintainable):** Figma's paste format is
proprietary; a Figma update can break pastes. The version is pinned; on paste
failure the dashboard links a one-line help. To update, re-vendor a newer version
here and re-run the build.
