import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TEXT, formatDuration } from '../src/widgets.js';
import { CONFIG, create, createWorld, discovered, discoveredBox } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('before the box is added: computed tiles, status, guest and reconnect buttons', async (t) => {
  const w = await world(t);
  const content = (await w.fake.widgetGet('fritzbox', { language: 'en' })).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(content.components[0], {
    type: 'value',
    label: 'Download',
    icon: 'arrow-down',
    value: 0.54,
    unit: 'Mbit/s',
  });
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Internet', 'Connected · 15 h 53 min'],
      ['Guest Wi-Fi', 'Off'],
    ],
  );
  const buttons = content.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => [button.label, button.action]),
    [
      ['Turn on guest Wi-Fi', { key: 'guest_wifi', params: { enable: true } }],
      ['Reconnect internet', { key: 'reconnect', confirm: true }],
    ],
  );
  assert.ok(!JSON.stringify(content).includes('203.0.113.17'), 'no public IP on a dashboard');
});

test('with the box and two devices: live tiles bound to existing features, who is home', async (t) => {
  const w = await world(t);
  const box = await create(w, discoveredBox(w));
  await create(w, discovered(w, 'MacBook'));
  await create(w, discovered(w, 'raspberrypi'));
  const content = (await w.fake.widgetGet('fritzbox', { language: 'fr' })).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((component) => component.type === 'value');
  const featureIds = new Set(box.features.map((feature) => feature.external_id));
  assert.ok(featureIds.has(tiles[0].device_feature) && featureIds.has(tiles[1].device_feature));
  assert.deepEqual(tiles[2], {
    type: 'value',
    value: '2 / 2',
    label: 'À la maison',
    icon: 'users',
  });
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.slice(2).map((item) => [item.label, item.value]),
    [
      ['MacBook', 'Présent'],
      ['raspberrypi', 'Présent'],
    ],
  );
  assert.ok(!JSON.stringify(content).match(/02:00:5e/i), 'no MAC address');
});

test('the settings choose the devices shown', async (t) => {
  const w = await world(t);
  await create(w, discovered(w, 'MacBook'));
  const pi = await create(w, discovered(w, 'raspberrypi'));
  const settings = { devices: [pi.external_id, 'ext:other:x'] };
  const content = (await w.fake.widgetGet('fritzbox', { settings, language: 'de' })).data.content;
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.slice(2).map((item) => item.label),
    ['raspberrypi'],
  );
});

test('the guest button switches it, with a toast; the timer shows the time left', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction('fritzbox', 'guest_wifi', { enable: true });
  assert.deepEqual(ack.data.message, TEXT.turnedOn);
  assert.equal(w.box.guestEnabled, true);
  await w.fake.sceneAction('enable_guest_wifi', { duration_minutes: 120 });
  w.clock.advance(30 * 60_000);
  const content = (await w.fake.widgetGet('fritzbox', { language: 'en' })).data.content;
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items[1].value, 'On · 1 h 30 min left');
  const button = content.components.find((component) => component.type === 'button');
  assert.equal(button.label, 'Turn off guest Wi-Fi');
  const off = await w.fake.widgetAction('fritzbox', 'guest_wifi', { enable: false });
  assert.deepEqual(off.data.message, TEXT.turnedOff);
  assert.equal(w.box.guestEnabled, false);
});

test('the reconnect button asks first, then reconnects', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction('fritzbox', 'reconnect', {});
  assert.deepEqual(ack.data.message, TEXT.reconnecting);
  assert.equal(w.box.connected, false);
});

test('not connected: one text says so', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' } });
  const content = (await w.fake.widgetGet('fritzbox', { language: 'es' })).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(content.components, [
    { type: 'text', variant: 'body', text: TEXT.notConnected.es },
  ]);
});

test('at most 10 status rows with many devices, within the core budget', async (t) => {
  const items = Array.from({ length: 12 }, (_, i) => {
    const hex = (i + 1).toString(16).padStart(2, '0');
    return `<Item><MACAddress>02:00:5E:10:01:${hex}</MACAddress><IPAddress>192.0.2.${100 + i}</IPAddress><Active>1</Active><HostName>Phone ${i + 1}</HostName></Item>`;
  });
  const w = await world(t, { fritz: { hostList: `<List>${items.join('')}</List>` } });
  for (let i = 1; i <= 12; i += 1) {
    await create(w, discovered(w, `Phone ${i}`));
  }
  const content = (await w.fake.widgetGet('fritzbox')).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 10);
});

test('durations: two units at most, in the four languages', () => {
  assert.equal(formatDuration(57199, 'en'), '15 h 53 min');
  assert.equal(formatDuration(200000, 'fr'), '2 j 7 h');
  assert.equal(formatDuration(200000, 'de'), '2 T 7 h');
  assert.equal(formatDuration(59, 'es'), '0 min');
});
