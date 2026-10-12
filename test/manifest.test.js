// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, OFFLINE_DELAYS, POLL_INTERVALS } from '../src/config.js';
import { SSDP_SEARCH_TARGET } from '../src/discovery.js';
import { TRIGGERS as CALL_TRIGGERS } from '../src/fritz/callmonitor.js';
import { MAX_GUEST_MINUTES, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { fixture } from './helpers/fakeFritz.js';
import { CONFIG, create, createWorld, discoveredBox, flush } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, local transport, network category', () => {
  assert.equal(manifest.name, 'FRITZ!Box');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-fritzbox:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-fritzbox/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network']);
});

test('the SSDP capture the code uses is declared, and nothing else', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'ssdp', st: SSDP_SEARCH_TARGET }]);
  assert.equal(manifest.network_wake, undefined);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions, mediated SSDP', () => {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  const [major, minor] = match.slice(1).map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await create(world, discoveredBox(world));
  const results = {
    enable_guest_wifi: await world.fake.sceneAction('enable_guest_wifi', { duration_minutes: 60 }),
    disable_guest_wifi: await world.fake.sceneAction('disable_guest_wifi', {}),
    reconnect_internet: await world.fake.sceneAction('reconnect_internet', { wait: true }),
  };
  for (const action of manifest.scene_actions) {
    assert.equal(results[action.key].success, true, action.key);
    assert.deepEqual(
      Object.keys(results[action.key].data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    // "Continue only if" compares with ===: numbers, never booleans.
    for (const output of action.outputs ?? []) {
      assert.notEqual(output.type, 'boolean', `${action.key}.${output.key}`);
    }
  }
  assert.equal(field(manifest.scene_actions[0].fields, 'duration_minutes').max, MAX_GUEST_MINUTES);
});

test('every scene trigger is fired by the code, with its filters and variables in the data', async (t) => {
  assert.deepEqual(
    keysOf(manifest.scene_triggers).sort(),
    [...Object.values(CALL_TRIGGERS), ...Object.values(TRIGGERS)].sort(),
  );
  const world = await createWorld({ config: { ...CONFIG, call_monitor: true } });
  t.after(() => world.app.stop());
  await flush();
  world.box.callLine(...fixture('callmonitor.txt').trim().split('\n'));
  world.box.connected = false;
  await world.hub.cycle();
  world.box.connected = true;
  world.box.externalIp = '203.0.113.99';
  await world.hub.cycle();
  await flush();
  for (const trigger of manifest.scene_triggers) {
    const fired = world.fake.sceneEvents.filter((event) => event.key === trigger.key);
    assert.ok(fired.length > 0, `${trigger.key} fired`);
    for (const event of fired) {
      for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
        assert.ok(key in event.data, `"${key}" is in the data of ${trigger.key}`);
      }
      for (const variable of trigger.variables) {
        assert.equal(
          typeof event.data[variable.key],
          variable.type,
          `${trigger.key}.${variable.key}`,
        );
      }
    }
  }
  const direction = field(field(manifest.scene_triggers, 'call_ended').fields, 'direction');
  assert.deepEqual(optionValues(direction), ['incoming', 'outgoing']);
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'poll_interval')), POLL_INTERVALS);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'offline_after')), OFFLINE_DELAYS);
  assert.equal(field(manifest.config_schema, 'password').type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.ok(dynamic.length >= 1);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('number fields have integer bounds (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('actions and scenes: no secret field, no default where the core applies none', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
    }
  }
  for (const item of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    for (const entry of item.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${item.key}.${entry.key}`);
    }
  }
  // A boolean has no "any" state: never a trigger filter.
  for (const trigger of manifest.scene_triggers) {
    for (const entry of trigger.fields ?? []) {
      assert.notEqual(entry.type, 'boolean', `${trigger.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
