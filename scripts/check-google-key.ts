/**
 * Exercise the private-key reader.
 *
 * A service account key reaches an environment variable through a text field, a
 * shell or a clipboard, and each damages it differently. The first real paste
 * produced a shape the reader did not handle — Vercel's single-line Value input
 * accepted the key and dropped every newline — and the only feedback was
 * "error:1E08010C:DECODER routines::unsupported", which names neither the key
 * nor the fault.
 *
 * These pin every shape to the same PEM, using a real generated key so the
 * result is checked by OpenSSL rather than by string comparison.
 *
 *   npm run check:googlekey
 *
 * No network, no credentials: the key is generated in the process and thrown
 * away with it.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';

import { normalisePrivateKeyForTests as normalise } from '../src/lib/integrations/google-sheets';

let failures = 0;
let checks = 0;

function check(what: string, ok: boolean) {
  checks += 1;
  console.log(ok ? `  ok    ${what}` : `  FAIL  ${what}`);
  if (!ok) failures += 1;
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const pem = privateKey as string;

/** The only test that matters: can OpenSSL actually sign with the result. */
function signable(candidate: string): boolean {
  try {
    const signer = createSign('RSA-SHA256');
    signer.update('apex');
    signer.sign(normalise(candidate));
    return true;
  } catch {
    return false;
  }
}

console.log('\nEvery shape a pasted key arrives in');

check('real line breaks, untouched', signable(pem));
check('escaped \n, as a shell or JSON leaves it', signable(pem.replace(/\n/g, '\n')));
check('wrapped in double quotes, copied from the JSON field', signable(`"${pem}"`));
check('wrapped in single quotes', signable(`'${pem}'`));
check('leading and trailing whitespace', signable(`\n  ${pem}  \n`));

/*
 * The shape that actually happened. Vercel's single-line input took the key and
 * dropped the newlines, leaving one long string that OpenSSL will not decode.
 */
check(
  'NO line breaks at all — the Vercel single-line paste',
  signable(pem.replace(/\n/g, '')),
);
check(
  'no line breaks and spaces instead',
  signable(pem.replace(/\n/g, ' ')),
);
check(
  'no line breaks, wrapped in quotes, escaped — all three at once',
  signable(`"${pem.replace(/\n/g, '')}"`),
);

console.log('\nAnd what it must not do');

// A rebuilt key must be byte-identical to the original, not merely signable.
const rebuilt = normalise(pem.replace(/\n/g, ''));
check(
  'rebuilding from an unwrapped key reproduces the original exactly',
  rebuilt.trim() === pem.trim(),
);
check(
  'a string with no PEM markers is returned untouched, not mangled',
  normalise('not-a-key') === 'not-a-key',
);
check('an empty value stays empty', normalise('') === '');

console.log(
  failures === 0
    ? `\n${checks}/${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`,
);

process.exit(failures === 0 ? 0 : 1);
