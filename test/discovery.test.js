import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxCandidates, parseSsdpHeaders } from '../src/discovery.js';
import { SSDP_RESULTS } from './helpers/world.js';

test('SSDP headers are read case-insensitively', () => {
  const headers = parseSsdpHeaders(SSDP_RESULTS[0].headers);
  assert.equal(headers.location, 'http://192.0.2.1:49000/tr64desc.xml');
  assert.equal(headers.st, 'urn:dslforum-org:device:InternetGatewayDevice:1');
  assert.equal(headers.ext, '');
});

test('one candidate per address serving its own TR-064 description, the box first', () => {
  assert.deepEqual(boxCandidates(SSDP_RESULTS), [
    { address: '192.0.2.1', server: 'fritz.box UPnP/1.0 AVM FRITZ!Box 7590 154.07.29' },
    { address: '192.0.2.34', server: 'fritz.repeater UPnP/1.0 AVM FRITZ!Repeater 1200 225.07.29' },
  ]);
  assert.deepEqual(boxCandidates([...SSDP_RESULTS].reverse())[0].address, '192.0.2.1');
  assert.deepEqual(boxCandidates(null), []);
  assert.deepEqual(boxCandidates([{ source_ip: '192.0.2.9', headers: 'LOCATION: nope' }]), []);
});
