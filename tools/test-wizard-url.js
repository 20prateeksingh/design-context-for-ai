#!/usr/bin/env node
/**
 * test-wizard-url.js — guard over the wizard's bare-domain URL normalizer (F5, UAT #14).
 *
 * Usage: node tools/test-wizard-url.js      (exit 0 = pass, 1 = fail)
 */
const { normalizeWizardUrl: n } = require('./wizard-url.js');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };

console.log('\nwizard-url — bare domain gets a scheme');
ok(n('pinterest.com') === 'https://pinterest.com', 'pinterest.com → https://pinterest.com', n('pinterest.com'));
ok(n('app.example.com/dashboard') === 'https://app.example.com/dashboard', 'bare domain + path gets a scheme', n('app.example.com/dashboard'));
ok(n('  pinterest.com  ') === 'https://pinterest.com', 'surrounding whitespace trimmed before checking scheme', n('  pinterest.com  '));

console.log('\nwizard-url — an explicit scheme is never touched');
ok(n('http://pinterest.com') === 'http://pinterest.com', 'typed http:// is never upgraded to https', n('http://pinterest.com'));
ok(n('https://pinterest.com') === 'https://pinterest.com', 'typed https:// passes through unchanged', n('https://pinterest.com'));
ok(n('HTTPS://Pinterest.com') === 'HTTPS://Pinterest.com', 'scheme check is case-insensitive, value untouched', n('HTTPS://Pinterest.com'));

console.log('\nwizard-url — still rejects what cannot be a URL after prepending');
ok(n('not a url at all') === null, 'nonsense text (with spaces) rejected', String(n('not a url at all')));
ok(n('') === null, 'empty string rejected', String(n('')));
ok(n('   ') === null, 'whitespace-only rejected', String(n('   ')));
ok(n(undefined) === null, 'undefined rejected', String(n(undefined)));

console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
