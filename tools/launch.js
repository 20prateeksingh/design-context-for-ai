/**
 * launch.js — the single place a browser gets launched.
 *
 * WHY THIS MODULE EXISTS
 * Some Windows machines cannot launch Playwright's bundled Chromium. Measured on Windows 11
 * (10.0.26200) on 2026-07-31: the binary downloads fine, then the OS loader refuses it with
 *
 *     browserType.launch: spawn UNKNOWN
 *     chrome.exe: The application has failed to start because its side-by-side
 *                 configuration is incorrect.
 *     SideBySide: Dependent Assembly 149.0.7827.55 type="win32" could not be found.
 *
 * The private SxS manifest shipped beside chrome.exe matches what the binary requests and sits
 * where Windows should resolve it as a private assembly — and the loader still rejects it.
 * Eliminated with evidence, not assumed: corrupted download (deleted %LOCALAPPDATA%\ms-playwright
 * and force-reinstalled → byte-identical failure), missing VC++ redist (x64+x86 2015-2022 present),
 * Mark-of-the-Web (no Zone.Identifier stream), Smart App Control (off), Defender (no detections).
 * sxstrace.exe needs admin, so there is no full loader trace and no clean root cause. This is
 * environmental — nothing in this kit is at fault — but it makes capture impossible on that machine.
 *
 * System Edge is a properly-registered install and is unaffected, so we retry through it.
 *
 * WHY ONE MODULE RATHER THAN A HELPER PER FILE
 * There are NINE launch sites across five files. The Windows session fixed six by putting helpers
 * in capture.js and a third inline copy in login.js — leaving lofi-bake.js, lofi-check.js and
 * shot.js bare, so capture worked on that machine and the wireframe chain did not. Three copies of
 * one retry rule is the same drift the 9-workspace sync discipline exists to prevent. One module,
 * five requires, nine covered sites.
 *
 * SCOPE OF THE FALLBACK — deliberately narrow:
 *   • win32 only. macOS and Linux behaviour is byte-for-byte unchanged; they rethrow as before.
 *   • Never on a locked-profile error. "Profile already in use" is a different failure with its own
 *     carefully-worded UX message in the callers; retrying it in Edge would swallow that.
 *   • Announced. It prints one line, because a library captured on Edge was measured by a different
 *     instrument than one captured on bundled Chromium.
 *
 * KNOWN GAP: the engine is now a variable and manifest.json still records nothing about it. A
 * library captured on Edge is indistinguishable from one captured on bundled Chromium after the
 * fact, which sits badly against `measured or absent` and the `method:` provenance rule.
 * lastEngine() exists so a caller can record it; wiring it into manifest.json is not done yet.
 */

const { chromium } = require('playwright');

// A locked profile is NOT a launch failure — the callers handle it with their own message.
const isLockedProfile = (e) => /existing browser session|already in use/i.test(e.message || '');

const shouldFallBack = (e) => process.platform === 'win32' && !isLockedProfile(e);

let _lastEngine = 'chromium';
/** Which engine actually served the most recent launch: 'chromium' | 'msedge'. */
function lastEngine() { return _lastEngine; }

function announce() {
  console.log('   ℹ bundled Chromium failed to launch — falling back to system Edge.');
}

/** chromium.launch(), with the Windows Edge fallback. */
async function launchChromium(opts = {}) {
  try {
    const b = await chromium.launch(opts);
    _lastEngine = opts.channel || 'chromium';
    return b;
  } catch (e) {
    if (!shouldFallBack(e)) throw e;
    announce();
    const b = await chromium.launch({ ...opts, channel: 'msedge' });
    _lastEngine = 'msedge';
    return b;
  }
}

/** chromium.launchPersistentContext(), with the Windows Edge fallback. */
async function launchPersistent(profileDir, opts = {}) {
  try {
    const c = await chromium.launchPersistentContext(profileDir, opts);
    _lastEngine = opts.channel || 'chromium';
    return c;
  } catch (e) {
    if (!shouldFallBack(e)) throw e;
    announce();
    const c = await chromium.launchPersistentContext(profileDir, { ...opts, channel: 'msedge' });
    _lastEngine = 'msedge';
    return c;
  }
}

module.exports = { launchChromium, launchPersistent, lastEngine, isLockedProfile };
