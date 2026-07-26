#!/usr/bin/env node
/**
 * test-brand.js — unit tests for the F2 whitelabel-accent derivation (v2.4 dark canvas, §2/§8.C).
 *
 * Pure fixtures, no filesystem: feeds synthetic tokens.json shapes into deriveBrand() and asserts
 * the §2 contract — the red-band exclusion (a brand must never impersonate --bad), the fallback
 * (no qualifying candidate → no brand entry at all), the dark-contrast guard (≥3.0:1 on --panel),
 * the button-text rule, determinism, and the documented lower-hex tiebreak.
 *
 * Run: node tools/test-brand.js   (exits 1 on any failure)
 */
const { deriveBrand, contrastRatio, hexToHsl } = require('./build-index.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const toks = (top) => ({ colors: { top } });

// 1. Synthetic red-brand product (§8.C): top color #E02020 (h≈0°, s≈.75) → skipped; grays don't qualify
//    either → NO brand entry (the dashboard keeps its CSS fallback #4F46E5).
{
  const b = deriveBrand(toks([
    { value: '#E02020', count: 5000, pages: 20, alpha: false },
    { value: '#333333', count: 9000, pages: 20, alpha: false },
    { value: '#FFFFFF', count: 8000, pages: 20, alpha: false },
  ]));
  check('red-brand fixture → skipped, fallback applied (no brand entry)', b === null, JSON.stringify(b));
}

// 2. Deep red at the other hue edge (h ≥ 345°, s ≥ .5) is excluded too.
{
  const h = hexToHsl('#E0153A').h; // ≈350°
  const b = deriveBrand(toks([{ value: '#E0153A', count: 900, pages: 12, alpha: false }]));
  check(`red-band upper edge (h=${h.toFixed(0)}°) excluded`, h >= 345 && b === null, JSON.stringify(b));
}

// 3. Alpha colors and out-of-range lightness never qualify.
{
  const b = deriveBrand(toks([
    { value: '#2874F0', count: 9999, pages: 30, alpha: true },   // alpha → out
    { value: '#0A1A2F', count: 9999, pages: 30, alpha: false },  // l < .20 → out
    { value: '#F2E7FE', count: 9999, pages: 30, alpha: false },  // l > .75 → out
    { value: '#BDBDBD', count: 9999, pages: 30, alpha: false },  // s < .35 → out
  ]));
  check('alpha / lightness / saturation filters hold → no brand', b === null, JSON.stringify(b));
}

// 4. Flipkart-shaped input → the blue wins on score; hue is preserved by the guard.
{
  const b = deriveBrand(toks([
    { value: '#212121', count: 8676, pages: 34, alpha: false },
    { value: '#2874F0', count: 991, pages: 34, alpha: false },
    { value: '#388E3C', count: 297, pages: 15, alpha: false },
  ]));
  check('flipkart-shaped input → seed #2874F0', b && b.seed === '#2874F0', b && b.seed);
  const dh = b ? Math.min(Math.abs(hexToHsl(b.applied.accent).h - hexToHsl('#2874F0').h), 360 - Math.abs(hexToHsl(b.applied.accent).h - hexToHsl('#2874F0').h)) : 999;
  check('applied accent hue within ±8° of the seed', dh <= 8, `Δ${dh.toFixed(1)}°`);
  check('accent ≥ 3.0:1 on --panel', b && contrastRatio(b.applied.accent, '#131316') >= 3.0,
    b && contrastRatio(b.applied.accent, '#131316').toFixed(2));
  const cw = b && contrastRatio('#FFFFFF', b.applied.accent), cb = b && contrastRatio('#08090A', b.applied.accent);
  check('button text = the higher-contrast of white/near-black', b && b.applied.buttonText === (cw >= cb ? '#FFFFFF' : '#08090A'),
    b && `white ${cw.toFixed(2)} vs dark ${cb.toFixed(2)} → ${b.applied.buttonText}`);
}

// 5. Dark-contrast guard: a qualifying-but-dark color gets LIGHTENED (hue/sat kept) until ≥3.0:1.
{
  const b = deriveBrand(toks([{ value: '#294A8A', count: 800, pages: 10, alpha: false }])); // s≈.54, l≈.35 — qualifies, low contrast
  check('dark seed qualifies and is lightened to ≥3.0:1 on --panel', !!b && contrastRatio(b.applied.accent, '#131316') >= 3.0,
    b ? `${b.applied.accent} @ ${contrastRatio(b.applied.accent, '#131316').toFixed(2)}` : 'no brand');
  check('guarded accent keeps the seed hue (±8°)', !!b && Math.abs(hexToHsl(b.applied.accent).h - hexToHsl('#294A8A').h) <= 8);
}

// 6. Determinism + the documented tiebreak: equal scores → lower hex sorts first. Repeated runs identical.
{
  const input = toks([
    { value: '#8833CC', count: 100, pages: 10, alpha: false },
    { value: '#3388CC', count: 100, pages: 10, alpha: false },
  ]);
  const a = deriveBrand(input), b2 = deriveBrand(input);
  check('score tie → lower hex wins', a && a.seed === '#3388CC', a && a.seed);
  check('derivation is deterministic (run twice, identical)', JSON.stringify(a) === JSON.stringify(b2));
}

console.log(failures ? `\n✗ ${failures} failure(s)` : '\n✅ test-brand: all assertions passed');
process.exit(failures ? 1 : 0);
