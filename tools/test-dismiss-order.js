#!/usr/bin/env node
/**
 * test-dismiss-order.js — unit tests for the M3 cookie-banner dismiss preference order
 * (v1-fix-manifest-record). The bug: the old DISMISS_TEXTS list interleaved accept-all before
 * dismiss/close on one source line, so a banner offering BOTH "Accept All" and "Got it" (the
 * espncricinfo case) clicked accept-all. Order now IS the priority: reject/decline/necessary-only
 * → dismiss/close/got-it/understood → accept-all as a last resort.
 *
 * Pure fixtures, no browser: feeds synthetic available-button-text sets into pickDismissText().
 *
 * Run: node tools/test-dismiss-order.js   (exits 1 on any failure)
 */
const { pickDismissText } = require('./capture.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\ntest-dismiss-order — preference order against synthetic button sets');

// 1. The exact espncricinfo-shaped bug: both accept-all AND a dismiss control present → dismiss wins.
{
  const pick = pickDismissText(['Accept All', 'Got it']);
  check('accept-all + got-it → picks "got it"', pick === 'got it', pick);
}

// 2. Reject/decline beats everything, including a dismiss control also present.
{
  const pick = pickDismissText(['Accept All', 'Got it', 'Reject All']);
  check('reject-all present → wins over both dismiss and accept-all', pick === 'reject all', pick);
}

// 3. "Necessary only" (privacy-preserving) beats a generic close button.
{
  const pick = pickDismissText(['Close', 'Necessary only']);
  check('necessary-only wins over close', pick === 'necessary only', pick);
}

// 4. Accept-all is still clicked when it's the ONLY sanctioned option present (last resort, not never).
{
  const pick = pickDismissText(['Accept All']);
  check('accept-all alone is still a valid last resort', pick === 'accept all', pick);
}

// 5. No recognized text on the banner → no click (return null), never a guess.
{
  const pick = pickDismissText(['Learn more', 'Manage preferences']);
  check('no sanctioned text present → null (no click)', pick === null, pick);
}

// 6. Empty candidate list → null, no throw.
{
  const pick = pickDismissText([]);
  check('empty button list → null', pick === null, pick);
}

// 7. Case/whitespace-insensitive matching (the in-page matcher normalizes the same way).
{
  const pick = pickDismissText(['  ACCEPT   ALL  ', 'Understood']);
  check('case/whitespace normalized before matching → dismiss family still wins', pick === 'understood', pick);
}

// 8. Every dismiss/close synonym individually resolves (group 2 completeness).
{
  for (const t of ['dismiss', 'close', 'got it', 'ok, got it', 'understood', 'ok']) {
    check(`"${t}" alone resolves to itself`, pickDismissText([t]) === t);
  }
}

console.log(`\n${failures ? '❌' : '✅'}  ${failures ? failures + ' failed' : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
