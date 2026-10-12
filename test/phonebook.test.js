import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookup, numberKey, parsePhonebook } from '../src/fritz/phonebook.js';
import { fixture } from './helpers/fakeFritz.js';

const contacts = parsePhonebook(fixture('phonebook.xml'));

test('contacts with their numbers; a contact without number is left out', () => {
  assert.deepEqual(contacts, [
    { name: 'Oma & Opa', numbers: ['301234567', '491707654321'] },
    { name: 'Praxis Dr. Muster', numbers: ['49899876543'] },
  ]);
  assert.equal(numberKey('+49 (30) 123-4567'), '49301234567');
});

test('a number matches whatever its prefix, never a short suffix', () => {
  const lookup = createLookup(contacts);
  assert.equal(lookup('0301234567'), 'Oma & Opa');
  assert.equal(lookup('+49301234567'), 'Oma & Opa');
  assert.equal(lookup('01707654321'), 'Oma & Opa');
  assert.equal(lookup('0899876543'), 'Praxis Dr. Muster');
  assert.equal(lookup('089123456'), null);
  assert.equal(lookup('4567'), null);
  assert.equal(lookup(''), null);
});
