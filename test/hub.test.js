// -----------------------------------------------------------------------------
// The hub through the full SDK wiring (src/app.js) on the SDK's fake Gladys
// and a simulated FRITZ!Box: connection, discovery, states, presence, scene
// events, guest Wi-Fi, reconnection, call monitor, failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATUS } from '../src/messages.js';
import { PASSWORD, USERNAME, createFakeFritz, fixture } from './helpers/fakeFritz.js';
import {
  CONFIG,
  create,
  createWorld,
  discovered,
  discoveredBox,
  events,
  featureId,
  flush,
} from './helpers/world.js';

async function worldWithBox(t, options = {}) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  const box = await create(world, discoveredBox(world));
  return { ...world, device: box };
}

const state = (world, device, key) => world.fake.lastState(featureId(device, key));
const lastText = (world, device, key) =>
  world.fake.states.filter((s) => s.device_feature_external_id === featureId(device, key)).at(-1)
    ?.text;

test('at start: connected, the box and the connected devices are proposed, nothing created', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['FRITZ!Box 7590', 'fritz.repeater', 'MacBook', 'raspberrypi'],
    'the box, then the active hosts by name (not the inactive someones-HUAWEI)',
  );
  const box = discoveredBox(world);
  assert.equal(box.model, 'FRITZ!Box 7530 AX');
  assert.equal(box.should_poll, false);
  assert.deepEqual(box.params, [
    { name: 'HOST', value: '192.0.2.1' },
    { name: 'FRITZ_OS', value: '256.08.00' },
  ]);
  assert.deepEqual(world.fake.states, []);
});

test('creating the box publishes all its states at once, the IP as text', async (t) => {
  const world = await worldWithBox(t);
  const { device } = world;
  assert.equal(state(world, device, 'internet'), 1);
  assert.equal(state(world, device, 'download'), 0.54);
  assert.equal(state(world, device, 'upload'), 0.03);
  assert.equal(state(world, device, 'max_download'), 319);
  assert.equal(state(world, device, 'max_upload'), 51.8);
  assert.equal(lastText(world, device, 'external_ip'), '203.0.113.17');
  assert.equal(state(world, device, 'connection_time'), 953);
  assert.equal(state(world, device, 'guest_wifi'), 0);
  assert.ok(world.fake.widgetRefreshes.includes('fritzbox'));
});

test('only changes are published', async (t) => {
  const world = await worldWithBox(t);
  const before = world.fake.states.length;
  await world.hub.cycle();
  assert.equal(world.fake.states.length, before, 'nothing moved');
  world.box.download = 1_250_000; // 10 Mbit/s
  world.box.uptime += 60;
  await world.hub.cycle();
  assert.equal(world.fake.states.length, before + 2);
  assert.equal(state(world, world.device, 'download'), 10);
});

test('internet lost then restored: the state, then internet_restored with the outage', async (t) => {
  const world = await worldWithBox(t);
  world.box.connected = false;
  await world.hub.cycle();
  assert.equal(state(world, world.device, 'internet'), 0);
  world.clock.advance(90_000);
  await world.hub.cycle();
  world.clock.advance(30_000);
  world.box.connected = true;
  await world.hub.cycle();
  assert.equal(state(world, world.device, 'internet'), 1);
  assert.deepEqual(events(world, 'internet_restored'), [
    { downtime_seconds: 120, external_ip: '203.0.113.17' },
  ]);
  assert.deepEqual(events(world, 'external_ip_changed'), []);
});

test('a new external IP fires external_ip_changed, also across a restart', async (t) => {
  const world = await worldWithBox(t);
  world.box.externalIp = '203.0.113.99';
  await world.hub.cycle();
  assert.deepEqual(events(world, 'external_ip_changed'), [
    { ip: '203.0.113.99', previous_ip: '203.0.113.17' },
  ]);
  await world.app.stop();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.lastIp, '203.0.113.99');
  const box = createFakeFritz();
  box.externalIp = '203.0.113.5';
  const again = await createWorld({ fritz: box, saved });
  t.after(() => again.app.stop());
  assert.deepEqual(events(again, 'external_ip_changed'), [
    { ip: '203.0.113.5', previous_ip: '203.0.113.99' },
  ]);
});

test('presence: away only after the delay; back at the first sighting', async (t) => {
  const world = await worldWithBox(t, { config: { ...CONFIG, offline_after: '180' } });
  const phone = await create(world, discovered(world, 'MacBook'));
  assert.equal(state(world, phone, 'presence'), 1);
  world.box.hostList = fixture('devicehostlist.xml').replace(
    /(<MACAddress>02:00:5E:10:00:54<\/MACAddress>\s*<Active>)1/,
    '$10',
  );
  world.clock.advance(120_000);
  await world.hub.cycle();
  assert.equal(state(world, phone, 'presence'), 1, 'still home after 2 minutes');
  world.clock.advance(60_000);
  await world.hub.cycle();
  assert.equal(state(world, phone, 'presence'), 0, 'away after 3 minutes');
  world.box.hostList = fixture('devicehostlist.xml');
  await world.hub.cycle();
  assert.equal(state(world, phone, 'presence'), 1);
});

test('a created device that is offline is proposed again, and shown away after the delay', async (t) => {
  const huawei = 'ext:test-integration:host:02005e100032';
  const world = await createWorld({
    config: { ...CONFIG, offline_after: '0' },
    devices: [
      {
        name: 'Phone of Alex',
        external_id: huawei,
        features: [{ external_id: `${huawei}:presence` }],
      },
    ],
  });
  t.after(() => world.app.stop());
  const names = world.fake.discoveredDevices.map((device) => device.name);
  assert.ok(names.includes('someones-HUAWEI'), 'the created one, though inactive');
  await world.hub.cycle();
  assert.equal(world.fake.lastState(`${huawei}:presence`), 0);
});

test('no credentials: not connected, the configuration says what to enter', async (t) => {
  const world = await createWorld({ config: { host: '192.0.2.1' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: STATUS_RENDER('credentials'),
  });
  assert.deepEqual(world.box.requests, []);
});

function STATUS_RENDER(key, params = {}) {
  return Object.fromEntries(
    Object.entries(STATUS).map(([lang, entries]) => [
      lang,
      typeof entries[key] === 'function' ? entries[key](params) : entries[key],
    ]),
  );
}

test('a wrong password: said once, then no login attempt for 15 minutes', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: STATUS_RENDER('auth'),
  });
  const failed = world.box.failedLogins;
  assert.equal(failed, 1);
  await world.hub.cycle();
  world.clock.advance(14 * 60_000);
  await world.hub.cycle();
  assert.equal(world.box.failedLogins, failed, 'no new attempt');
  world.clock.advance(2 * 60_000);
  await world.hub.cycle();
  assert.equal(world.box.failedLogins, failed + 1, 'one attempt after 15 minutes');
  // Fixed in the configuration: connected at once.
  await world.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the password changed on the box: the reads stop and the status says it', async (t) => {
  const world = await worldWithBox(t);
  world.box.users = { [USERNAME]: 'changed' };
  world.box.expireNonces();
  await world.hub.cycle();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.hub.box, null);
});

test('TR-064 disabled, unreachable box: explicit statuses; back when it answers', async (t) => {
  const off = await createWorld({ fritz: { tr064: false } });
  t.after(() => off.app.stop());
  assert.deepEqual(off.fake.connectionStatus, {
    connected: false,
    message: STATUS_RENDER('disabled'),
  });

  const world = await worldWithBox(t);
  world.box.reachable = false;
  await world.hub.cycle();
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: STATUS_RENDER('unreachable', { host: '192.0.2.1' }),
  });
  world.box.reachable = true;
  await world.hub.cycle();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('without the UPnP status: connected, with a hint, rates not published', async (t) => {
  const world = await worldWithBox(t, { fritz: { igd: false } });
  assert.deepEqual(world.fake.connectionStatus, {
    connected: true,
    message: STATUS_RENDER('noRates'),
  });
  assert.equal(state(world, world.device, 'download'), undefined);
  assert.equal(state(world, world.device, 'max_download'), 319);
});

test('a user without the settings right: degraded status, the rest keeps working', async (t) => {
  const world = await worldWithBox(t, { fritz: { denied: ['WLANConfiguration3#GetInfo'] } });
  assert.deepEqual(world.fake.connectionStatus, {
    connected: true,
    message: STATUS_RENDER('rights'),
  });
});

test('no address: the box is found by the network search and remembered', async (t) => {
  const world = await createWorld({ config: { username: USERNAME, password: PASSWORD } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    world.fake.scans.map((scan) => scan.type ?? scan),
    ['ssdp'],
  );
  await world.app.stop();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.address, '192.0.2.1');
  assert.equal(saved.boxId, '989bcb0a0b0c');
});

test('no address and no answer to the search: "not found"', async (t) => {
  const world = await createWorld({ config: { username: USERNAME, password: PASSWORD }, ssdp: [] });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: STATUS_RENDER('notFound'),
  });
});

test('the guest Wi-Fi switch of the device', async (t) => {
  const world = await worldWithBox(t);
  const ack = await world.fake.setValue(
    world.device,
    { external_id: featureId(world.device, 'guest_wifi') },
    1,
  );
  assert.equal(ack.success, true);
  assert.equal(world.box.guestEnabled, true);
  assert.equal(state(world, world.device, 'guest_wifi'), 1);
  // Switched off from the box itself: seen at the next read.
  world.box.guestEnabled = false;
  await world.hub.cycle();
  assert.equal(state(world, world.device, 'guest_wifi'), 0);
});

test('the reconnect button ends the connection', async (t) => {
  const world = await worldWithBox(t);
  const ack = await world.fake.setValue(
    world.device,
    { external_id: featureId(world.device, 'reconnect') },
    1,
  );
  assert.equal(ack.success, true);
  assert.equal(world.box.connected, false);
  assert.ok(
    world.box.actions.some((action) => action.key === 'WANPPPConnection1#ForceTermination'),
  );
});

test('a command on a device of another integration fails, in the configured language', async (t) => {
  const world = await worldWithBox(t);
  const ack = await world.fake.setValue(
    { external_id: 'ext:other:x' },
    { external_id: 'ext:other:x:y' },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'appartient pas/);
});

test('test_connection reports what the box says, in four languages', async (t) => {
  const world = await worldWithBox(t);
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'FRITZ!Box 7530 AX (FRITZ!OS 256.08.00) found at 192.0.2.1. Internet connected, external IP 203.0.113.17. Guest Wi-Fi: off. 3 network device(s) connected out of 4 known. Open the Discover tab to add the box and the devices to follow.',
  );
  assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
});

test('test_connection with a wrong password answers the reason, it does not throw', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message, STATUS_RENDER('auth'));
});

test('the scan button reads the hosts again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.box.hostList = fixture('devicehostlist.xml').replace(
    /<Active>0<\/Active>/,
    '<Active>1</Active>',
  );
  await world.fake.scanRequest();
  assert.ok(discovered(world, 'someones-HUAWEI'));
});

test('a reconnection to Gladys publishes the states again', async (t) => {
  const world = await worldWithBox(t);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.ok(world.fake.states.length >= before + 8);
});

test('call monitor: events with the names of the phone book, nothing without the option', async (t) => {
  const world = await worldWithBox(t, { config: { ...CONFIG, call_monitor: true } });
  await flush();
  assert.equal(world.box.sockets.length, 1);
  const lines = fixture('callmonitor.txt').trim().split('\n');
  world.box.callLine(...lines.slice(0, 8));
  await flush();
  assert.deepEqual(events(world, 'incoming_call'), [
    { number: '01707654321', line: '301234567', direction: 'incoming', name: 'Oma & Opa' },
    { number: '089123456', line: '301234567', direction: 'incoming', name: '089123456' },
    { number: '', line: '301234567', direction: 'incoming', name: 'Numéro masqué' },
  ]);
  assert.deepEqual(
    events(world, 'missed_call').map((data) => [data.name, data.answering_machine]),
    [
      ['089123456', 0],
      ['Numéro masqué', 1],
    ],
  );
  assert.equal(events(world, 'call_ended')[0].duration_seconds, 203);

  await world.fake.configUpdated({ ...CONFIG, call_monitor: false });
  await flush();
  assert.equal(world.box.sockets.length, 0);
});

test('call monitor switched off on the box: a hint in the status', async (t) => {
  const box = createFakeFritz();
  box.callMonitor = false;
  const world = await createWorld({ fritz: box, config: { ...CONFIG, call_monitor: true } });
  t.after(() => world.app.stop());
  await flush();
  await flush();
  assert.deepEqual(world.fake.connectionStatus, {
    connected: true,
    message: STATUS_RENDER('callRefused'),
  });
});

test('the logs never show the password, the phone numbers or the names', async (t) => {
  const lines = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...args) => lines.push(args.join(' '));
  process.env.LOG_LEVEL = 'debug';
  t.mock.method(process.stdout, 'write', (chunk) => {
    lines.push(String(chunk));
    return true;
  });
  t.mock.method(process.stderr, 'write', (chunk) => {
    lines.push(String(chunk));
    return true;
  });
  Object.assign(console, { log: capture, error: capture, warn: capture });
  try {
    const world = await createWorld({ config: { ...CONFIG, call_monitor: true } });
    await flush();
    world.box.callLine(...fixture('callmonitor.txt').trim().split('\n'));
    await flush();
    world.box.users = { [USERNAME]: 'changed' };
    world.box.expireNonces();
    await world.hub.cycle();
    await world.app.stop();
  } finally {
    Object.assign(console, original);
    process.env.LOG_LEVEL = 'silent';
  }
  const text = lines.join('\n');
  assert.ok(text.length > 0, 'something was logged');
  for (const secret of [PASSWORD, '01707654321', '089123456', 'Oma', 'guest-1234-5678']) {
    assert.ok(!text.includes(secret), `"${secret}" is in the logs`);
  }
});
