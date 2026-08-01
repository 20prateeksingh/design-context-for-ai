#!/usr/bin/env node
/**
 * login.js — one-time login into the kit's persistent browser profile.
 *
 * Opens a real, visible browser window on your product using a profile stored
 * in profiles/<name>. YOU log in by hand (the tool never sees or stores your
 * password — only the browser does, exactly like normal Chrome). When you're
 * done, close the browser window; the session lives on in the profile and
 * capture.js reuses it.
 *
 * Usage:
 *   node login.js --url https://app.example.com [--profile default]
 *
 * The profiles/ folder holds real session cookies. Never commit or share it.
 */

const { launchPersistent } = require('./launch.js');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (flag, dflt) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : dflt; };

const url = getArg('--url', null);
const profileName = getArg('--profile', 'default');
const profileDir = path.join(__dirname, '..', 'profiles', profileName);

if (!url) {
  console.error('Usage: node login.js --url <your product URL> [--profile default]');
  process.exit(1);
}

(async () => {
  console.log(`\n→ Opening a browser window on ${url}`);
  console.log(`  Profile: profiles/${profileName}  (your session is saved here, on this machine only)`);
  console.log(`\n  Log in as you normally would, browse to make sure you're in,`);
  console.log(`  then CLOSE THE BROWSER WINDOW to finish.\n`);

  const context = await launchPersistent(profileDir, {
    headless: false,
    viewport: null,
    args: ['--window-size=1440,900'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

  await new Promise((resolve) => context.on('close', resolve));
  console.log('✅  Browser closed — session saved. You can now run capture.js.');
})();
