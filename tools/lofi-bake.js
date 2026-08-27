// lofi-bake — makes a chosen lofi wireframe survive the Figma exit.
//
// WHAT THIS DOES: lofi-mode (skills/wireframe-on-snapshot/SKILL.md §4) is `filter: grayscale(1)` on
// <html>, plus `contrast(0) brightness(1.15)` on images. A CSS filter is a PAINT-TIME effect —
// getComputedStyle still returns the ORIGINAL values, so any DOM→Figma converter (which reads
// computed styles, not painted pixels) exports full brand color, not the gray the render shows. This
// walks the DOM once and bakes the filter's own maths into real values, so what gets exported matches
// what the lofi render actually looks like.
//
// grayscale(1) per the filter-effects spec = luma 0.2126R + 0.7152G + 0.0722B on all 3 channels.
// lofi-mode's image rule `contrast(0) brightness(1.15)` flattens any image to a single flat value:
// contrast(0) → 0.5 on every channel, ×1.15 → 0.575 → #939393.
//
// WHEN TO RUN IT: on a lofi wireframe copy, immediately before converting it for Figma (skill §7.4) —
// never on the library, never on a hi-fi/prototype copy (there's no filter to bake there).
//
// IN-PAGE USAGE (devtools console, on the tab you're about to convert):
//   lofiBake()
//
// CLI USAGE (headless — bakes a saved wireframe copy without opening a tab yourself):
//   node tools/lofi-bake.js <file.html>
// Writes <file>.baked.html next to the input; the original wireframe file is untouched.
//
// COLOR PARSING LIVES IN tools/color.js, NOT HERE. This file used to match rgb()/rgba() only, which
// made it a NO-OP that reported success on any page whose computed styles are a modern color space —
// on a Tailwind v4 page every color property is oklch(), so the guard below skipped all of them and
// the wireframe exported to Figma in full brand color while printing a tidy stats line. One parser,
// shared with build-index.js, so there is one place to teach the next color function.
// IN THE DEVTOOLS CONSOLE, PASTE tools/color.js FIRST — it defines window.__dckColor, which this file
// requires. The CLI path below injects both for you.
if (typeof window !== 'undefined') {
window.lofiBake = function lofiBake() {
  const C = window.__dckColor;
  if (!C) throw new Error('lofiBake: tools/color.js must be loaded first (it defines window.__dckColor)');
  const GRAY_IMG = '#939393';
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor',
    'columnRuleColor', 'caretColor', 'fill', 'stroke'];

  let elements = 0, props = 0, images = 0, gradientsLeft = 0;
  const colorsLeft = new Set();   // color functions color.js could not read — counted, never skipped

  // EVERY write below is `!important`, and that is load-bearing. A plain inline style loses to a
  // stylesheet `!important`, and production pages are full of them — a Tailwind `!bg-blue-500` or any
  // hand-written `!important` colour simply outranked the bake. Measured on the Xflow receivables
  // wireframe (2026-08-28): 23 declarations across 7 values were written correctly and had NO effect,
  // including a `rgb(62, 139, 254)` primary button, so a lo-fi wireframe pasted into Figma carried the
  // product's brand blue. An inline `!important` is the highest author-origin priority there is, so it
  // wins over both. camel→kebab because setProperty takes the CSS name, not the JS one.
  // FREEZE TRANSITIONS FIRST, before a single colour is written. This is not tidiness — it is
  // correctness for the export. A production page is full of `transition-all duration-150`, so the
  // moment the bake writes a colour the element begins INTERPOLATING toward it, and
  // getComputedStyle returns the interpolated value — which at t=0 is the ORIGINAL brand colour.
  // Both consumers read computed styles, so a converter running right after the bake exports the
  // pre-bake colours and the paste looks unbaked. In an offscreen, visibility:hidden frame the
  // transition may never advance at all, so waiting is not a fix. Measured on the Xflow receivables
  // wireframe (2026-08-28): 145 declarations still reported their pre-bake value with a correctly
  // written inline `!important` sitting on the element. Kept in the DOM deliberately — a static
  // Figma-bound artifact has no use for transitions, and .baked.html should not carry them either.
  if (!document.getElementById('lofi-freeze')) {
    const freeze = document.createElement('style');
    freeze.id = 'lofi-freeze';
    freeze.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.head.appendChild(freeze);
  }

  const kebab = (p) => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const put = (el, prop, value) => el.style.setProperty(kebab(prop), value, 'important');

  // grayscale(1) per the filter-effects spec, applied to the parsed color. A legacy rgb()/rgba()
  // value takes its authored numbers through unrounded and unchanged, which is what keeps an
  // already-baked wireframe re-baking byte-identical.
  const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const grayify = (v) => C.replaceColors(v, (c) => {
    const y = luma(c.r, c.g, c.b);
    return c.hasAlpha ? `rgba(${y}, ${y}, ${y}, ${c.a})` : `rgb(${y}, ${y}, ${y})`;
  }, (m) => colorsLeft.add(m));

  // ORDER IS LOAD-BEARING: replacements FIRST, colour walk SECOND. These two blocks CREATE elements
  // (an <img> becomes a flat gray <div>), and anything created after the colour walk has finished is
  // never walked — so it keeps whatever a `*` selector gives it. Tailwind's preflight sets
  // `border-color` on every element with `border-width: 0`, which is exactly that shape: measured on
  // the xflowpay stablecoins wireframe (2026-08-28), 64 border-colour declarations on 16
  // bake-created boxes still reported the theme's #E7EBF8 with nothing inline on them. Invisible in
  // the render (zero width) and exported as real colour by a converter that reads computed styles.
  // Doing the replacements first makes the walk the LAST thing to touch colour, so it covers its own
  // output. Do not "tidy" these back below the walk.
  // raster + vector content: lofi-mode flattens these to one gray, so make that literal
  document.querySelectorAll('img, picture, video, canvas').forEach((el) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `display:${getComputedStyle(el).display === 'inline' ? 'inline-block' : 'block'};`
      + `width:${r.width || el.width || 16}px;height:${r.height || el.height || 16}px;`
      + `background:${GRAY_IMG};vertical-align:middle`;
    el.replaceWith(box); images++;
  });
  document.querySelectorAll('svg').forEach((el) => {
    el.querySelectorAll('*').forEach((n) => {
      if (n.hasAttribute('fill') && n.getAttribute('fill') !== 'none') n.setAttribute('fill', GRAY_IMG);
      if (n.hasAttribute('stroke') && n.getAttribute('stroke') !== 'none') n.setAttribute('stroke', GRAY_IMG);
    });
    images++;
  });

  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    let touched = false;
    for (const prop of PROPS) {
      const v = cs[prop];
      if (!C.hasColor(v)) continue;
      const g = grayify(v);
      if (g !== v) { put(el, prop, g); props++; touched = true; }
    }
    if (cs.boxShadow && cs.boxShadow !== 'none' && C.hasColor(cs.boxShadow)) {
      const g = grayify(cs.boxShadow);
      if (g !== cs.boxShadow) { put(el, 'boxShadow', g); props++; touched = true; }
    }
    // background-image gradients: recolor the stops we can parse; count what we can't
    const bi = cs.backgroundImage;
    if (bi && bi !== 'none') {
      if (bi.indexOf('gradient') !== -1 && C.hasColor(bi)) {
        const g = grayify(bi);
        if (g !== bi) { put(el, 'backgroundImage', g); props++; touched = true; }
        else gradientsLeft++;                  // every stop unreadable — reported, never silently skipped
      } else if (bi.indexOf('url(') !== -1) {
        put(el, 'backgroundImage', 'none');
        put(el, 'backgroundColor', GRAY_IMG);
        images++; touched = true;
      } else if (bi.indexOf('gradient') !== -1) {
        gradientsLeft++;                       // named colors only — left alone, reported
      }
    }
    if (touched) elements++;
  });

  // the filter has been baked into real values — drop it so nothing double-applies
  const m = document.getElementById('lofi-mode');
  if (m) m.remove();
  document.documentElement.style.filter = 'none';

  // ── VERIFY, do not trust the write count ──────────────────────────────────────────────────────
  // `props` counts declarations WRITTEN, which is not the same as declarations that took effect. Both
  // defects this function has shipped were of exactly that shape: the rgb()-only parser silently
  // skipped every oklch() value while reporting a tidy stats line, and a plain inline write silently
  // lost to `!important`. So the bake now re-reads the DOM it just changed and counts what is STILL
  // not grey. This number is the honest answer to "will this paste come out grey?" — a caller can
  // report it, and a future regression of the same family cannot hide behind a clean-looking count.
  const isGrey = (v) => { const m = String(v || '').match(/\d+(?:\.\d+)?/g);
    return !m || m.length < 3 || (m[0] === m[1] && m[1] === m[2]); };
  let colouredLeft = 0;
  const colouredLeftSamples = new Set();
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    for (const prop of PROPS) {
      const v = cs[prop];
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || isGrey(v)) continue;
      colouredLeft++;
      if (colouredLeftSamples.size < 6) colouredLeftSamples.add(`${kebab(prop)}: ${v}`);
    }
  });

  const stats = { elements, props, images, gradientsLeftUnbaked: gradientsLeft };
  // Measured-or-absent, like the two fields below: present only when the verification actually found
  // colour left in the DOM, so a clean bake still returns a clean line.
  if (colouredLeft) { stats.colouredLeft = colouredLeft; stats.colouredLeftSamples = [...colouredLeftSamples].sort(); }
  // Additive and measured-or-absent: present only when something really could not be read, so an
  // unknown color function is loud on the way out instead of leaving a clean-looking stats line.
  if (colorsLeft.size) stats.colorsLeftUnbaked = [...colorsLeft].sort();
  return stats;
};
}

// ── CLI wrapper (Node only — the `typeof window` guard above keeps this file a no-op script tag when
// injected into a page, so the SAME file serves both the devtools console and this headless mode) ──
if (typeof module !== 'undefined' && require.main === module) {
  (async () => {
    const fs = require('fs');
    const path = require('path');
    const { chromium } = require('playwright');
const { launchChromium } = require('./launch.js');
    const input = process.argv[2];
    if (!input) { console.error('usage: node tools/lofi-bake.js <file.html>'); process.exit(1); }
    const abs = path.resolve(input);
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      // color.js goes in as an INIT script, not a <script> tag: addScriptTag would leave its whole
      // source inside the saved .baked.html (page.content() serialises the live DOM), bloating every
      // Figma-bound wireframe and moving bytes that have nothing to do with the bake.
      await page.addInitScript({ path: path.join(__dirname, 'color.js') }); // defines window.__dckColor
      await page.goto('file://' + abs);
      await page.addScriptTag({ path: __filename });
      const stats = await page.evaluate(() => window.lofiBake());
      const out = abs.replace(/\.html$/i, '') + '.baked.html';
      fs.writeFileSync(out, await page.content());
      console.log(`baked ${path.basename(abs)} → ${path.basename(out)}`, stats);
    } finally {
      await browser.close();
    }
  })().catch((e) => { console.error('lofi-bake failed:', e.message); process.exit(1); });
}
