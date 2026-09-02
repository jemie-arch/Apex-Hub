/**
 * Exercise the SERVICE_API_KEY header check.
 *
 * Written after the prefix cost a day. Make's API Key Auth keychain has one
 * "Key" box and no separate prefix field, so whether `Bearer ` and its single
 * space are present depends on somebody typing them into a masked field they
 * cannot read back. The route used to demand the prefix exactly, and a missing
 * one produced a 401 identical to a wrong key — five scenarios failed that way
 * and the cause was invisible from either side.
 *
 * So both shapes are accepted now, and these assertions pin that: a bare key
 * works, a prefixed key works, and nothing else does.
 *
 *   npm run check:auth
 *
 * No database, no network, no secret — the "key" below is invented.
 */
import { headerMatches } from '../src/lib/auth/service-key';

let failures = 0;
let checks = 0;

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}`);
  console.log(`        expected ${JSON.stringify(expected)}`);
  console.log(`        actual   ${JSON.stringify(actual)}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** 32 characters, same shape as env.ts asks for. Not a real key. */
const KEY = 'kR7mQ2vX9nL4tB8wZ3fH6yD1sJ5pC0aE';

// ---------------------------------------------------------------------------
section('Both shapes Make can produce are accepted');
{
  check('with the Bearer prefix', headerMatches(`Bearer ${KEY}`, KEY), true);
  check('bare, no prefix at all', headerMatches(KEY, KEY), true);
  // A sender that lowercases headers is a typo, not an attack.
  check('lowercase scheme', headerMatches(`bearer ${KEY}`, KEY), true);
  check('mixed case scheme', headerMatches(`BEARER ${KEY}`, KEY), true);
  check('extra spaces after the scheme', headerMatches(`Bearer    ${KEY}`, KEY), true);
  check('surrounding whitespace', headerMatches(`  Bearer ${KEY}  `, KEY), true);
}

section('Nothing else is');
{
  check('no header', headerMatches(null, KEY), false);
  check('empty header', headerMatches('', KEY), false);
  check('wrong key', headerMatches(`Bearer ${'x'.repeat(KEY.length)}`, KEY), false);
  check('wrong key, no prefix', headerMatches('x'.repeat(KEY.length), KEY), false);
  // Length differs, so this must fail before any character comparison.
  check('a prefix of the real key', headerMatches(KEY.slice(0, 16), KEY), false);
  check('the real key plus a character', headerMatches(`${KEY}x`, KEY), false);
  check('the scheme alone', headerMatches('Bearer', KEY), false);
  check('the scheme with nothing after it', headerMatches('Bearer ', KEY), false);
  // "Bearer" glued to the key is what an empty-space prefix produces, and it is
  // NOT the same as the key — the regex requires whitespace after the scheme.
  check('Bearer glued to the key', headerMatches(`Bearer${KEY}`, KEY), false);
  check('a different scheme', headerMatches(`Token ${KEY}`, KEY), false);
}

section('The placeholder that caused this');
{
  // Make writes this literal string when a blueprint export redacts a
  // credential. Keychain 215007 held exactly this, which is why it had never
  // once authenticated in any of the five scenarios using it.
  check('masked-key is rejected', headerMatches('masked-key', KEY), false);
  check('and with a prefix too', headerMatches('Bearer masked-key', KEY), false);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
