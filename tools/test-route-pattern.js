#!/usr/bin/env node
/**
 * test-route-pattern.js — guard over the canonical id-like-segment heuristic (S1,
 * prds/small-open-items-round.md). Each disjunct of isIdSegment gets a boundary-value pair
 * (smallest value that fires, largest neighbor that doesn't) chosen so it can ONLY pass through
 * that one clause — mutating or deleting any single clause fails at least one assertion here.
 * Verified by hand: comment out each clause in turn and confirm this file goes red before
 * trusting it green (the test-prompts.js standard — prove the guard bites).
 *
 * Usage: node tools/test-route-pattern.js      (exit 0 = pass, 1 = fail)
 */
const { isIdSegment, patternize } = require('./route-pattern.js');

let pass = 0, fail = 0;
const ok = (cond, what, detail) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`); } };

console.log('\nisIdSegment — clause 1: all-digits');
ok(isIdSegment('1') === true, '"1" (single digit) is an id', isIdSegment('1'));
ok(isIdSegment('42918') === true, '"42918" (all digits) is an id', isIdSegment('42918'));
ok(isIdSegment('') === false, 'empty string is not an id', isIdSegment(''));

console.log('\nisIdSegment — clause 2: 12+ hex chars, anchored (no digit needed — isolates from clause 3)');
ok(isIdSegment('abcdefabcdef') === true, '12 hex letters (no digit) is an id — clause 2 only', isIdSegment('abcdefabcdef'));
ok(isIdSegment('abcdefabcde') === false, '11 hex letters (one short) is NOT an id', isIdSegment('abcdefabcde'));
ok(isIdSegment('ABCDEFABCDEF') === true, 'clause 2 is case-insensitive', isIdSegment('ABCDEFABCDEF'));

console.log('\nisIdSegment — clause 3: has a digit, length >= 8, alnum/dash only');
ok(isIdSegment('abcdefg1') === true, '8 chars incl. one digit ("g" breaks the hex clause) is an id', isIdSegment('abcdefg1'));
ok(isIdSegment('abcdefg') === false, '7 chars, no digit at all, is NOT an id', isIdSegment('abcdefg'));
ok(isIdSegment('abcdef1') === false, '7 chars (one short of the length>=8 floor) is NOT an id', isIdSegment('abcdef1'));
ok(isIdSegment('abc-def1') === true, 'dash is allowed inside an id segment', isIdSegment('abc-def1'));
ok(isIdSegment('abc def1') === false, 'a space disqualifies — not alnum/dash', isIdSegment('abc def1'));

console.log('\nisIdSegment — the Amazon ASIN case this round exists to fix (S1 gate)');
ok(isIdSegment('B0CTFD7GZL') === true, '10-char mixed-case ASIN B0CTFD7GZL is now detected', isIdSegment('B0CTFD7GZL'));

console.log('\nisIdSegment — static route words are never ids');
ok(isIdSegment('products') === false, '"products" (letters only, no digit) is not an id');
ok(isIdSegment('dashboard') === false, '"dashboard" is not an id');
ok(isIdSegment('en-us') === false, '"en-us" (locale, no digit) is not an id');

console.log('\npatternize — segment substitution + query stripping + case-folding of static segments');
ok(patternize('/product/B0CTFD7GZL') === '/product/:id', '/product/B0CTFD7GZL → /product/:id', patternize('/product/B0CTFD7GZL'));
ok(patternize('/Search?q=foo&page=2') === '/search', 'query string stripped, static segment lowercased', patternize('/Search?q=foo&page=2'));
ok(patternize('/') === '/', 'root route stays root', patternize('/'));
ok(patternize('') === '/', 'empty route falls back to root', patternize(''));
ok(patternize(null) === '/', 'null route falls back to root', patternize(null));
ok(patternize('/orders/42918/items/7') === '/orders/:id/items/:id', 'multiple id segments each collapse', patternize('/orders/42918/items/7'));

console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
