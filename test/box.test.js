import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FritzBox,
  boxIdOf,
  connectionServiceName,
  guestWifiService,
  megabits,
  normalizeMac,
  parseHostList,
} from '../src/fritz/box.js';
import { PASSWORD, USERNAME, createFakeFritz, fixture } from './helpers/fakeFritz.js';

async function connected(options) {
  const fake = createFakeFritz(options);
  const box = new FritzBox({
    host: fake.host,
    username: USERNAME,
    password: PASSWORD,
    request: fake.request,
  });
  await box.connect();
  return { fake, box };
}

test('the real host list of fritzconnection is read, active or not', () => {
  const hosts = parseHostList(fixture('devicehostlist.xml'));
  assert.equal(hosts.length, 4);
  assert.deepEqual(hosts[0], {
    mac: '02:00:5e:10:00:54',
    ip: '192.0.2.54',
    name: 'MacBook',
    active: true,
    interface: '802.11',
    guest: false,
  });
  assert.deepEqual(
    hosts.map((host) => [host.name, host.active]),
    [
      ['MacBook', true],
      ['fritz.repeater', true],
      ['someones-HUAWEI', false],
      ['raspberrypi', true],
    ],
  );
  assert.deepEqual(parseHostList('<List><Item><MACAddress>nope</MACAddress></Item></List>'), []);
});

test('small parsers: connection service, guest Wi-Fi, id, MAC, rates', () => {
  assert.equal(connectionServiceName('1.WANPPPConnection.1'), 'WANPPPConnection1');
  assert.equal(connectionServiceName('1.WANIPConnection.1'), 'WANIPConnection1');
  assert.equal(connectionServiceName(''), null);
  const services = (n) =>
    new Map(Array.from({ length: n }, (_, i) => [`WLANConfiguration${i + 1}`, {}]));
  assert.equal(guestWifiService(services(3)), 'WLANConfiguration3');
  assert.equal(guestWifiService(services(4)), 'WLANConfiguration4');
  assert.equal(guestWifiService(services(1)), null);
  assert.equal(boxIdOf({ serial: '98:9B:CB:0A:0B:0C' }), '989bcb0a0b0c');
  assert.equal(boxIdOf({ udn: 'uuid:739f2409-bccb-40e7-8e6c-989BCB0A0B0C' }), '989bcb0a0b0c');
  assert.equal(boxIdOf({}), null);
  assert.equal(normalizeMac('02-00-5E-10-00-54'), '02:00:5e:10:00:54');
  assert.equal(normalizeMac('02:00'), null);
  assert.equal(megabits('318557000'), 319);
  assert.equal(megabits('51805000'), 51.8);
  assert.equal(megabits('67649', { bytes: true }), 0.54);
  assert.equal(megabits(''), null);
  assert.equal(megabits('-1'), null);
});

test('connect finds the identity and what the box offers', async () => {
  const { box } = await connected();
  assert.deepEqual(box.info, {
    id: '989bcb0a0b0c',
    model: 'FRITZ!Box 7530 AX',
    name: 'FRITZ!Box 7590',
    firmware: '256.08.00',
  });
  assert.deepEqual(box.capabilities, {
    wan: true,
    connectionService: 'WANPPPConnection1',
    link: true,
    rates: true,
    igd: true,
    guestWifi: 'WLANConfiguration3',
    hosts: true,
    phonebook: true,
  });
});

test('the status of a connected DSL line, in Mbit/s', async () => {
  const { box } = await connected();
  assert.deepEqual(await box.readStatus(), {
    connected: true,
    uptime: 57199,
    externalIp: '203.0.113.17',
    linkUp: true,
    maxDownload: 319,
    maxUpload: 51.8,
    download: 0.54,
    upload: 0.03,
  });
});

test('disconnected: no IP, no uptime; a refused part stays null, the rest is read', async () => {
  const { fake, box } = await connected({
    denied: ['WANCommonInterfaceConfig1#GetCommonLinkProperties'],
  });
  fake.connected = false;
  const status = await box.readStatus();
  assert.equal(status.connected, false);
  assert.equal(status.externalIp, null);
  assert.equal(status.uptime, 0);
  assert.equal(status.maxDownload, null);
  assert.equal(status.download, 0.54);
});

test('without the UPnP status, the current rates are unknown', async () => {
  const { box } = await connected({ igd: false });
  assert.equal(box.capabilities.rates, false);
  const status = await box.readStatus();
  assert.equal(status.download, null);
  assert.equal(status.maxDownload, 319);
});

test('a box without the DeviceInfo right still gets an id from its UDN', async () => {
  const { box } = await connected({ denied: ['DeviceInfo1#GetInfo'] });
  assert.equal(box.info.id, '989bcb0a0b0c');
  assert.equal(box.info.model, 'FRITZ!Box 7590');
});

test('guest Wi-Fi: read, switched, password', async () => {
  const { fake, box } = await connected();
  assert.deepEqual(await box.readGuestWifi(), { enabled: false, ssid: 'FRITZ!Box Gastzugang' });
  await box.setGuestWifi(true);
  assert.equal(fake.guestEnabled, true);
  assert.equal((await box.readGuestWifi()).enabled, true);
  assert.equal(await box.guestWifiPassword(), 'guest-1234-5678');
});

test('hosts through the host list document', async () => {
  const { fake, box } = await connected();
  const hosts = await box.readHosts();
  assert.equal(hosts.length, 4);
  assert.ok(fake.requests.some((request) => request.path.startsWith('/devicehostlist.lua?sid=')));
});

test('reconnect: ForceTermination, and 707 (already in progress) is not an error', async () => {
  const { fake, box } = await connected();
  await box.reconnect();
  assert.equal(fake.connected, false);
  fake.faults['WANPPPConnection1#ForceTermination'] = 707;
  await box.reconnect();
  fake.faults['WANPPPConnection1#ForceTermination'] = 606;
  await assert.rejects(box.reconnect(), { kind: 'fault', code: 606 });
});

test('the phone books are merged', async () => {
  const { box } = await connected();
  const contacts = await box.readPhonebook();
  // Two books (ids 0 and 1), both served the fixture.
  assert.equal(contacts.length, 4);
  assert.deepEqual(contacts[0], { name: 'Oma & Opa', numbers: ['301234567', '491707654321'] });
});
