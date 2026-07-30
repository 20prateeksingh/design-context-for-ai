'use strict';
/**
 * tools/thumb.js — ONE SMALL RASTER PER CAPTURED PAGE.
 *
 * Why this file exists. Every on-screen consumer of a page's face — the map disc, the hover peek, the
 * rail panel, the atlas card, the journal strip — pointed at `screenshot.png`, which is a FULL-PAGE
 * capture: measured on the fleet, flipkart ships 39 of them totalling 57 MB with a largest of
 * 2934×18816, and wikipedia 39 / 69 MB with a largest of 2400×45656 (~110 megapixels, ~440 MB once
 * decoded) — to fill a ~40px circle. The map's pan/zoom path re-samples those bitmaps on every frame,
 * so the cost is not just load: it is every gesture. This module derives one small raster per page and
 * every consumer above renders it instead.
 *
 * The full screenshot stays THE ARTIFACT. The thumbnail is a rendering convenience and never a second
 * source of truth: it is a pure, deterministic function of `screenshot.png`, the page doc's hero still
 * loads the original at full length, and every "open full screenshot" link still points at the original.
 * Nothing reads a thumbnail to learn a fact about the product — it is not in `registry.json` for exactly
 * that reason (an agent reading the library must never be offered a downsampled stand-in for pixel truth).
 *
 * ── SIZE: 762 px, and where that number comes from ────────────────────────────────────────────────
 * The raster has to serve the two largest boxes any consumer can give it, on a 2× display. Both were
 * MEASURED in the browser, not estimated:
 *
 *   · The map's largest disc at maximum zoom. The biggest disc is always home, sized
 *     `max(58, minD*0.10)` where minD is the short side of #maparea. On a 2560×1440 CSS viewport (a 5K
 *     display at dpr 2 — the largest mainstream desktop surface) #maparea measures 2220×1327, so
 *     minD=1327 and the disc's border box is 133px. Its 3px rim leaves a 127px aperture (the background
 *     is sized against the padding box), `clampZoom` caps zoom at 3, and dpr is 2:
 *         127 × 3 × 2 = 762 device px.        ← measured live: 399px border box, 381px aperture, ×2 = 762
 *
 *   · The widest atlas card. `.atlas` is `auto-fill minmax(236px,1fr)`, so card width is a sawtooth in
 *     viewport width; its desktop maximum is the two-column layout just before a third column fits —
 *     measured at a 1171px viewport: a 360.5px card, so 721 device px. (A window narrower than ~540px
 *     collapses the grid to one ~490px column; that is a phone-shaped window for a desktop tool, and it
 *     upscales the thumb rather than breaking it.)
 *
 * 762 = max(762, 721). Not rounded, because rounding down would soften the case that set it. Beyond a
 * 2560×1440 CSS viewport, or in a sub-540px window, the raster upscales slightly — and the full PNG is
 * always one click away.
 *
 * ── FRAMING: the top square ──────────────────────────────────────────────────────────────────────
 * A square, cropped from the TOP of the page (centred horizontally if the page is wider than it is
 * tall). One square serves all four `object-fit:cover; object-position:top` consumers *and* the disc,
 * and it reproduces each one's current framing exactly: the atlas card's 16:9 window over a 762 square
 * shows the same top slice of the page it shows over the full PNG (verified arithmetically per
 * consumer in the build report). One exception, deliberate: the map disc's background is
 * `center/cover`, so it shows the page's vertical MIDDLE today. It now shows the top, like everything
 * else — which is the framing the brief specified and makes a page look the same on the disc, the card
 * and the peek.
 *
 * ── FORMAT AND MECHANISM: PNG, encoded here, no new dependency ───────────────────────────────────
 * Playwright can only screenshot PNG/JPEG and cannot resize, and re-screenshotting at a small viewport
 * is WRONG — it re-lays-out the page at a different breakpoint, so the thumbnail would not depict the
 * page that was captured. Downscaling on a canvas inside the browser is unavailable to build-index.js
 * (which has no browser) and its resampler is platform- and version-dependent, which the determinism
 * gate cannot accept. So the decode → box filter → re-encode happens here, in integer arithmetic, on
 * Node's built-in `zlib` and nothing else:
 *
 *   · DETERMINISTIC BY CONSTRUCTION. Integer box averaging, adaptive PNG row filters chosen by an
 *     integer cost, `deflateSync` with every option pinned, and only IHDR/IDAT/IEND written — no tIME,
 *     no tEXt, no encoder version string, nothing sourced from the clock or the environment. Two runs
 *     produce byte-identical files, and so do capture.js and build-index.js: the backfill and a
 *     re-capture can never disagree about a page's thumbnail.
 *   · CHEAP. Only the top `min(width,height)` rows are decoded. PNG rows are filtered against their
 *     predecessor so the stream must be read in order, but it can be STOPPED: wikipedia's tallest page
 *     needs 2400 of 45656 rows (5%), flipkart's 2934 of 18816 (16%).
 *
 * Unsupported inputs (16-bit, interlaced, palette) are reported, never guessed at — the caller leaves
 * no thumbnail behind and every consumer falls back to `screenshot.png`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const THUMB_NAME = 'thumb.png';
const THUMB_PX = 762;                       // see the derivation above
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };  // 8-bit colour types we decode (3 = palette is not one)

// ── CRC32 (PNG chunk checksums) ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

class ThumbUnsupported extends Error {}

// ── DECODE: the top `rows` scanlines of an 8-bit non-interlaced PNG ────────────────────────────────
function decodeTop(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47 || buf.readUInt32BE(4) !== 0x0D0A1A0A) {
    throw new ThumbUnsupported('not a PNG');
  }
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) break;   // truncated tail — stop at the last whole chunk
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9],
               comp: data[10], filter: data[11], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new ThumbUnsupported('no IHDR');
  if (ihdr.depth !== 8) throw new ThumbUnsupported(`bit depth ${ihdr.depth}`);
  if (ihdr.interlace !== 0) throw new ThumbUnsupported('interlaced');
  if (ihdr.comp !== 0 || ihdr.filter !== 0) throw new ThumbUnsupported('non-standard compression/filter');
  const ch = CHANNELS[ihdr.color];
  if (!ch) throw new ThumbUnsupported(`colour type ${ihdr.color}`);
  if (!ihdr.w || !ihdr.h) throw new ThumbUnsupported('zero dimension');
  if (!idat.length) throw new ThumbUnsupported('no IDAT');

  const side = Math.min(ihdr.w, ihdr.h);      // the square we crop — only its rows are decoded
  const stride = ihdr.w * ch;
  const need = side * (stride + 1);           // filter byte + scanline, per row
  const stream = Buffer.concat(idat);

  // Inflate a PREFIX of the IDAT stream and grow it until enough scanlines are out. Z_SYNC_FLUSH is
  // what makes a deliberately truncated stream return its partial output instead of throwing.
  let take = Math.min(stream.length, Math.max(1 << 16, Math.ceil(need / 8)));
  let raw;
  for (;;) {
    raw = zlib.inflateSync(stream.subarray(0, take), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    if (raw.length >= need || take >= stream.length) break;
    take = Math.min(stream.length, take * 2);
  }
  if (raw.length < need) throw new ThumbUnsupported('IDAT shorter than the image');

  // unfilter, in place, into a rows-major buffer
  const out = Buffer.alloc(side * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < side; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    if (ft === 1) { for (let i = ch; i < stride; i++) cur[i] = (cur[i] + cur[i - ch]) & 255; }
    else if (ft === 2) { for (let i = 0; i < stride; i++) cur[i] = (cur[i] + prev[i]) & 255; }
    else if (ft === 3) {
      for (let i = 0; i < stride; i++) { const a = i >= ch ? cur[i - ch] : 0; cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255; }
    } else if (ft === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      }
    } else if (ft !== 0) throw new ThumbUnsupported(`filter type ${ft}`);
    prev = cur;
  }
  return { px: out, w: ihdr.w, h: ihdr.h, ch, side };
}

// ── BOX DOWNSCALE → RGB ───────────────────────────────────────────────────────────────────────────
// Every target pixel is the unweighted mean of the source pixels whose centres fall in its bin. Bin
// edges are integer divisions, the accumulator is an integer, and the divide rounds half-up — so the
// result depends on nothing but the source bytes. Alpha (never present in a Playwright screenshot, but
// legal in the format) composites over white.
function downscale(src, S) {
  const { px, w, ch, side } = src;
  const x0 = ((w - side) / 2) | 0;            // wider-than-tall pages crop from the horizontal centre
  const stride = w * ch;
  const out = Buffer.alloc(S * S * 3);
  let o = 0;
  for (let ty = 0; ty < S; ty++) {
    const sy0 = Math.floor(ty * side / S);
    const sy1 = Math.max(sy0 + 1, Math.floor((ty + 1) * side / S));
    for (let tx = 0; tx < S; tx++) {
      const sx0 = Math.floor(tx * side / S);
      const sx1 = Math.max(sx0 + 1, Math.floor((tx + 1) * side / S));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = sy0; y < sy1; y++) {
        let i = y * stride + (x0 + sx0) * ch;
        for (let x = sx0; x < sx1; x++, i += ch) {
          let pr, pg, pb, pa = 255;
          if (ch === 3) { pr = px[i]; pg = px[i + 1]; pb = px[i + 2]; }
          else if (ch === 4) { pr = px[i]; pg = px[i + 1]; pb = px[i + 2]; pa = px[i + 3]; }
          else if (ch === 1) { pr = pg = pb = px[i]; }
          else { pr = pg = pb = px[i]; pa = px[i + 1]; }
          if (pa !== 255) {
            const inv = 255 - pa;
            pr = Math.round((pr * pa + 255 * inv) / 255);
            pg = Math.round((pg * pa + 255 * inv) / 255);
            pb = Math.round((pb * pa + 255 * inv) / 255);
          }
          r += pr; g += pg; b += pb; n++;
        }
      }
      out[o++] = Math.floor((r + n / 2) / n);
      out[o++] = Math.floor((g + n / 2) / n);
      out[o++] = Math.floor((b + n / 2) / n);
    }
  }
  return out;
}

// ── ENCODE: 8-bit RGB PNG, adaptive row filters, pinned deflate ────────────────────────────────────
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
// the standard minimum-sum-of-absolute-differences heuristic: cheapest row wins, magnitudes read as
// signed bytes. Integer only, so the choice is identical on every run and every machine.
function filterRows(rgb, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = rgb.subarray(y * stride, (y + 1) * stride);
    const cost = [0, 0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const x = cur[i], a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      const v = [x, (x - a) & 255, (x - b) & 255, (x - ((a + b) >> 1)) & 255, (x - pred) & 255];
      for (let k = 0; k < 5; k++) { cand[k][i] = v[k]; cost[k] += v[k] < 128 ? v[k] : 256 - v[k]; }
    }
    let best = 0;
    for (let k = 1; k < 5; k++) if (cost[k] < cost[best]) best = k;
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    prev = cur;
  }
  return raw;
}
function encodePng(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGB, deflate, adaptive, no interlace
  const idat = zlib.deflateSync(filterRows(rgb, w, h), {
    level: 9, windowBits: 15, memLevel: 8, strategy: zlib.constants.Z_DEFAULT_STRATEGY,
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── PUBLIC ────────────────────────────────────────────────────────────────────────────────────────
const shotPath = (pageDir) => path.join(pageDir, 'screenshot.png');
const thumbPath = (pageDir) => path.join(pageDir, THUMB_NAME);

/** true when this page has a screenshot whose thumbnail is missing or older than it (⇒ a re-capture
 *  invalidates the thumbnail). false when there is nothing to derive from, or the thumb is current. */
function thumbStale(pageDir) {
  let shotM;
  try { shotM = fs.statSync(shotPath(pageDir)).mtimeMs; } catch { return false; }
  try { return fs.statSync(thumbPath(pageDir)).mtimeMs < shotM; } catch { return true; }
}

/** Derive and write pages/<slug>/thumb.png. Returns {ok:true, bytes, w, h, side, px} or
 *  {ok:false, reason} — the caller must treat a failure as "no thumbnail", never as an error to stop on. */
function writeThumb(pageDir) {
  try {
    const src = decodeTop(shotPath(pageDir));
    const S = Math.min(THUMB_PX, src.side);   // never upscale a page smaller than the target
    const buf = encodePng(downscale(src, S), S, S);
    fs.writeFileSync(thumbPath(pageDir), buf);
    return { ok: true, bytes: buf.length, w: src.w, h: src.h, side: src.side, px: S };
  } catch (e) {
    return { ok: false, reason: e instanceof ThumbUnsupported ? e.message : (e.code || e.message) };
  }
}

/** Backfill every page directory under <libDir>/pages that needs one. Pages only — a state's own
 *  screenshot renders in a 150×92 strip and is out of this round's scope. Returns a tally. */
function backfillThumbs(libDir) {
  const pagesDir = path.join(libDir, 'pages');
  const out = { written: 0, skipped: 0, failed: [] };
  let slugs;
  try { slugs = fs.readdirSync(pagesDir).sort(); } catch { return out; }
  for (const slug of slugs) {
    const dir = path.join(pagesDir, slug);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    if (!fs.existsSync(shotPath(dir))) continue;
    if (!thumbStale(dir)) { out.skipped++; continue; }
    const r = writeThumb(dir);
    if (r.ok) out.written++; else out.failed.push({ slug, reason: r.reason });
  }
  return out;
}

/** the relative path a consumer should render, or null when this page has no thumbnail on disk */
function thumbRel(libDir, slug) {
  return fs.existsSync(thumbPath(path.join(libDir, 'pages', slug))) ? `pages/${slug}/${THUMB_NAME}` : null;
}

module.exports = { THUMB_NAME, THUMB_PX, thumbStale, writeThumb, backfillThumbs, thumbRel };
