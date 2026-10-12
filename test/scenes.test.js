import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesOf } from '../src/scenes.js';
import { create, createWorld, discoveredBox, featureId } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  const device = await create(w, discoveredBox(w));
  return { ...w, device };
}

test('enable_guest_wifi: on, with the name and password for the next steps', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('enable_guest_wifi', {});
  assert.deepEqual(ack, {
    success: true,
    data: { outputs: { ssid: 'FRITZ!Box Gastzugang', password: 'guest-1234-5678' } },
  });
  assert.equal(w.box.guestEnabled, true);
  assert.equal(w.fake.lastState(featureId(w.device, 'guest_wifi')), 1);
});

test('enable_guest_wifi for 90 minutes: off again after them, even after a restart', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('enable_guest_wifi', { duration_minutes: 90 });
  w.clock.advance(89 * 60_000);
  await w.hub.cycle();
  assert.equal(w.box.guestEnabled, true);
  // The integration restarts: the timer is in /data.
  await w.app.stop();
  const again = await createWorld({ fritz: w.box, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  again.clock.time = w.clock.time + 60_000;
  await again.hub.cycle();
  assert.equal(w.box.guestEnabled, false);
});

test('switching the guest Wi-Fi off by hand cancels the timer', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('enable_guest_wifi', { duration_minutes: '30' });
  assert.ok(w.hub.saved.guestOffAt);
  await w.fake.sceneAction('disable_guest_wifi', {});
  assert.equal(w.box.guestEnabled, false);
  assert.equal(w.hub.saved.guestOffAt, null);
  w.box.guestEnabled = true; // switched on from the box later
  w.clock.advance(31 * 60_000);
  await w.hub.cycle();
  assert.equal(w.box.guestEnabled, true, 'no stale timer switches it off');
});

test('reconnect_internet without waiting; waiting: connected with the new IP', async (t) => {
  const w = await world(t);
  assert.deepEqual(await w.fake.sceneAction('reconnect_internet', {}), {
    success: true,
    data: { outputs: {} },
  });
  w.box.connected = true;
  w.box.pendingReconnect = 0;
  const ack = await w.fake.sceneAction('reconnect_internet', { wait: true });
  assert.deepEqual(ack.data.outputs, { connected: 1, external_ip: '203.0.113.42', ip_changed: 1 });
  assert.equal(w.fake.lastState(featureId(w.device, 'internet')), 1);
});

test('reconnect_internet gives up at 100 s when the box stays offline', async (t) => {
  const w = await world(t);
  w.box.reconnectReads = 1000;
  const start = w.clock.now();
  const ack = await w.fake.sceneAction('reconnect_internet', { wait: 'true' });
  assert.deepEqual(ack.data.outputs, { connected: 0, external_ip: '', ip_changed: 0 });
  assert.ok(w.clock.now() - start >= 100_000 && w.clock.now() - start < 110_000);
});

test('scene actions fail cleanly without a guest Wi-Fi or a connection', async (t) => {
  const w = await createWorld({ config: { host: '192.0.2.1' } });
  t.after(() => w.app.stop());
  const ack = await w.fake.sceneAction('enable_guest_wifi', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas encore connectée/);
});

test('minutes: numbers, strings with a comma, bounds', () => {
  assert.equal(minutesOf(90), 90);
  assert.equal(minutesOf('7,6'), 8);
  assert.equal(minutesOf(''), 0);
  assert.equal(minutesOf(-5), 0);
  assert.equal(minutesOf(5000), 1440);
});
