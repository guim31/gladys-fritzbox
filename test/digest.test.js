import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization, parseChallenge } from '../src/fritz/digest.js';

test('the challenge of the box is read, quoted or not', () => {
  assert.deepEqual(
    parseChallenge(
      'Digest realm="HTTPS Access", nonce="A1B2C3D4E5F60718", algorithm=MD5, qop="auth"',
    ),
    { realm: 'HTTPS Access', nonce: 'A1B2C3D4E5F60718', algorithm: 'MD5', qop: 'auth' },
  );
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(undefined), null);
  assert.equal(parseChallenge('Digest realm="x"'), null, 'no nonce');
});

test('the response is the one of RFC 2617 section 3.5', () => {
  const header = authorization({
    challenge: parseChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    ),
    username: 'Mufasa',
    password: 'Circle Of Life',
    method: 'GET',
    uri: '/dir/index.html',
    nc: 1,
    cnonce: '0a4f113b',
  });
  assert.match(header, /^Digest /);
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /nc=00000001/);
  assert.match(header, /qop=auth(,|$)/);
  assert.match(header, /opaque="5ccc069c403ebaf9f0171e9517f40e41"/);
  assert.doesNotMatch(header, /Circle Of Life/, 'the password never travels');
});

test('without qop, the RFC 2069 response is sent', () => {
  const header = authorization({
    challenge: { realm: 'r', nonce: 'n' },
    username: 'u',
    password: 'p',
    method: 'POST',
    uri: '/x',
    nc: 1,
  });
  assert.doesNotMatch(header, /qop=/);
  assert.match(header, /response="[0-9a-f]{32}"/);
});
