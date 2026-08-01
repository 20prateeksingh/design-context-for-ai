#!/usr/bin/env node
/**
 * test-color.js — guard over tools/color.js, the kit's one CSS-color parser.
 *
 * WHY THIS TEST IS SHAPED THIS WAY: a wrong color-space matrix does not throw. It produces a
 * PLAUSIBLE hex — a swatch that looks fine on the Design language tab and is the wrong color. A test
 * that only asserted "the parser returned something" would pass on a completely broken conversion, and
 * the honesty machinery would go on stamping `method: heuristic` over it. So every expectation below
 * is anchored OUTSIDE this codebase:
 *
 *   · Tailwind v4's own published palette — its oklch source values and the sRGB hexes Tailwind ships
 *     as their fallback. Ten of them, exact. This is the product that exposed the bug, checking our
 *     arithmetic against its own answer key.
 *   · Ottosson's published OKLab coordinates for the sRGB primaries.
 *   · CIE Lab (D50) coordinates for sRGB red and the 50% gray, and the definitional white/black.
 *   · Axis identities the color spaces guarantee: every RGB space's white is sRGB white; display-p3
 *     shares sRGB's white point AND transfer function, so its whole gray axis maps exactly; the CIE
 *     XYZ white points are the D65/D50 illuminants themselves.
 *   · Two independent chains landing on the same hex: tailwindcss.com serves gray-950 as BOTH
 *     `oklch(0.13 0.028 261.692)` and `lab(1.90334 0.278696 -5.48866)`. The OK* path and the CIE path
 *     share no matrix. Agreement to the byte is worth more than either value alone.
 *
 * And a frozen legacy table: the exact rgb()/rgba() → hex answers the pre-color.js normColor gave.
 * 21 of 22 captured workspaces are made entirely of those values, and their tokens.json must not move.
 *
 * MUTATION MODE: `--mutate` patches one constant or branch in color.js at a time and re-runs the whole
 * suite against the patched module, asserting each mutation makes it FAIL. A guard nobody has proven
 * bites is decoration. (test-prompts.js standard.)
 *
 * Usage: node tools/test-color.js [--mutate]      (exit 0 = pass, 1 = fail)
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'color.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────
// [input, expected hex, expected alpha flag, expected gamutMapped, what anchors it]
const CASES = [
  // ── legacy rgb()/rgba()/#hex: FROZEN. These are the answers the pre-color.js normColor gave.
  ['rgb(0, 0, 0)', '#000000', false, false, 'legacy frozen'],
  ['rgb(255, 255, 255)', '#FFFFFF', false, false, 'legacy frozen'],
  ['rgb(40, 116, 240)', '#2874F0', false, false, 'legacy frozen — flipkart blue'],
  ['rgba(0, 0, 0, 0.5)', '#000000', true, false, 'legacy frozen — alpha from the 4th argument'],
  ['rgba(255, 0, 0, 1)', '#FF0000', false, false, 'legacy frozen — alpha 1 is NOT the alpha flag'],
  ['rgba(0, 0, 0, 0)', '#000000', true, false, 'legacy frozen — fully transparent still flags'],
  ['rgb(1, 2, 3)', '#010203', false, false, 'legacy frozen — single digits zero-pad'],
  ['#ff0000', '#FF0000', false, false, 'hex uppercases'],
  ['#FFF', '#FFFFFF', false, false, '3-digit hex expands (the old parser did not — see the report)'],
  ['#ff000080', '#FF0000', true, false, '8-digit hex carries alpha'],

  // ── modern rgb() space syntax, which the old regex silently dropped
  ['rgb(0 0 0 / 50%)', '#000000', true, false, 'space syntax + percentage alpha'],
  ['rgb(255 128 0)', '#FF8000', false, false, 'space syntax'],
  ['rgb(100% 0% 0%)', '#FF0000', false, false, 'percentage channels'],

  // ── OKLab: Ottosson's published coordinates for the sRGB primaries
  ['oklab(1 0 0)', '#FFFFFF', false, false, 'OKLab L=1 is white by definition'],
  ['oklab(0 0 0)', '#000000', false, false, 'OKLab L=0 is black by definition'],
  ['oklab(0.627955 0.224863 0.125846)', '#FF0000', false, false, 'Ottosson: sRGB red in OKLab'],
  ['oklab(0.866440 -0.233888 0.179498)', '#00FF00', false, false, 'Ottosson: sRGB green in OKLab'],
  ['oklab(0.452014 -0.032457 -0.311528)', '#0000FF', false, false, 'Ottosson: sRGB blue in OKLab'],
  // L=0.5, a=b=0 → every LMS row of the OKLab matrix sums to 1, so linear sRGB is 0.5³ = 0.125 on all
  // three channels, and the sRGB encode of 0.125 is 99 (0x63). Hand-checkable end to end.
  ['oklab(0.5 0 0)', '#636363', false, false, 'OKLab gray axis is neutral'],

  // ── CIE Lab (D50, as CSS specifies) — needs the Bradford adaptation the OK* path does not
  ['lab(100 0 0)', '#FFFFFF', false, false, 'Lab L*=100 is white by definition'],
  ['lab(0 0 0)', '#000000', false, false, 'Lab L*=0 is black by definition'],
  ['lab(50 0 0)', '#777777', false, false, 'Lab L*=50 gray'],
  ['lab(53.585 0 0)', '#808080', false, false, 'Lab L* of sRGB 50% gray'],
  // A hair outside the gamut from rounding, but clipping and chroma-reduction agree at 8 bits, so
  // nothing was actually given up and `gamutMapped` must stay false. See color.js's `out`.
  ['lab(54.2905 80.8124 69.8935)', '#FF0000', false, false, 'CIE Lab D50 coordinates of sRGB red'],

  // ── polar forms
  ['lch(54.2905 106.8398 40.8576)', '#FF0000', false, false, 'the same red, in LCh'],
  ['lch(100 0 0)', '#FFFFFF', false, false, 'LCh chroma 0 is the gray axis'],
  ['oklch(0.627955 0.257683 29.2339)', '#FF0000', false, false, 'sRGB red in OKLCh'],
  ['oklch(0.5 0 0)', '#636363', false, false, 'OKLCh chroma 0 matches OKLab a=b=0'],

  // ── Tailwind v4's published palette: its oklch source → the sRGB hex Tailwind itself ships.
  // The answer key belongs to the product, not to us.
  ['oklch(0.13 0.028 261.692)', '#030712', false, false, 'tailwind v4 gray-950'],
  ['oklch(0.446 0.03 256.802)', '#4A5565', false, false, 'tailwind v4 gray-600'],
  ['oklch(0.707 0.022 261.325)', '#99A1AF', false, false, 'tailwind v4 gray-400'],
  ['oklch(0.623 0.214 259.815)', '#2B7FFF', false, false, 'tailwind v4 blue-500'],
  ['oklch(0.685 0.169 237.323)', '#00A6F4', false, false, 'tailwind v4 sky-500'],
  ['oklch(0.637 0.237 25.331)', '#FB2C36', false, false, 'tailwind v4 red-500'],
  ['oklch(0.723 0.219 149.579)', '#00C950', false, false, 'tailwind v4 green-500'],
  // The one Tailwind swatch where the policy is visible: clipping and chroma-reduction disagree.
  ['oklch(0.795 0.184 86.047)', '#EFB100', false, true, 'tailwind v4 yellow-500 (gamut-mapped)'],
  ['oklch(0.627 0.265 303.9)', '#AD46FF', false, false, 'tailwind v4 purple-500'],
  ['oklch(0.656 0.241 354.308)', '#F6339A', false, false, 'tailwind v4 pink-500'],
  // …and the same product's CIE-Lab serialisations, which must land on the same swatches.
  ['lab(1.90334 0.278696 -5.48866)', '#030712', false, false, 'tailwindcss.com gray-950, via CIE Lab'],
  ['lab(98.1434 -0.369519 -1.05966)', '#F8FAFC', false, false, 'tailwindcss.com slate-50, via CIE Lab'],

  // ── color(): one transfer function and one matrix per space
  ['color(srgb 1 0 0)', '#FF0000', false, false, 'srgb is the identity path'],
  ['color(srgb 0.372549 0.929412 0.513726)', '#5FED83', false, false, 'the form found in the github/youtube captures'],
  ['color(srgb-linear 1 1 1)', '#FFFFFF', false, false, 'linear-light white'],
  ['color(srgb-linear 0.215861 0.215861 0.215861)', '#808080', false, false, 'the linear-light value of sRGB 0x80 re-encodes to 0x80'],
  ['color(display-p3 1 1 1)', '#FFFFFF', false, false, 'every RGB space shares sRGB white'],
  ['color(display-p3 0 0 0)', '#000000', false, false, 'every RGB space shares black'],
  ['color(display-p3 0.5 0.5 0.5)', '#808080', false, false, 'p3 shares sRGB white AND transfer — gray axis is exact'],
  ['color(display-p3 1 0 0)', '#FF0B0C', false, true, 'p3 red has no sRGB hex — gamut-mapped'],
  ['color(a98-rgb 1 1 1)', '#FFFFFF', false, false, 'a98 white'],
  ['color(rec2020 1 1 1)', '#FFFFFF', false, false, 'rec2020 white'],
  ['color(prophoto-rgb 1 1 1)', '#FFFFFF', false, false, 'prophoto white (D50 — needs the adaptation)'],
  ['color(xyz-d65 0.9504559270516716 1 1.0890577507598784)', '#FFFFFF', false, false, 'the D65 illuminant itself'],
  ['color(xyz 0.9504559270516716 1 1.0890577507598784)', '#FFFFFF', false, false, 'xyz is xyz-d65'],
  ['color(xyz-d50 0.9642956764295677 1 0.8251046025104602)', '#FFFFFF', false, false, 'the D50 illuminant itself'],

  // ── hsl()/hwb(): hand-computable
  ['hsl(0 100% 50%)', '#FF0000', false, false, 'hsl red'],
  ['hsl(210, 50%, 40%)', '#336699', false, false, 'hsl legacy comma form'],
  ['hsl(120 100% 25%)', '#008000', false, false, 'hsl dark green'],
  ['hsla(0, 100%, 50%, 0.25)', '#FF0000', true, false, 'hsla 4th-argument alpha'],
  ['hwb(0 0% 0%)', '#FF0000', false, false, 'hwb red'],
  ['hwb(0 100% 0%)', '#FFFFFF', false, false, 'hwb full whiteness'],
  ['hwb(0 0% 100%)', '#000000', false, false, 'hwb full blackness'],
  ['hwb(120 20% 30%)', '#33B333', false, false, 'hwb mixed'],
  ['hwb(0 50% 50%)', '#808080', false, false, 'hwb w+b >= 1 normalises to gray'],

  // ── alpha survives every modern form (constraint 3)
  ['oklab(0.13 -0.00404584 -0.0277062 / 0.05)', '#030712', true, false, 'the alpha form actually in the tailwind data'],
  ['oklch(0.13 0.028 261.692 / 0.5)', '#030712', true, false, 'slash alpha on oklch'],
  ['lab(50 0 0 / 25%)', '#777777', true, false, 'percentage slash alpha'],
  ['color(srgb 1 0 0 / 0.5)', '#FF0000', true, false, 'slash alpha on color()'],
  ['oklch(0.13 0.028 261.692 / 1)', '#030712', false, false, 'an explicit alpha of 1 is not the alpha flag'],

  // ── percentage components: each slot has its own 100% reference, and they are not interchangeable.
  // Every one of these lines exists because mutation testing found the reference unguarded.
  ['lab(50% 0 0)', '#777777', false, false, 'lab L: 100% = 100'],
  ['oklab(50% 0 0)', '#636363', false, false, 'oklab L: 100% = 1'],
  ['oklch(50% 0 0)', '#636363', false, false, 'oklch L: 100% = 1'],
  ['lab(54.2905 64.64992% 55.9148%)', '#FF0000', false, false, 'lab a/b: 100% = 125'],
  ['oklab(0.627955 56.21575% 31.4615%)', '#FF0000', false, false, 'oklab a/b: 100% = 0.4'],
  ['lch(54.2905 71.22653% 40.8576)', '#FF0000', false, false, 'lch C: 100% = 150'],
  ['oklch(0.627955 64.42075% 29.2339)', '#FF0000', false, false, 'oklch C: 100% = 0.4'],

  // ── angle units and `none`
  ['oklch(0.627955 0.257683 0.0812277turn)', '#FF0000', false, false, 'turn'],
  ['oklch(0.627955 0.257683 0.510229rad)', '#FF0000', false, false, 'rad'],
  ['oklch(0.627955 0.257683 32.4821grad)', '#FF0000', false, false, 'grad'],
  ['oklch(none none none)', '#000000', false, false, '`none` computes as 0 (CSS Color 4 §4.4)'],
  ['oklab(1 none none)', '#FFFFFF', false, false, '`none` on a single component'],
];

// Values that must stay UNPARSEABLE — the counter exists so these are loud, not invisible.
const REJECTS = [
  ['color(lab-d99 1 2 3)', 'an unknown color space is never silently guessed at'],
  ['color(srgb 1 0)', 'color() with too few components'],
  ['color-mix(in srgb, red, blue)', 'color-mix is not a resolved color'],
  ['light-dark(white, black)', 'light-dark is not a resolved color'],
  ['oklch(0.5 0.1)', 'oklch with a missing component'],
  ['oklch(0.5 0.1 20 30)', 'oklch with an extra component'],
  ['lab(banana 0 0)', 'a non-numeric component'],
  ['rgb(1, 2)', 'legacy rgb with two arguments'],
  ['transparent', 'a keyword is not a color function'],
  ['red', 'a named color — computed styles never serialise one, and guessing would widen the scan'],
  ['none', 'the box-shadow/background-image "no value" token'],
  ['#12345', 'a malformed hex'],
  ['', 'the empty string'],
  [null, 'a null value'],
  [undefined, 'an undefined value'],
];

// replaceColors: [input, expected output, what it guards]
const REPLACEMENTS = [
  ['rgb(40, 116, 240)', 'rgb(109, 109, 109)', 'legacy rgb grayifies exactly as it did before color.js'],
  ['rgba(40, 116, 240, 0.5)', 'rgba(109, 109, 109, 0.5)', 'legacy rgba keeps its authored alpha verbatim'],
  ['rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 1)', 'an alpha slot that was written stays written'],
  ['rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', 'a box-shadow keeps its geometry'],
  ['linear-gradient(rgb(255, 0, 0), oklch(0.623 0.214 259.815))',
    'linear-gradient(rgb(54, 54, 54), rgb(118, 118, 118))', 'both stops of a mixed-space gradient bake'],
  ['linear-gradient(oklab(0.13 -0.004 -0.028 / 0.05), color(display-p3 1 0 0))',
    'linear-gradient(rgba(7, 7, 7, 0.05), rgb(63, 63, 63))', 'modern stops bake, alpha survives'],
  ['linear-gradient(red, blue)', 'linear-gradient(red, blue)', 'named-color stops are left alone (and counted by the caller)'],
  ['none', 'none', 'the no-value token is untouched'],
];

// ── The suite (parameterised by module, so --mutate can run it against a patched build) ──
function runSuite(C, log) {
  let pass = 0, fail = 0;
  const ok = (cond, what, detail) => {
    if (cond) { pass++; if (log) console.log(`  ✓ ${what}`); }
    else { fail++; if (log) console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); }
  };
  const say = (s) => { if (log) console.log(s); };

  say('\ncolor — every supported function, against outside answer keys');
  for (const [input, hex, alpha, mapped, why] of CASES) {
    const g = C.toHex(input);
    const got = g ? `${g.hex} alpha=${g.alpha} mapped=${g.gamutMapped}` : 'null';
    ok(!!g && g.hex === hex && g.alpha === alpha && g.gamutMapped === mapped,
      `${input} → ${hex}  (${why})`, got);
  }

  say('\ncolor — what must stay unparseable, so the counter can be loud about it');
  for (const [input, why] of REJECTS) ok(C.toHex(input) === null, `${JSON.stringify(input)} → null  (${why})`, JSON.stringify(C.toHex(input)));

  say('\ncolor — two independent chains must agree on the same swatch');
  // tailwindcss.com serves these as different color functions for the same authored token. The OK*
  // path and the CIE-Lab path share no matrix, so agreement is a real cross-check.
  for (const [a, b] of [['oklch(0.13 0.028 261.692)', 'lab(1.90334 0.278696 -5.48866)'],
    ['oklab(0.627955 0.224863 0.125846)', 'oklch(0.627955 0.257683 29.2339)'],
    ['color(srgb 1 0 0)', 'hsl(0 100% 50%)']]) {
    const x = C.toHex(a), y = C.toHex(b);
    ok(!!x && !!y && x.hex === y.hex, `${a} ≡ ${b}`, `${x && x.hex} vs ${y && y.hex}`);
  }

  say('\ncolor — gamut mapping holds hue, and says when it fired');
  {
    // Clipping display-p3 green would give #00FF00; chroma reduction must not, and must stay green.
    const g = C.toHex('color(display-p3 0 1 0)');
    ok(!!g && g.gamutMapped === true, 'p3 green reports gamutMapped', JSON.stringify(g));
    ok(!!g && g.hex !== '#00FF00', 'p3 green is not naive-clipped to #00FF00', g && g.hex);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(g.hex.slice(i, i + 2), 16));
    ok(gg > r && gg > b, 'p3 green is still green after mapping', g && g.hex);
    // Anything already inside sRGB must never be touched.
    ok(C.toHex('color(srgb 0.5 0.25 0.75)').gamutMapped === false, 'an in-gamut color is never mapped');
    ok(C.toHex('oklch(0.5 0 0)').gamutMapped === false, 'the gray axis is never mapped');
    // …and neither is a value that sits a hair outside it and rounds to the same hex anyway. This is
    // the exact shape tailwindcss.com serves plain white in, and flagging it would be noise.
    const w = C.toHex('oklab(0.999994 0.0000455678 0.0000200868 / 0.5)');
    ok(w.hex === '#FFFFFF' && w.gamutMapped === false && w.alpha === true,
      'a barely-out-of-gamut white is not flagged (and keeps its alpha)', JSON.stringify(w));
  }

  say('\ncolor — replaceColors rewrites every color in a longer value');
  {
    const luma = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const gray = (s) => C.replaceColors(s, (c) => {
      const y = luma(c.r, c.g, c.b);
      return c.hasAlpha ? `rgba(${y}, ${y}, ${y}, ${c.a})` : `rgb(${y}, ${y}, ${y})`;
    });
    for (const [input, want, why] of REPLACEMENTS) ok(gray(input) === want, `${why}`, `${JSON.stringify(input)} → ${JSON.stringify(gray(input))}`);
  }

  say('\ncolor — hasColor is the pre-filter, widened from the old `indexOf("rgb")`');
  for (const [v, want] of [['none', false], ['rgb(1,2,3)', true], ['oklch(1 0 0)', true], ['lab(1 2 3)', true],
    ['color(srgb 1 1 1)', true], ['linear-gradient(red, blue)', false], ['0px', false], ['', false]])
    ok(C.hasColor(v) === want, `hasColor(${JSON.stringify(v)}) === ${want}`, String(C.hasColor(v)));

  say('\ncolor — the same input twice is the same answer (determinism)');
  for (const v of ['oklch(0.623 0.214 259.815)', 'color(display-p3 1 0 0)', 'lab(54.2905 80.8124 69.8935)'])
    ok(JSON.stringify(C.toHex(v)) === JSON.stringify(C.toHex(v)), `${v} is stable across calls`);

  return { pass, fail };
}

// ── Mutation harness ──────────────────────────────────────────────────────────
// Each entry patches ONE thing in color.js and must make the suite above fail. If a mutation survives,
// something real is unguarded — that is the finding, and it is printed as a failure.
const MUTATIONS = [
  ['4.0767416621', '4.0867416621', 'OKLab → linear-sRGB matrix'],
  ['0.4122214708', '0.4222214708', 'linear-sRGB → OKLab matrix (only the gamut mapper reads it)'],
  ['0.9554734527042182', '0.9654734527042182', 'Bradford D50 → D65 adaptation'],
  ['3.2409699419045226', '3.2509699419045226', 'XYZ D65 → linear sRGB matrix'],
  ['0.4865709486482162', '0.4965709486482162', 'display-p3 → XYZ matrix'],
  ['24389 / 27', '24389 / 28', 'the CIE Lab kappa'],
  ['a <= 0.0031308', 'a <= 0.031308', 'the sRGB encode threshold'],
  ['a <= 0.04045', 'a <= 0.4045', 'the sRGB decode threshold'],
  ['1 / 2.4', '1 / 2.2', 'the sRGB encode exponent'],
  ['const JND = 0.02', 'const JND = 99', 'the gamut-mapping just-noticeable-difference (collapses it to naive clipping)'],
  ['ok ? 1 : 100', 'ok ? 1 : 1', 'the Lab-vs-OKLab lightness scale'],
  ['ok ? 0.4 : 125', 'ok ? 0.4 : 12.5', 'the Lab a/b percentage reference'],
  ['ok ? 0.4 : 125', 'ok ? 0.04 : 125', 'the OKLab a/b percentage reference'],
  ['ok ? 0.4 : 150', 'ok ? 0.4 : 15', 'the LCh chroma percentage reference'],
  ['ok ? 0.4 : 150', 'ok ? 0.04 : 150', 'the OKLCh chroma percentage reference'],
  ['C * Math.cos(H * Math.PI / 180), C * Math.sin', 'C * Math.sin(H * Math.PI / 180), C * Math.cos', 'the polar → rectangular conversion'],
  ['const conv = COLOR_SPACES[space];', 'const conv = COLOR_SPACES[space] || COLOR_SPACES.srgb;', 'the unknown-color-space rejection (a silent fallback is exactly the bug being fixed)'],
  ['alpha: c.a < 1', 'alpha: c.a <= 1', 'the alpha flag'],
  ['gamutMapped: g.mapped && asHex(mappedRgb) !== asHex(naive)', 'gamutMapped: g.mapped',
    'the "only disclose when the hex actually moved" rule (flags a barely-out-of-gamut white as lossy)'],
  ['const naive = enc(clip(rgb01));', 'const naive = enc(g.rgb);',
    'the naive-clip comparison the disclosure is measured against (nothing would ever be flagged)'],
  ["return { a: 1, hasAlpha: false }", "return { a: 1, hasAlpha: true }", 'the "an alpha slot was written" flag lofi-bake depends on'],
  ["if (t === 'none') return 0;", "if (t === 'none') return null;", '`none` handling'],
  ['s.split(\'\').map((c) => c + c)', 's.split(\'\')', 'short-hex expansion'],
];

function loadPatched(src) {
  const mod = { exports: {} };
  new Function('module', 'exports', 'window', src)(mod, mod.exports, undefined);
  return mod.exports;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const MUTATE = process.argv.includes('--mutate');
const src = fs.readFileSync(SRC, 'utf8');

const { pass, fail } = runSuite(require('./color.js'), true);
let mutFail = 0;
if (MUTATE) {
  console.log('\ncolor — mutation testing: each patch below must break the suite');
  for (const [from, to, what] of MUTATIONS) {
    if (!src.includes(from)) { mutFail++; console.log(`  ✗ ${what} — the mutation target \`${from}\` is no longer in color.js; update this table`); continue; }
    let r;
    try { r = runSuite(loadPatched(src.replace(from, to)), false); }
    catch (e) { r = { pass: 0, fail: 1 }; }   // a mutation that throws is caught, same as one that lies
    if (r.fail > 0) console.log(`  ✓ ${what} — caught (${r.fail} assertion${r.fail === 1 ? '' : 's'})`);
    else { mutFail++; console.log(`  ✗ ${what} — SURVIVED: color.js can be wrong here and this suite still passes`); }
  }
}

const bad = fail + mutFail;
console.log(`\n${bad ? '❌' : '✅'}  ${pass} passed, ${fail} failed${MUTATE ? `, ${MUTATIONS.length - mutFail}/${MUTATIONS.length} mutations caught` : ''}\n`);
process.exit(bad ? 1 : 0);
