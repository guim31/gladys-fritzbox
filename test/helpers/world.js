// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated FRITZ!Box
// (test/helpers/fakeFritz.js), a manual clock, a temporary /data, and the
// integration wired on top through registerHandlers. Nothing touches the
// network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { PASSWORD, USERNAME, createFakeFritz } from './fakeFritz.js';

process.env.LOG_LEVEL ??= 'silent';

/** Raw answers of the core to the SSDP scan (anonymized addresses). */
export const SSDP_RESULTS = JSON.parse(
  readFileSync(new URL('../fixtures/fritz/ssdp-results.json', import.meta.url), 'utf8'),
);

export const CONFIG = { host: '192.0.2.1', username: USERNAME, password: PASSWORD };

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Lets pending callbacks (sockets, fire-and-forget promises) run. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (CONFIG by default)
 * @param {object} [options.fritz] options of createFakeFritz, or a box
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/state.json before the start
 * @param {Array|null} [options.ssdp] raw SSDP results, null: no capture declared
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  config = CONFIG,
  fritz = {},
  devices = [],
  saved,
  ssdp = SSDP_RESULTS,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-fritzbox-')),
} = {}) {
  const box = typeof fritz.request === 'function' ? fritz : createFakeFritz(fritz);
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: ssdp === null ? {} : { ssdp },
  });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const clock = createClock();
  const app = registerHandlers(gladys, {
    store,
    request: box.request,
    connectSocket: box.connectSocket,
    timers: false,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.hub.running;
  }
  return { gladys, fake: gladys.fake, app, hub: app.hub, box, clock, store, dataDir };
}

/** The device published under a name, from the last discovery list. */
export const discovered = (world, name) =>
  world.fake.discoveredDevices.find((device) => device.name === name);

/** The box device of the last discovery list. */
export const discoveredBox = (world) =>
  world.fake.discoveredDevices.find((device) => device.external_id.includes(':box:'));

/** Create a discovered device in Gladys, as the user would. */
export async function create(world, device) {
  if (!device) {
    throw new Error('No such discovered device');
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Scene events fired with a key. */
export const events = (world, key) =>
  world.fake.sceneEvents.filter((event) => event.key === key).map((event) => event.data);
