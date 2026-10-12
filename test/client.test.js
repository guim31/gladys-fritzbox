import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tr064Client, faultCode, parseDescription, parseServices } from '../src/fritz/client.js';
import { PASSWORD, USERNAME, createFakeFritz, fixture } from './helpers/fakeFritz.js';

const client = (box, options = {}) =>
  new Tr064Client({
    host: box.host,
    username: USERNAME,
    password: PASSWORD,
    request: box.request,
    ...options,
  });

test('the services of the real descriptions are named like fritzconnection names them', () => {
  const tr64 = parseServices(fixture('tr64desc.xml'));
  assert.deepEqual(tr64.get('DeviceInfo1'), {
    type: 'urn:dslforum-org:service:DeviceInfo:1',
    controlUrl: '/upnp/control/deviceinfo',
  });
  assert.ok(tr64.has('WLANConfiguration3'));
  assert.ok(tr64.has('WANPPPConnection1'));
  assert.equal(tr64.get('Hosts1').controlUrl, '/upnp/control/hosts');
  const igd = parseServices(fixture('igddesc.xml'));
  assert.equal(igd.get('WANCommonIFC1').controlUrl, '/igdupnp/control/WANCommonIFC1');
  assert.deepEqual(parseDescription(fixture('tr64desc.xml')), {
    friendlyName: 'FRITZ!Box 7590',
    modelName: 'FRITZ!Box 7590',
    udn: 'uuid:739f2409-bccb-40e7-8e6c-989BCB0A0B0C',
    firmware: '154.07.10',
  });
});

test('a SOAP action answers after the Digest challenge, and reuses it', async () => {
  const box = createFakeFritz();
  const tr064 = client(box);
  await tr064.loadDescriptions();
  assert.equal(tr064.igd, true);
  const info = await tr064.call('DeviceInfo1', 'GetInfo');
  assert.equal(info.NewSerialNumber, '989BCB0A0B0C');
  assert.equal(info.NewModelName, 'FRITZ!Box 7530 AX');
  const posts = () => box.requests.filter((request) => request.method === 'POST');
  assert.equal(posts().length, 2, 'one 401, then the authenticated request');
  assert.equal(posts()[0].headers.authorization, undefined);
  assert.equal(posts()[1].headers.soapaction, 'urn:dslforum-org:service:DeviceInfo:1#GetInfo');
  await tr064.call('DeviceInfo1', 'GetInfo');
  assert.equal(posts().length, 3, 'the next action goes through at once (nc = 2)');
  assert.match(posts()[2].headers.authorization, /nc=00000002/);
});

test('an expired nonce costs one more request, not an error', async () => {
  const box = createFakeFritz();
  const tr064 = client(box);
  await tr064.loadDescriptions();
  await tr064.call('DeviceInfo1', 'GetInfo');
  box.expireNonces();
  const info = await tr064.call('Layer3Forwarding1', 'GetDefaultConnectionService');
  assert.equal(info.NewDefaultConnectionService, '1.WANPPPConnection.1');
});

test('a wrong password is an auth error after two requests only', async () => {
  const box = createFakeFritz();
  const tr064 = client(box, { password: 'wrong' });
  await tr064.loadDescriptions();
  await assert.rejects(tr064.call('DeviceInfo1', 'GetInfo'), { kind: 'auth' });
  assert.equal(box.requests.filter((request) => request.method === 'POST').length, 2);
  assert.equal(box.failedLogins, 1);
});

test('booleans are sent as 1/0, and the UPnP IGD answers in one request', async () => {
  const box = createFakeFritz();
  const tr064 = client(box);
  await tr064.loadDescriptions();
  await tr064.call('WLANConfiguration3', 'SetEnable', { NewEnable: true });
  assert.equal(box.guestEnabled, true);
  const before = box.requests.length;
  const rates = await tr064.call('WANCommonIFC1', 'GetAddonInfos');
  assert.equal(rates.NewByteReceiveRate, '67649');
  assert.equal(box.requests.length, before + 1);
});

test('faults, missing services, a disabled TR-064 and an unreachable box', async () => {
  const box = createFakeFritz({ denied: ['DeviceInfo1#GetInfo'] });
  const tr064 = client(box);
  await tr064.loadDescriptions();
  await assert.rejects(tr064.call('DeviceInfo1', 'GetInfo'), { kind: 'fault', code: 606 });
  await assert.rejects(tr064.call('DeviceInfo1', 'NoSuchAction'), { kind: 'fault', code: 401 });
  await assert.rejects(tr064.call('Nope1', 'GetInfo'), { kind: 'service' });
  assert.equal(faultCode('<errorCode> 714 </errorCode>'), 714);

  const off = createFakeFritz({ tr064: false });
  await assert.rejects(client(off).loadDescriptions(), { kind: 'disabled' });
  const gone = createFakeFritz();
  gone.reachable = false;
  await assert.rejects(client(gone).loadDescriptions(), { kind: 'unreachable' });
});

test('without the UPnP status, only the TR-064 services are known', async () => {
  const box = createFakeFritz({ igd: false });
  const tr064 = client(box);
  await tr064.loadDescriptions();
  assert.equal(tr064.igd, false);
  assert.equal(tr064.has('WANCommonIFC1'), false);
  assert.equal(tr064.has('WANCommonInterfaceConfig1'), true);
});

test('a linked document is read from the configured address, not the name in the link', async () => {
  const box = createFakeFritz();
  const tr064 = client(box);
  const xml = await tr064.fetchText(
    'http://fritz.box:49000/phonebook.lua?sid=0123456789abcdef&pbid=0',
  );
  assert.match(xml, /<phonebooks>/);
  assert.equal(box.requests.at(-1).path, '/phonebook.lua?sid=0123456789abcdef&pbid=0');
  await assert.rejects(tr064.fetchText('/devicehostlist.lua'), { kind: 'http', status: 403 });
});

test('the base URL follows the protocol, the port and IPv6', () => {
  assert.equal(new Tr064Client({ host: '192.0.2.1' }).base, 'http://192.0.2.1:49000');
  assert.equal(new Tr064Client({ host: 'fritz.box', https: true }).base, 'https://fritz.box:49443');
  assert.equal(new Tr064Client({ host: 'fd00::1' }).base, 'http://[fd00::1]:49000');
});
