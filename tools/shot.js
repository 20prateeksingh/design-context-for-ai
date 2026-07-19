#!/usr/bin/env node
/**
 * shot.js — render a local HTML file (snapshot or wireframe) to a PNG.
 * Used to preview captured baselines and wireframe iterations.
 *
 * Usage: node shot.js <file.html> [out.png] [--full] [--width 1440] [--height 900]
 */
const { chromium } = require('playwright');
const path = require('path');

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const getArg = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const file = path.resolve(files[0] || '');
const out = path.resolve(files[1] || file.replace(/\.html?$/, '') + '.preview.png');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: {
    width: parseInt(getArg('--width', '1440'), 10), height: parseInt(getArg('--height', '900'), 10) } });
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out, fullPage: args.includes('--full') });
  await browser.close();
  console.log(out);
})();
