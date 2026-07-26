#!/usr/bin/env node
/**
 * test-routekey.js — synthetic guard over the page-identity helpers.
 *
 * routeKey() decides whether two URLs are "the same page", which decides whether a capture OVERWRITES
 * an existing page folder or creates a new one. It exists twice on purpose (capture.js needs no
 * build-index dependency and vice versa) and the two copies are kept in sync BY HAND — so this test
 * imports both and asserts they agree on every vector. A drift here silently corrupts a library:
 * the bug that prompted it (UAT #21) overwrote a signed-out login page with signed-in feed content
 * because routeKey ignored the host.
 *
 * Pure functions only — no browser, no network, no library on disk.
 *
 * Usage: node tools/test-routekey.js      (exit 0 = pass, 1 = fail)
 */

const { routeKey: rkCapture, slugFor, cleanSearch } = require('./capture.js');
const { routeKey: rkIndex } = require('./build-index.js');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };
const same = (a, b, what) => ok(rkCapture(a) === rkCapture(b), what, `${rkCapture(a)} vs ${rkCapture(b)}`);
const differ = (a, b, what) => ok(rkCapture(a) !== rkCapture(b), what, `both → ${rkCapture(a)}`);

// The full vector: every URL either copy is ever asked about. Reused for the mirror check below.
const VECTOR = [
  'https://in.pinterest.com/',
  'https://www.pinterest.com/',
  'https://pinterest.com/',
  'https://IN.Pinterest.com/',
  'https://in.pinterest.com/ideas/',
  'https://in.pinterest.com/ideas',
  'https://www.flipkart.com/account',
  'https://flipkart.com/account',
  'https://www.flipkart.com/account/',
  'https://www.flipkart.com/account/rewards?link=home_rewards',
  'https://www.flipkart.com/account/rewards',
  'https://www.flipkart.com/search?q=jeans&utm_source=news&otracker=abc',
  'https://www.flipkart.com/search?utm_campaign=x&q=jeans',
  'https://www.flipkart.com/search?q=shoes',
  'https://www.flipkart.com/account?tab=orders',
  'https://www.flipkart.com/account?tab=returns',
  'https://seller.flipkart.com/account',
  'https://en.wikipedia.org/wiki/Design',
  'https://en.m.wikipedia.org/wiki/Design',
  'http://flipkart.com/account',
  'https://localhost:4173/pages/home',
  'https://www.pinterest.com/?gclid=1&fbclid=2&ref_=nav',
  'not a url at all',
  '',
];

console.log('\nrouteKey — host is part of page identity (UAT #21)');
differ('https://in.pinterest.com/', 'https://www.pinterest.com/', 'in.pinterest.com/ ≠ www.pinterest.com/ (signed-in feed is not the signed-out landing)');
same('https://www.flipkart.com/account', 'https://flipkart.com/account', 'www.flipkart.com/account = flipkart.com/account (www is not a different product)');
same('https://www.pinterest.com/', 'https://pinterest.com/', 'www. stripped on the bare root too');
same('https://IN.Pinterest.com/ideas', 'https://in.pinterest.com/ideas', 'host comparison is case-insensitive');
differ('https://www.flipkart.com/account', 'https://seller.flipkart.com/account', 'a sibling subdomain is a different page');
differ('https://en.wikipedia.org/wiki/Design', 'https://en.m.wikipedia.org/wiki/Design', 'mobile host is a different page (only www. is an alias)');
ok(rkCapture('https://www.flipkart.com/account').startsWith('flipkart.com/'), 'key is host-prefixed', rkCapture('https://www.flipkart.com/account'));

console.log('\nrouteKey — path normalisation');
same('https://in.pinterest.com/ideas/', 'https://in.pinterest.com/ideas', 'trailing slash on a sub-path is not a different page');
same('https://www.flipkart.com/account/', 'https://www.flipkart.com/account', 'trailing slash, www form');
differ('https://in.pinterest.com/', 'https://in.pinterest.com/ideas', 'root ≠ a sub-path');
ok(rkCapture('http://flipkart.com/account') === rkCapture('https://flipkart.com/account'), 'scheme is not part of the identity (http/https are one page)');

console.log('\nrouteKey — tracking params still collapse, meaningful params still fork (5dd0f75)');
same('https://www.flipkart.com/account/rewards?link=home_rewards', 'https://www.flipkart.com/account/rewards', 'nav-source ?link= collapses');
same('https://www.pinterest.com/?gclid=1&fbclid=2&ref_=nav', 'https://www.pinterest.com/', 'gclid + fbclid + ref_ collapse');
same('https://www.flipkart.com/search?q=jeans&utm_source=news&otracker=abc', 'https://www.flipkart.com/search?utm_campaign=x&q=jeans', 'tracking dropped, real query kept, order-independent');
differ('https://www.flipkart.com/search?q=jeans', 'https://www.flipkart.com/search?q=shoes', '?q= forks');
differ('https://www.flipkart.com/account?tab=orders', 'https://www.flipkart.com/account?tab=returns', '?tab= forks');
differ('https://www.flipkart.com/account?tab=orders', 'https://www.flipkart.com/account', '?tab= is not the same page as no tab');

console.log('\nrouteKey — degenerate input never throws');
ok(rkCapture('not a url at all') === 'not a url at all', 'unparseable string passes through');
ok(rkCapture('') === '/', 'empty string → /');
ok(rkCapture(undefined) === '/', 'undefined → /');

console.log('\nrouteKey — the two hand-synced copies agree (capture.js ↔ build-index.js)');
const drift = VECTOR.filter(u => rkCapture(u) !== rkIndex(u));
ok(drift.length === 0, `identical output on all ${VECTOR.length} vector URLs`,
  drift.map(u => `${u}: capture=${rkCapture(u)} index=${rkIndex(u)}`).join(' | '));
ok(rkCapture(undefined) === rkIndex(undefined) && rkCapture('') === rkIndex(''), 'identical on degenerate input');

console.log('\nslugFor / cleanSearch — the folder name follows the same rules');
ok(slugFor('https://www.flipkart.com/account/rewards?link=home_rewards') === slugFor('https://www.flipkart.com/account/rewards'),
  'tracked and clean URLs land in ONE folder');
ok(slugFor('https://www.flipkart.com/account?tab=orders') !== slugFor('https://www.flipkart.com/account?tab=returns'),
  'meaningful params still fork the folder');
ok(slugFor('https://in.pinterest.com/') === 'home', 'root → home');
ok(cleanSearch('?utm_source=a&gclid=b') === '', 'cleanSearch drops an all-tracking query');
ok(cleanSearch('?b=2&a=1') === '?a=1&b=2', 'cleanSearch sorts kept params');

console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
