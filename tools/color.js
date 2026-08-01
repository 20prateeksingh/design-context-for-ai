// color.js — the kit's ONE CSS-color parser. Everything that reads a computed color goes through here.
//
// WHY THIS EXISTS: Chrome's getComputedStyle does NOT downsample modern color spaces to rgb(). A
// Tailwind v4 page hands back `oklch(0.446 0.03 256.802)` and `lab(1.90334 0.278696 -5.48866)`
// verbatim. Two places in the kit used to match `rgb()`/`#hex` only and silently drop the rest:
// build-index.js's normColor (90% of tailwindcss.com's color evidence, 85 of 89 distinct colors) and
// lofi-bake.js's grayify (which made the Figma exit a no-op on such a page while reporting success).
// One parser, so there is one place to teach the next color function — and one place for it to be wrong.
//
// WHAT IT RETURNS: sRGB. Always. Callers store `#RRGGBB` and nothing wider — the dashboard's Design
// language tab parses swatch hexes with a bare parseInt(h.slice(1),16) in two places
// (dashboard-template.html, `lum` and `relLum`), so a widened storage format would silently return
// NaN and break swatch label contrast. Convert at the boundary; keep everything downstream on hex.
//
// OUT-OF-GAMUT POLICY (stated once, here, because it is a product decision and not a maths detail):
// a good part of a P3 palette has no exact sRGB hex. We use the CSS Color 4 §13.2 gamut-mapping
// algorithm — reduce chroma in OKLCh, binary-searched against a clipped candidate until the two are
// within a just-noticeable difference (deltaE-OK 0.02). It holds hue and lightness and gives up
// saturation. Naive per-channel clipping is cheaper and visibly wrong: it swings hue on saturated
// blues and reds, so the swatch a designer copies would be the wrong COLOR, not merely a duller one.
// Duller is recoverable by eye; a hue shift is not. Every mapped color is flagged (`gamutMapped`) so
// the caller can disclose it rather than passing a lossy hex off as the product's own value.
//
// DEPENDENCY-FREE AND DUAL-MODE: `require('./color.js')` in Node, `window.__dckColor` when injected
// into a page with addScriptTag (lofi-bake runs in both). The kit ships no color library and should
// not start.
'use strict';
(function () {

// ── sRGB transfer function ────────────────────────────────────────────────────
const lin = (c) => { const a = Math.abs(c), s = c < 0 ? -1 : 1; return a <= 0.04045 ? c / 12.92 : s * Math.pow((a + 0.055) / 1.055, 2.4); };
const gam = (c) => { const a = Math.abs(c), s = c < 0 ? -1 : 1; return a <= 0.0031308 ? c * 12.92 : s * (1.055 * Math.pow(a, 1 / 2.4) - 0.055); };

// 3×3 row-major matrix × column vector.
const mul = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// ── Matrices (CSS Color 4 §17 sample code; OKLab's are Ottosson's) ────────────
const XYZ65_TO_LSRGB = [
  3.2409699419045226, -1.537383177570094, -0.4986107602930034,
  -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
  0.05563007969699366, -0.20397695888897652, 1.0569715142428786];
const LSRGB_TO_XYZ65 = [
  0.41239079926595934, 0.357584339383878, 0.1804807884018343,
  0.21263900587151027, 0.715168678767756, 0.07219231536073371,
  0.01933081871559182, 0.11919477979462598, 0.9505321522496607];
const D50_TO_D65 = [ // Bradford
  0.9554734527042182, -0.023098536874261423, 0.0632593086610217,
  -0.028369706963208136, 1.0099954580058226, 0.021041398966943008,
  0.012314001688319899, -0.020507696433477912, 1.3303659366080753];
const P3_TO_XYZ65 = [
  0.4865709486482162, 0.26566769316909306, 0.1982172852343625,
  0.2289745640697488, 0.6917385218365064, 0.079286914093745,
  0.0000000000000000, 0.04511338185890264, 1.043944368900976];
const A98_TO_XYZ65 = [
  0.5766690429101305, 0.1855582379065463, 0.1882286462349947,
  0.29734497525053605, 0.6273635662554661, 0.07529145849399788,
  0.02703136138641234, 0.07068885253582723, 0.9913375368376388];
const PROPHOTO_TO_XYZ50 = [
  0.7977604896723027, 0.13518583717574031, 0.0313493495815248,
  0.2880711282292934, 0.7118432178101014, 0.00008565396060525902,
  0.0, 0.0, 0.8251046025104601];
const REC2020_TO_XYZ65 = [
  0.6369580483012914, 0.14461690358620832, 0.1688809751641721,
  0.2627002120112671, 0.6779980715188708, 0.05930171646986196,
  0.000000000000000, 0.028072693049087428, 1.060985057710791];
// OKLab ↔ linear-sRGB, via the cube-rooted LMS cone responses (Ottosson). The LMS step is folded
// into these two matrix pairs — there is no separate XYZ hop on this path.
const OKLAB_TO_LMS = [
  1, 0.3963377774, 0.2158037573,
  1, -0.1055613458, -0.0638541728,
  1, -0.0894841775, -1.2914855480];
const LMS_TO_LSRGB = [
  4.0767416621, -3.3077115913, 0.2309699292,
  -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.7076147010];
const LSRGB_TO_LMS = [
  0.4122214708, 0.5363325363, 0.0514459929,
  0.2119034982, 0.6806995451, 0.1073969566,
  0.0883024619, 0.2817188376, 0.6299787005];
const LMS_TO_OKLAB = [
  0.2104542553, 0.7936177850, -0.0040720468,
  1.9779984951, -2.4285922050, 0.4505937099,
  0.0259040371, 0.7827717662, -0.8086757660];

const D50_WHITE = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];

// ── Space → linear sRGB ───────────────────────────────────────────────────────
function oklabToLinearSrgb(L, a, b) {
  const lms = mul(OKLAB_TO_LMS, [L, a, b]);
  return mul(LMS_TO_LSRGB, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}
function linearSrgbToOklab(r, g, b) {
  const lms = mul(LSRGB_TO_LMS, [r, g, b]);
  const cbrt = (x) => (x < 0 ? -Math.cbrt(-x) : Math.cbrt(x));
  return mul(LMS_TO_OKLAB, [cbrt(lms[0]), cbrt(lms[1]), cbrt(lms[2])]);
}
// CIE Lab is D50-referred in CSS, so it needs a chromatic adaptation the OK* spaces do not.
function labToLinearSrgb(L, a, b) {
  const K = 24389 / 27, E = 216 / 24389;
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = fx ** 3 > E ? fx ** 3 : (116 * fx - 16) / K;
  const y = L > K * E ? ((L + 16) / 116) ** 3 : L / K;
  const z = fz ** 3 > E ? fz ** 3 : (116 * fz - 16) / K;
  return mul(XYZ65_TO_LSRGB, mul(D50_TO_D65, [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]));
}
const polar = (C, H) => [C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];

// `color(<space> …)` — each space is its own transfer function plus one matrix.
const sign = (x) => (x < 0 ? -1 : 1);
const COLOR_SPACES = {
  'srgb': (v) => [lin(v[0]), lin(v[1]), lin(v[2])],
  'srgb-linear': (v) => v.slice(0, 3),
  'display-p3': (v) => mul(XYZ65_TO_LSRGB, mul(P3_TO_XYZ65, [lin(v[0]), lin(v[1]), lin(v[2])])),
  'a98-rgb': (v) => mul(XYZ65_TO_LSRGB, mul(A98_TO_XYZ65, v.slice(0, 3).map((c) => sign(c) * Math.pow(Math.abs(c), 563 / 256)))),
  'prophoto-rgb': (v) => mul(XYZ65_TO_LSRGB, mul(D50_TO_D65, mul(PROPHOTO_TO_XYZ50,
    v.slice(0, 3).map((c) => (Math.abs(c) <= 16 / 512 ? c / 16 : sign(c) * Math.pow(Math.abs(c), 1.8)))))),
  'rec2020': (v) => mul(XYZ65_TO_LSRGB, mul(REC2020_TO_XYZ65, v.slice(0, 3).map((c) => {
    const A = 1.09929682680944, B = 0.018053968510807;
    return Math.abs(c) < B * 4.5 ? c / 4.5 : sign(c) * Math.pow((Math.abs(c) + A - 1) / A, 1 / 0.45);
  }))),
  'xyz': (v) => mul(XYZ65_TO_LSRGB, v.slice(0, 3)),
  'xyz-d65': (v) => mul(XYZ65_TO_LSRGB, v.slice(0, 3)),
  'xyz-d50': (v) => mul(XYZ65_TO_LSRGB, mul(D50_TO_D65, v.slice(0, 3))),
};

// ── Gamut mapping (CSS Color 4 §13.2) ─────────────────────────────────────────
const JND = 0.02, EPS = 0.0001, IN = -0.000075, OUT = 1.000075;
const inGamut = (rgb) => rgb.every((c) => c >= IN && c <= OUT);
const clip = (rgb) => rgb.map((c) => Math.min(1, Math.max(0, c)));
function deltaEOK(a, b) {
  const A = linearSrgbToOklab(a[0], a[1], a[2]), B = linearSrgbToOklab(b[0], b[1], b[2]);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
// Returns { rgb (linear, in gamut), mapped } — `mapped` is true only when chroma was actually given up.
function toGamut(rgb) {
  if (inGamut(rgb)) return { rgb: clip(rgb), mapped: false };
  const [L, a, b] = linearSrgbToOklab(rgb[0], rgb[1], rgb[2]);
  if (L >= 1) return { rgb: [1, 1, 1], mapped: true };
  if (L <= 0) return { rgb: [0, 0, 0], mapped: true };
  const H = Math.atan2(b, a) * 180 / Math.PI, C0 = Math.hypot(a, b);
  const at = (c) => { const [x, y] = polar(c, H); return oklabToLinearSrgb(L, x, y); };
  let current = at(C0), clipped = clip(current);
  if (deltaEOK(clipped, current) < JND) return { rgb: clipped, mapped: true };
  let min = 0, max = C0, minInGamut = true;
  while (max - min > EPS) {
    const chroma = (min + max) / 2;
    current = at(chroma);
    if (minInGamut && inGamut(current)) { min = chroma; continue; }
    clipped = clip(current);
    const E = deltaEOK(clipped, current);
    if (E < JND) {
      if (JND - E < EPS) return { rgb: clipped, mapped: true };
      minInGamut = false; min = chroma;
    } else max = chroma;
  }
  return { rgb: clipped, mapped: true };
}

// ── Component parsing ─────────────────────────────────────────────────────────
// `none` is a missing component and computes as 0 (CSS Color 4 §4.4). A percentage is scaled by the
// per-slot reference the spec gives — 100% is 1 for a channel, 125 for Lab a/b, 0.4 for OKLab a/b, etc.
function num(tok, pctRef) {
  if (tok == null) return null;
  const t = tok.trim().toLowerCase();
  if (t === 'none') return 0;
  if (t.endsWith('%')) { const n = parseFloat(t); return isFinite(n) ? (n / 100) * pctRef : null; }
  const n = parseFloat(t);
  return isFinite(n) && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? n : null;
}
function angle(tok) {
  if (tok == null) return null;
  const t = tok.trim().toLowerCase();
  if (t === 'none') return 0;
  const n = parseFloat(t);
  if (!isFinite(n)) return null;
  if (t.endsWith('turn')) return n * 360;
  if (t.endsWith('grad')) return n * 0.9;
  if (t.endsWith('rad')) return n * 180 / Math.PI;
  return n; // deg or bare number
}
// Alpha rides after a `/`. Absent → opaque, and `hasAlpha` stays false so a caller can tell
// "no alpha component was written" from "alpha was written and happens to be 1".
function splitArgs(inner) {
  const [body, alphaTok] = inner.split('/');
  return { parts: body.trim().split(/[\s,]+/).filter(Boolean), alphaTok: alphaTok === undefined ? null : alphaTok };
}
function readAlpha(tok) {
  if (tok === null) return { a: 1, hasAlpha: false };
  const a = num(tok, 1);
  return a === null ? null : { a, hasAlpha: true };
}

// ── The parser ────────────────────────────────────────────────────────────────
// Every recognised color function name. Used both to parse one value and to scan a longer string
// (a box-shadow, a gradient) for the color tokens inside it.
const FN = 'rgba?|hsla?|hwb|lab|lch|oklab|oklch|color';
const FN_RE = new RegExp('\\b(' + FN + ')\\(([^()]*)\\)', 'gi');
const HEX_RE = /^#([0-9a-f]{3,8})$/i;

function hexToRgb255(h) {
  let s = h.slice(1);
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = parseInt(s.slice(0, 6), 16);
  if (!isFinite(n)) return null;
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a, hasAlpha: s.length === 8 };
}

// parse(value) → { r, g, b, a, hasAlpha, fn, gamutMapped } with r/g/b in 0–255, or null.
// r/g/b are NOT rounded: the legacy rgb()/rgba() path returns the authored numbers untouched, which
// is what lets lofi-bake reproduce its pre-existing output byte-for-byte.
function parse(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX_RE.test(v)) { const h = hexToRgb255(v); return h ? { ...h, fn: 'hex', gamutMapped: false } : null; }
  const m = new RegExp('^(' + FN + ')\\(([^()]*)\\)$', 'i').exec(v);
  return m ? parseFn(m[1].toLowerCase(), m[2]) : null;
}

function parseFn(fn, inner) {
  // rgb()/rgba() with a legacy comma list keeps its authored numbers and never touches the color
  // pipeline — that is the path 21 of 22 captured workspaces are entirely made of, and it must not move.
  const { parts, alphaTok } = splitArgs(inner);
  if (fn === 'rgb' || fn === 'rgba') {
    const legacy = inner.split(',').map((s) => s.trim());
    if (alphaTok === null && (legacy.length === 3 || legacy.length === 4)) {
      const p = legacy.slice(0, 3).map((s) => num(s, 255));
      if (p.some((x) => x === null)) return null;
      const a = legacy.length === 4 ? num(legacy[3], 1) : 1;
      if (a === null) return null;
      return { r: p[0], g: p[1], b: p[2], a, hasAlpha: legacy.length === 4, fn, gamutMapped: false };
    }
    if (parts.length !== 3) return null;
    const p = parts.map((s) => num(s, 255));
    if (p.some((x) => x === null)) return null;
    const al = readAlpha(alphaTok); if (!al) return null;
    return { r: p[0], g: p[1], b: p[2], a: al.a, hasAlpha: al.hasAlpha, fn, gamutMapped: false };
  }

  const al = readAlpha(alphaTok);
  if (!al) return null;
  const out = (rgb01) => {
    const g = toGamut(rgb01);
    const enc = (v) => v.map((c) => Math.min(255, Math.max(0, gam(c) * 255)));
    const mappedRgb = enc(g.rgb);
    // Flag the color ONLY when giving up chroma actually moved the 8-bit answer. A value a hair
    // outside the gamut that still rounds to the same hex has lost nothing a designer could see or
    // copy, and flagging it would turn the disclosure into noise: tailwindcss.com serves plain white
    // as `oklab(0.999994 0.0000455678 0.0000200868 / …)`, technically out of gamut and #FFFFFF either
    // way. `gamutMapped` has to mean "this hex is not the color the product ships" or it means nothing.
    const naive = enc(clip(rgb01));
    const asHex = (v) => v.map(hex2).join('');
    return { r: mappedRgb[0], g: mappedRgb[1], b: mappedRgb[2], a: al.a, hasAlpha: al.hasAlpha, fn,
      gamutMapped: g.mapped && asHex(mappedRgb) !== asHex(naive) };
  };

  if (fn === 'hsl' || fn === 'hsla') {
    // hsl's own legacy comma form allows the alpha as a 4th arg.
    const p = parts;
    if (p.length !== 3 && !(p.length === 4 && alphaTok === null)) return null;
    const h = angle(p[0]), s = num(p[1], 1), l = num(p[2], 1);
    if (h === null || s === null || l === null) return null;
    let a = al.a, hasAlpha = al.hasAlpha;
    if (p.length === 4) { const x = num(p[3], 1); if (x === null) return null; a = x; hasAlpha = true; }
    const rgb = hslToRgb01(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
    return { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255, a, hasAlpha, fn, gamutMapped: false };
  }
  if (fn === 'hwb') {
    if (parts.length !== 3) return null;
    const h = angle(parts[0]), w = num(parts[1], 1), b = num(parts[2], 1);
    if (h === null || w === null || b === null) return null;
    const rgb = hwbToRgb01(h, w, b);
    return { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255, a: al.a, hasAlpha: al.hasAlpha, fn, gamutMapped: false };
  }
  if (fn === 'lab' || fn === 'oklab' || fn === 'lch' || fn === 'oklch') {
    if (parts.length !== 3) return null;
    const ok = fn[0] === 'o';
    const L = num(parts[0], ok ? 1 : 100);
    if (L === null) return null;
    let a1, b1;
    if (fn === 'lab' || fn === 'oklab') {
      a1 = num(parts[1], ok ? 0.4 : 125); b1 = num(parts[2], ok ? 0.4 : 125);
    } else {
      const C = num(parts[1], ok ? 0.4 : 150), H = angle(parts[2]);
      if (C === null || H === null) return null;
      [a1, b1] = polar(Math.max(0, C), H);
    }
    if (a1 === null || b1 === null) return null;
    return out(ok ? oklabToLinearSrgb(L, a1, b1) : labToLinearSrgb(L, a1, b1));
  }
  if (fn === 'color') {
    if (parts.length < 4) return null;
    const space = parts[0].toLowerCase();
    const conv = COLOR_SPACES[space];
    if (!conv) return null;                       // an unknown color space stays UNPARSEABLE, and gets counted
    const p = parts.slice(1, 4).map((s) => num(s, 1));
    if (p.some((x) => x === null)) return null;
    return out(conv(p));
  }
  return null;
}

function hslToRgb01(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
function hwbToRgb01(h, w, b) {
  if (w + b >= 1) { const g = w / (w + b); return [g, g, g]; }
  return hslToRgb01(h, 1, 0.5).map((c) => c * (1 - w - b) + w);
}

// ── Public helpers ────────────────────────────────────────────────────────────
const hex2 = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0').toUpperCase();

// toHex(value) → { hex: '#RRGGBB', alpha, gamutMapped, fn } or null. `alpha` is the flag the token
// aggregator has always meant by it: the color is not fully opaque (NOT "an alpha slot was written").
function toHex(value) {
  const c = parse(value);
  if (!c) return null;
  return { hex: '#' + hex2(c.r) + hex2(c.g) + hex2(c.b), alpha: c.a < 1, gamutMapped: c.gamutMapped, fn: c.fn };
}

// replaceColors(str, fn, onUnparsed) — rewrite every color function inside a longer value (a
// box-shadow, a gradient) via fn(parsedColor, matchedText). Returning null/undefined leaves that token
// as it was. `onUnparsed(matchedText)` fires for a color function this build cannot read — the caller
// is expected to COUNT those rather than let them pass as if nothing happened, which is the exact
// failure this module exists to end.
// Bare hex and named colors are deliberately NOT matched: computed styles never serialise them, and
// widening the scan here would change what lofi-bake reports as left-unbaked.
function replaceColors(str, fn, onUnparsed) {
  return String(str).replace(FN_RE, (m, name, inner) => {
    const c = parseFn(name.toLowerCase(), inner);
    if (!c) { if (onUnparsed) onUnparsed(m); return m; }
    const out = fn(c, m);
    return out == null ? m : out;
  });
}

// hasColor(str) — cheap pre-filter, the widened form of the old `v.indexOf('rgb') === -1` guard.
const HAS_RE = new RegExp('\\b(' + FN + ')\\(', 'i');
const hasColor = (str) => !!str && HAS_RE.test(str);

const API = { parse, parseFn, toHex, replaceColors, hasColor, FUNCTIONS: FN.split('|') };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.__dckColor = API;

})();
