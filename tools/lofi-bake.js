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
if (typeof window !== 'undefined') {
window.lofiBake = function lofiBake() {
  const GRAY_IMG = '#939393';
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor',
    'columnRuleColor', 'caretColor', 'fill', 'stroke'];

  const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const grayify = (v) => v.replace(/rgba?\(([^)]+)\)/g, (m, inner) => {
    const p = inner.split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return m;
    const y = luma(p[0], p[1], p[2]);
    return p.length > 3 ? `rgba(${y}, ${y}, ${y}, ${p[3]})` : `rgb(${y}, ${y}, ${y})`;
  });

  let elements = 0, props = 0, images = 0, gradientsLeft = 0;

  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    let touched = false;
    for (const prop of PROPS) {
      const v = cs[prop];
      if (!v || v.indexOf('rgb') === -1) continue;
      const g = grayify(v);
      if (g !== v) { el.style[prop] = g; props++; touched = true; }
    }
    if (cs.boxShadow && cs.boxShadow !== 'none' && cs.boxShadow.indexOf('rgb') !== -1) {
      const g = grayify(cs.boxShadow);
      if (g !== cs.boxShadow) { el.style.boxShadow = g; props++; touched = true; }
    }
    // background-image gradients: recolor the stops we can parse; count what we can't
    const bi = cs.backgroundImage;
    if (bi && bi !== 'none') {
      if (bi.indexOf('gradient') !== -1 && bi.indexOf('rgb') !== -1) {
        const g = grayify(bi);
        if (g !== bi) { el.style.backgroundImage = g; props++; touched = true; }
      } else if (bi.indexOf('url(') !== -1) {
        el.style.backgroundImage = 'none';
        el.style.backgroundColor = GRAY_IMG;
        images++; touched = true;
      } else if (bi.indexOf('gradient') !== -1) {
        gradientsLeft++;                       // named colors / color() — left alone, reported
      }
    }
    if (touched) elements++;
  });

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

  // the filter has been baked into real values — drop it so nothing double-applies
  const m = document.getElementById('lofi-mode');
  if (m) m.remove();
  document.documentElement.style.filter = 'none';

  return { elements, props, images, gradientsLeftUnbaked: gradientsLeft };
};
}

// ── CLI wrapper (Node only — the `typeof window` guard above keeps this file a no-op script tag when
// injected into a page, so the SAME file serves both the devtools console and this headless mode) ──
if (typeof module !== 'undefined' && require.main === module) {
  (async () => {
    const fs = require('fs');
    const path = require('path');
    const { chromium } = require('playwright');
    const input = process.argv[2];
    if (!input) { console.error('usage: node tools/lofi-bake.js <file.html>'); process.exit(1); }
    const abs = path.resolve(input);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
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
