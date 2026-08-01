# Vendored third-party code

## `dom-to-figma.iife.js`

Powers the dashboard's **⧉ Copy for Figma** exit — converts a captured snapshot's
DOM into Figma's clipboard paste format entirely in the browser, so a designer can
paste any captured page or state into Figma as editable auto-layout layers (no
plugin, no Dev Mode, no paid seat). The one external request a copy makes is the
converter fetching public font files from `cdn.jsdelivr.net/fontsource` to embed
real fonts (so Figma keeps the pasted text); fully-offline text needs those fonts
vendored locally — a documented follow-up.

- **Package:** [`@figit/dom-to-figma`](https://www.npmjs.com/package/@figit/dom-to-figma) — **v0.2.1, pinned** (2026-07-26; was 0.2.0)
- **License:** MIT (see `LICENSE-dom-to-figma`)
- **Global:** `DomToFigma` (IIFE build), API used: `createFigmaConverter()` →
  `.convert({element, width, height, name})` → `{bytes, toClipboardItem(), toClipboardHtml()}`
- **Build recipe** (from the v0.2.1 npm tarball's `dist/figma.mjs`):

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

## `inter-latin-400-normal.woff2`

The **fallback typeface** for the dom-to-figma exit (`figma-exit-capture-js` F4). Figma drops any
text node whose font carries no real bytes — silently, totally, and invisibly until paste — and the
converter's default loader fetches from `cdn.jsdelivr.net/fontsource`, so any page that blocks that
CDN pasted with **zero text**. Measured on `flipkart/plus` with the CDN blocked: 74 text nodes → 0.
The dashboard's font loader now tries the real family first and falls back to these bytes, which are
always present. A substituted typeface is vastly better than invisible text.

- **Font:** Inter, latin subset, weight 400 normal — from the `inter@5` fontsource distribution
- **License:** SIL Open Font License 1.1 (see `LICENSE-inter`)
- **Size:** 23,664 bytes. Chosen over the equivalent `.ttf` (66,912 bytes); both parse, because the
  dom-to-figma bundle already carries a Brotli decoder for woff2.
- **Consumed as:** `build-index.js` writes it base64-encoded into `design-context/_fallback-font.js`
  as a derived asset (regenerated every build, never hand-edited). It is delivered as a **script**
  rather than the raw `.woff2` because `fetch()` of a local file is blocked on `file://`, and a
  `file://` copy is a supported path for this dashboard — a `<script src>` is not blocked.
- **Deliberately weight-flattened:** the loader reports `resolvedWeight: 400, resolvedItalic: false`,
  the truth about the bytes being handed over. Claiming the requested weight would label the node
  with a face these outlines are not, which is how text gets dropped again one layer down. Weight
  fidelity is the thing traded away to keep text visible at all.
