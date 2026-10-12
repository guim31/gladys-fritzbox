// -----------------------------------------------------------------------------
// The phone books of the box (X_AVM-DE_OnTel, format documented by AVM in
// x_contactSCPD), to give a name to the numbers of the call monitor.
//
// Numbers are compared on their digits: "+49 30 1234567", "0049301234567"
// and "030 1234567" are the same line. A number matches a contact when the
// digits are equal, or when one, without its leading zeros (trunk or
// international prefix), ends the other and keeps 7 digits at least.
// -----------------------------------------------------------------------------

import { blocks, readTag } from './xml.js';

const MIN_SUFFIX_DIGITS = 7;

/** The digits of a phone number, without its leading zeros. */
export function numberKey(number) {
  return String(number ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

/** @returns {Array<{ name: string, numbers: string[] }>} */
export function parsePhonebook(xml) {
  const contacts = [];
  for (const contact of blocks(xml, 'contact')) {
    const [person] = blocks(contact, 'person');
    const name = readTag(person ?? '', 'realName');
    const numbers = blocks(contact, 'number')
      .map((text) => readTag(`<n>${text}</n>`, 'n'))
      .map(numberKey)
      .filter((key) => key.length > 0);
    if (name && numbers.length > 0) {
      contacts.push({ name, numbers });
    }
  }
  return contacts;
}

/** A lookup function over the contacts: number → name, or null. */
export function createLookup(contacts) {
  const exact = new Map();
  for (const contact of contacts) {
    for (const key of contact.numbers) {
      if (!exact.has(key)) {
        exact.set(key, contact.name);
      }
    }
  }
  return (number) => {
    const key = numberKey(number);
    if (!key) {
      return null;
    }
    if (exact.has(key)) {
      return exact.get(key);
    }
    for (const [known, name] of exact) {
      const [short, long] = known.length < key.length ? [known, key] : [key, known];
      if (short.length >= MIN_SUFFIX_DIGITS && long.endsWith(short)) {
        return name;
      }
    }
    return null;
  };
}
