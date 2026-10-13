// -----------------------------------------------------------------------------
// The hub: the connection to the FRITZ!Box, the read cycle, the states
// published to Gladys, the scene events and the commands. Everything the SDK
// handlers, the scene actions and the widget need goes through it (src/app.js
// wires it).
//
// Scheduling: the devices are published with should_poll: false and the hub
// reads the box at the configured interval. States: `publishChangedStates`
// sends only what changed, plus a heartbeat every 12 hours so that a stable
// value never shows "no recent value" (the front's default is 48 hours).
//
// Authentication failures stop the reads for 15 minutes: the FRITZ!Box
// blocks logins for a growing time after failed attempts, retrying at every
// cycle would lock the user out of the box.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { FritzBox } from './fritz/box.js';
import { CallMonitor, CallTracker } from './fritz/callmonitor.js';
import { createLookup } from './fritz/phonebook.js';
import { ProblemLog } from './problems.js';
import {
  boxIds,
  boxIdOfDevice,
  buildBoxDevice,
  buildHostDevice,
  hostIds,
  macOf,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, boxCandidates } from './discovery.js';
import { ERRORS, HIDDEN_NUMBER, REPORTS, STATUS, join, render } from './messages.js';

const logger = createLogger({ name: 'fritzbox' });

export const WIDGET_KEY = 'fritzbox';
export const TRIGGERS = {
  INTERNET_RESTORED: 'internet_restored',
  EXTERNAL_IP_CHANGED: 'external_ip_changed',
};

export const DEFAULT_TIMINGS = {
  heartbeatMs: 12 * 60 * 60 * 1000,
  authRetryMs: 15 * 60 * 1000,
  phonebookMs: 6 * 60 * 60 * 1000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
  reconnectCheckMs: 5000,
};

// Network devices proposed in the Discover tab: the created ones and the
// connected ones, never the hundreds the box has seen over the years.
export const MAX_DISCOVERED_HOSTS = 100;
// The core waits 120 s at most for a scene action.
export const RECONNECT_WAIT_CAP_SECONDS = 100;
export const MAX_GUEST_MINUTES = 1440;
const FALLBACK_HOST = 'fritz.box';

export class GladysError extends Error {
  /** An error whose message is a multi-language object (shown in Gladys). */
  constructor(message, language = 'en') {
    super(message[language] ?? message.en);
    this.messages = message;
  }
}

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.request] HTTP seam of the TR-064 client (tests)
   * @param {Function} [options.connectSocket] TCP seam of the call monitor (tests)
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {Function} [options.sleep] `(ms) => Promise`
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, request, connectSocket, timers = true, now, sleep, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.connectSocket = connectSocket;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.saved = {};
    this.box = null;
    this.problem = null;
    // Failures repeated at every cycle are logged when they start and end.
    this.problems = new ProblemLog(logger);
    this.announced = false;
    this.warnings = new Set();
    this.lastStatusSent = null;
    this.authBlockedUntil = 0;
    this.status = null;
    this.guest = null;
    this.hosts = new Map();
    this.presence = new Map();
    this.startedAt = this.now();
    this.downSince = null;
    this.cycleTimer = null;
    this.guestTimer = null;
    this.refreshTimer = null;
    this.lastRefreshAt = -Infinity;
    this.running = null;
    this.callMonitor = null;
    this.tracker = new CallTracker({ now: () => this.now() });
    this.lookup = () => null;
    this.phonebookAt = -Infinity;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    this.saved = await this.store.load();
    await this.connectBox();
    await this.refreshHosts().catch(() => {});
    await this.publishDiscovered();
    await this.sendStatus();
    this.schedule();
    this.startCallMonitor();
    this.runCycle();
  }

  /** Reconnection to Gladys (it may have restarted): publish everything again. */
  async resync(config) {
    this.config = config;
    this.lastStatusSent = null;
    await this.publishDiscovered();
    await this.sendStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates();
    this.requestRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const access = (c) => [c.host, c.username, c.password, c.https].join('\u0000');
    if (!previous || access(previous) !== access(config)) {
      this.box = null;
      this.announced = false;
      this.authBlockedUntil = 0;
      await this.connectBox();
      await this.refreshHosts().catch(() => {});
    }
    // The language of the feature names applies to the devices created from now on.
    await this.publishDiscovered();
    await this.sendStatus();
    this.schedule();
    this.stopCallMonitor();
    this.startCallMonitor();
    this.requestRefresh();
    this.runCycle();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.guestTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    this.stopCallMonitor();
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.pollInterval * 1000);
    this.cycleTimer.unref?.();
    this.scheduleGuestOff();
  }

  save(changes) {
    this.saved = { ...this.saved, ...changes, version: 1 };
    return this.store.save(this.saved);
  }

  // --- Connection to the box -------------------------------------------------

  /**
   * Connect to the box: the configured address, else the one found earlier,
   * else a network search, else `fritz.box`. Resolves true once connected.
   */
  async connectBox() {
    const { config } = this;
    if (!config.username || !config.password) {
      this.box = null;
      this.problem = 'credentials';
      return false;
    }
    if (this.now() < this.authBlockedUntil) {
      return false;
    }
    // The address found earlier is tried before searching the network again
    // (a search takes seconds, and the core allows one every 10 s).
    const candidates = config.host ? [config.host] : [this.saved.address].filter(Boolean);
    let { box, error: lastError } = await this.tryHosts(candidates);
    let hosts = candidates;
    if (!box && !config.host && (!lastError || lastError.kind === 'unreachable')) {
      const found = (await this.searchBoxes()).map((candidate) => candidate.address);
      hosts = [...new Set([...found, FALLBACK_HOST])].filter((host) => !candidates.includes(host));
      ({ box, error: lastError } = await this.tryHosts(hosts, lastError));
      hosts = [...candidates, ...hosts];
    }
    if (box) {
      if (!box.info.id) {
        box.info.id = this.saved.boxId ?? 'fritzbox';
      }
      this.box = box;
      this.problem = null;
      this.authBlockedUntil = 0;
      this.updateRateWarning();
      if (!config.host || this.saved.boxId !== box.info.id) {
        await this.save({
          address: config.host ? this.saved.address : box.host,
          boxId: box.info.id,
        });
      }
      // Said at the start and when the box is back, not at every reconnection.
      const lost = [this.problems.recover('connect'), this.problems.recover('read')].some(Boolean);
      const line = `Connected to ${box.info.model} (FRITZ!OS ${box.info.firmware ?? '?'})`;
      if (lost || !this.announced) {
        logger.info(line);
      } else {
        logger.debug(line);
      }
      this.announced = true;
      return true;
    }
    this.box = null;
    this.problem = this.problemOf(lastError, hosts);
    if (this.problem === 'auth') {
      this.authBlockedUntil = this.now() + this.timings.authRetryMs;
    }
    this.problems.fail(
      'connect',
      `Cannot connect to the FRITZ!Box: ${lastError?.message ?? 'no address'}`,
    );
    return false;
  }

  /** The first host that answers as a FRITZ!Box; stops at an error other than silence. */
  async tryHosts(hosts, previousError = null) {
    let error = previousError;
    for (const host of hosts) {
      const box = new FritzBox({
        host,
        https: this.config.https,
        username: this.config.username,
        password: this.config.password,
        request: this.request,
      });
      try {
        await box.connect();
        return { box, error: null };
      } catch (err) {
        error = err;
        if (err.kind !== 'unreachable') {
          break;
        }
      }
    }
    return { box: null, error };
  }

  /** Boxes found by the core's SSDP search ([] when the search is unavailable). */
  async searchBoxes() {
    try {
      const results = await this.gladys.scanNetwork('ssdp', {
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      this.problems.recover('search');
      return boxCandidates(results);
    } catch (err) {
      this.problems.fail('search', `Network search unavailable: ${err.message}`);
      return [];
    }
  }

  problemOf(err, hosts) {
    switch (err?.kind) {
      case 'auth':
        return 'auth';
      case 'disabled':
        return 'disabled';
      case 'unreachable':
        return this.config.host ? 'unreachable' : 'notFound';
      case 'fault':
        return err.code === 606 ? 'rights' : 'unreachable';
      default:
        return hosts.length === 0 ? 'notFound' : 'unreachable';
    }
  }

  updateRateWarning() {
    const caps = this.box?.capabilities;
    if (caps?.wan && !caps.rates) {
      this.warnings.add('noRates');
    } else {
      this.warnings.delete('noRates');
    }
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async sendStatus() {
    const host = this.box?.host ?? this.config.host ?? FALLBACK_HOST;
    let connected = this.problem === null && this.box !== null;
    let message;
    if (this.problem) {
      message = render(STATUS, this.problem, { host });
      // A missing right is a degraded state, not a disconnection.
      connected = this.problem === 'rights' && this.box !== null;
    } else {
      const warning = ['rights', 'callRefused', 'callLost', 'noRates'].find((key) =>
        this.warnings.has(key),
      );
      message = warning ? render(STATUS, warning, { host }) : undefined;
    }
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatusSent) {
      return;
    }
    this.lastStatusSent = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  /** A failed read: stop on a refused login, note the rest. */
  async noteFailure(err) {
    if (err.kind === 'auth') {
      this.box = null;
      this.problem = 'auth';
      this.authBlockedUntil = this.now() + this.timings.authRetryMs;
    } else if (err.kind === 'unreachable') {
      this.problem = this.config.host ? 'unreachable' : 'notFound';
      if (!this.config.host) {
        // The address found earlier may be stale: search again next time.
        this.box = null;
      }
    } else if (err.kind === 'fault' && err.code === 606) {
      this.warnings.add('rights');
    }
    this.problems.fail('read', `Reading the FRITZ!Box failed: ${err.message}`);
    await this.sendStatus();
  }

  requireBox() {
    if (!this.box) {
      throw new GladysError(render(ERRORS, 'notConnected'), this.config.language);
    }
    return this.box;
  }

  // --- Discovery ---------------------------------------------------------------

  createdDevices() {
    return this.gladys.devices ?? [];
  }

  isCreated(externalId) {
    return this.createdDevices().some((device) => device.external_id === externalId);
  }

  /** MAC addresses of the network devices created in Gladys. */
  createdMacs() {
    return this.createdDevices()
      .map((device) => macOf(this.gladys, device.external_id))
      .filter(Boolean);
  }

  boxDeviceId() {
    return this.box ? boxIds(this.gladys, this.box.info.id).device : null;
  }

  discoveredDevices() {
    const language = this.config.language;
    const devices = [];
    if (this.box) {
      const box = buildBoxDevice(
        this.gladys,
        this.box.info,
        this.box.capabilities,
        this.box.host,
        language,
      );
      // A box used as a repeater, without guest Wi-Fi, has nothing to show.
      if (box.features.length > 0) {
        devices.push(box);
      }
    }
    const created = new Set(this.createdMacs());
    const hosts = [];
    for (const mac of created) {
      const known = this.hosts.get(mac);
      const device = this.createdDevices().find(
        (entry) => entry.external_id === hostIds(this.gladys, mac).device,
      );
      hosts.push(known ?? { mac, name: device?.name ?? mac, ip: null });
    }
    const active = [...this.hosts.values()]
      .filter((host) => host.active && !created.has(host.mac))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    hosts.push(...active);
    devices.push(
      ...hosts
        .slice(0, MAX_DISCOVERED_HOSTS)
        .map((host) => buildHostDevice(this.gladys, host, language)),
    );
    return devices;
  }

  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  /** Read the host list of the box (keeps the last one on failure). */
  async refreshHosts() {
    if (!this.box) {
      return;
    }
    const hosts = await this.box.readHosts();
    this.hosts = new Map(hosts.map((host) => [host.mac, host]));
  }

  async scan() {
    if (!this.box) {
      await this.connectBox();
      await this.sendStatus();
    }
    try {
      await this.refreshHosts();
    } catch (err) {
      await this.noteFailure(err);
    }
    await this.publishDiscovered();
  }

  // --- The read cycle ------------------------------------------------------------

  runCycle() {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle()
      .then(() => this.problems.recover('cycle'))
      .catch((err) => {
        if (this.problems.fail('cycle', `Read cycle failed: ${err.message}`, 'error')) {
          logger.debug('Read cycle failed', err);
        }
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle() {
    if (!this.box) {
      const wasProblem = this.problem;
      if (!(await this.connectBox())) {
        await this.sendStatus();
        return;
      }
      if (wasProblem !== null) {
        await this.refreshHosts().catch(() => {});
        await this.publishDiscovered();
      }
    }
    const box = this.box;
    // A part the box refuses (a missing right, an unknown action) leaves the
    // others alone; a refused login or a silent box stops the cycle.
    const part = async (key, fn) => {
      try {
        await fn();
        this.problems.recover(`part:${key}`);
        return true;
      } catch (err) {
        if (err.kind === 'auth' || err.kind === 'unreachable') {
          throw err;
        }
        if (err.kind === 'fault' && err.code === 606) {
          this.warnings.add('rights');
        }
        // A missing right fails again at every cycle until the user fixes it.
        this.problems.fail(`part:${key}`, `Reading the FRITZ!Box: ${err.message}`);
        return false;
      }
    };
    // Missing rights are noticed again at every cycle (the user may fix them).
    this.warnings.delete('rights');
    try {
      await part('status', async () => this.applyStatus(await box.readStatus()));
      await part('guest', async () => this.applyGuest(await box.readGuestWifi()));
      if (this.createdMacs().length > 0) {
        await part('hosts', async () => {
          await this.refreshHosts();
          this.updatePresence();
        });
      }
      this.problem = null;
      this.problems.recover('read', 'Reading the FRITZ!Box works again');
    } catch (err) {
      await this.noteFailure(err);
      return;
    }
    await this.checkGuestTimer();
    await this.sendStatus();
    await this.publishStates();
  }

  /** Fold a status read in; fires the internet scene events. */
  applyStatus(status) {
    const previous = this.status;
    this.status = status;
    if (status.connected === false && previous?.connected !== false) {
      this.downSince = this.now();
    }
    if (status.connected === true && previous?.connected === false) {
      const downtime = Math.round((this.now() - (this.downSince ?? this.now())) / 1000);
      this.fire(TRIGGERS.INTERNET_RESTORED, {
        downtime_seconds: downtime,
        external_ip: status.externalIp ?? '',
      });
      this.downSince = null;
    }
    if (status.externalIp) {
      const last = this.saved.lastIp;
      if (last && last !== status.externalIp) {
        this.fire(TRIGGERS.EXTERNAL_IP_CHANGED, { ip: status.externalIp, previous_ip: last });
      }
      if (last !== status.externalIp) {
        this.save({ lastIp: status.externalIp });
      }
    }
    if (previous?.connected !== status.connected) {
      this.requestRefresh();
    }
  }

  applyGuest(guest) {
    if (guest && this.guest?.enabled !== guest.enabled) {
      this.requestRefresh();
      if (!guest.enabled && this.saved.guestOffAt) {
        // Switched off elsewhere (the box, its app): no timer to keep.
        this.save({ guestOffAt: null });
      }
    }
    this.guest = guest;
  }

  /** Presence of the created network devices, with the delay before "away". */
  updatePresence() {
    const now = this.now();
    const delay = this.config.offlineAfter * 1000;
    for (const mac of this.createdMacs()) {
      const entry = this.presence.get(mac) ?? { online: null, lastSeen: null };
      const before = entry.online;
      if (this.hosts.get(mac)?.active) {
        entry.online = true;
        entry.lastSeen = now;
      } else if (now - (entry.lastSeen ?? this.startedAt) >= delay) {
        entry.online = false;
      }
      this.presence.set(mac, entry);
      if (before !== entry.online) {
        this.requestRefresh();
      }
    }
  }

  /** The states of every created device, published when they changed. */
  async publishStates() {
    const states = [];
    const add = (externalId, value) => {
      if (
        value === null ||
        value === undefined ||
        !this.isCreated(externalId.split(':').slice(0, -1).join(':'))
      ) {
        return;
      }
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    };
    if (this.box) {
      const ids = boxIds(this.gladys, this.box.info.id);
      const status = this.status;
      if (status && this.box.capabilities.wan) {
        add(ids.internet, status.connected === null ? null : status.connected ? 1 : 0);
        add(ids.download, status.download);
        add(ids.upload, status.upload);
        add(ids.max_download, status.maxDownload);
        add(ids.max_upload, status.maxUpload);
        add(ids.external_ip, status.externalIp);
        add(ids.connection_time, status.uptime === null ? null : Math.floor(status.uptime / 60));
      }
      if (this.guest && this.box.capabilities.guestWifi) {
        add(ids.guest_wifi, this.guest.enabled ? 1 : 0);
      }
    }
    for (const [mac, entry] of this.presence) {
      if (entry.online !== null) {
        add(hostIds(this.gladys, mac).presence, entry.online ? 1 : 0);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('publish', 'Gladys accepts the states again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.problems.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  fire(key, data) {
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
  }

  // --- Gladys events -----------------------------------------------------------

  async onDeviceCreated(device) {
    const mac = macOf(this.gladys, device.external_id);
    if (mac) {
      await this.refreshHosts().catch(() => {});
      this.updatePresence();
    } else if (boxIdOfDevice(this.gladys, device.external_id) && this.box && !this.status) {
      await this.runCycle();
    }
    // The SDK forgot the states of this device: everything is published again.
    await this.publishStates();
    this.requestRefresh();
  }

  async setValue(device, feature, value) {
    const ids = this.box ? boxIds(this.gladys, this.box.info.id) : null;
    if (!ids || device.external_id !== ids.device) {
      throw new GladysError(render(ERRORS, 'unknownDevice'), this.config.language);
    }
    if (feature.external_id === ids.guest_wifi) {
      await this.setGuestWifi(Number(value) === 1);
      return;
    }
    if (feature.external_id === ids.reconnect) {
      await this.reconnect();
      return;
    }
    throw new GladysError(render(ERRORS, 'unknownDevice'), this.config.language);
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll() {
    await this.runCycle();
  }

  // --- Commands ------------------------------------------------------------------

  async command(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GladysError) {
        throw err;
      }
      if (err.kind === 'service') {
        throw err;
      }
      if (err.kind === 'auth' || err.kind === 'unreachable') {
        await this.noteFailure(err);
      }
      const reason = err.kind === 'fault' ? `UPnP ${err.code}` : (err.kind ?? err.message);
      throw new GladysError(render(ERRORS, 'failed', { reason }), this.config.language);
    }
  }

  /**
   * Switch the guest Wi-Fi; `minutes` (when switching on) switches it off
   * again after that delay, kept across restarts.
   */
  async setGuestWifi(enabled, { minutes = 0 } = {}) {
    const box = this.requireBox();
    if (!box.capabilities.guestWifi) {
      throw new GladysError(render(ERRORS, 'noGuestWifi'), this.config.language);
    }
    await this.command(() => box.setGuestWifi(enabled));
    const offAt =
      enabled && minutes > 0 ? this.now() + Math.min(minutes, MAX_GUEST_MINUTES) * 60 * 1000 : null;
    await this.save({ guestOffAt: offAt });
    this.scheduleGuestOff();
    this.guest = { ...(this.guest ?? { ssid: null }), enabled };
    this.requestRefresh();
    await this.publishStates();
    return this.guest;
  }

  async guestWifiDetails() {
    const box = this.requireBox();
    return this.command(async () => {
      const guest = (await box.readGuestWifi()) ?? { ssid: null };
      const password = await box.guestWifiPassword();
      return { ssid: guest.ssid ?? '', password };
    });
  }

  scheduleGuestOff() {
    clearTimeout(this.guestTimer);
    this.guestTimer = null;
    const offAt = this.saved.guestOffAt;
    if (!this.timers || this.stopped || !offAt) {
      return;
    }
    // setTimeout holds 24.8 days at most; the cycle checks too.
    this.guestTimer = setTimeout(
      () => this.checkGuestTimer().catch(() => {}),
      Math.min(Math.max(0, offAt - this.now()), 2 ** 31 - 1),
    );
    this.guestTimer.unref?.();
  }

  async checkGuestTimer() {
    const offAt = this.saved.guestOffAt;
    if (!offAt || this.now() < offAt || !this.box) {
      return;
    }
    logger.info('Guest Wi-Fi timer over: switching it off');
    try {
      await this.setGuestWifi(false);
    } catch (err) {
      logger.warn(`Switching the guest Wi-Fi off failed: ${err.message}`);
    }
  }

  /**
   * Reconnect the internet connection. With `waitMs`, wait until the box is
   * connected again (or that delay) and resolve the result.
   */
  async reconnect({ waitMs = 0 } = {}) {
    const box = this.requireBox();
    if (!box.capabilities.wan) {
      throw new GladysError(render(ERRORS, 'noWan'), this.config.language);
    }
    const before = this.status?.externalIp ?? null;
    const start = this.now();
    await this.command(() => box.reconnect());
    logger.info('Internet reconnection requested');
    if (waitMs <= 0) {
      return null;
    }
    const deadline = this.now() + waitMs;
    let sawDown = false;
    let status = null;
    while (this.now() < deadline) {
      await this.sleep(this.timings.reconnectCheckMs);
      try {
        status = await box.readStatus();
      } catch {
        continue;
      }
      if (status.connected === false) {
        sawDown = true;
      }
      // Connected again: after a visible drop, on a new address, or on a fresh
      // connection (the uptime restarted).
      if (
        status.connected &&
        (sawDown ||
          (status.externalIp && status.externalIp !== before) ||
          (status.uptime !== null && status.uptime <= (this.now() - start) / 1000 + 5))
      ) {
        break;
      }
    }
    if (status) {
      this.applyStatus(status);
      await this.publishStates();
    }
    const connected = Boolean(status?.connected);
    const ip = status?.externalIp ?? '';
    return {
      connected,
      externalIp: ip,
      ipChanged: Boolean(connected && before && ip && ip !== before),
    };
  }

  /** The "Test the connection" report. */
  async testConnection() {
    if (!this.box) {
      this.authBlockedUntil = 0;
      await this.connectBox();
      await this.sendStatus();
    }
    if (!this.box) {
      throw new GladysError(
        render(STATUS, this.problem ?? 'notFound', { host: this.config.host || FALLBACK_HOST }),
        this.config.language,
      );
    }
    const box = this.box;
    const parts = [
      render(REPORTS, 'found', {
        model: box.info.model,
        firmware: box.info.firmware ?? '?',
        host: box.host,
      }),
    ];
    try {
      if (box.capabilities.wan) {
        const status = await box.readStatus();
        parts.push(
          status.connected
            ? render(REPORTS, 'online', { ip: status.externalIp })
            : render(REPORTS, 'offline'),
        );
      } else {
        parts.push(render(REPORTS, 'noWan'));
      }
      const guest = await box.readGuestWifi();
      if (guest) {
        parts.push(render(REPORTS, guest.enabled ? 'guestOn' : 'guestOff'));
      }
      await this.refreshHosts();
      parts.push(
        render(REPORTS, 'hosts', {
          active: [...this.hosts.values()].filter((host) => host.active).length,
          total: this.hosts.size,
        }),
      );
    } catch (err) {
      if (err.kind === 'fault' && err.code === 606) {
        this.warnings.add('rights');
        await this.sendStatus();
        parts.push(render(STATUS, 'rights'));
      } else {
        await this.noteFailure(err);
        throw new GladysError(
          render(STATUS, this.problem ?? 'unreachable', { host: box.host }),
          this.config.language,
        );
      }
    }
    await this.publishDiscovered();
    parts.push(render(REPORTS, 'discover'));
    return join(...parts);
  }

  // --- Call monitor ------------------------------------------------------------

  startCallMonitor() {
    this.warnings.delete('callRefused');
    this.warnings.delete('callLost');
    if (!this.config.callMonitor || !this.box || this.stopped) {
      return;
    }
    this.callMonitor = new CallMonitor({
      host: this.box.host,
      connect: this.connectSocket,
      onLine: (event) => {
        this.onCallLine(event).catch((err) => logger.warn(`Call event failed: ${err.message}`));
      },
      onState: (state) => {
        this.warnings.delete('callRefused');
        this.warnings.delete('callLost');
        if (state === 'refused') {
          this.warnings.add('callRefused');
        } else if (state === 'lost') {
          this.warnings.add('callLost');
        }
        this.sendStatus().catch(() => {});
      },
    });
    this.callMonitor.start();
    this.refreshPhonebook().catch(() => {});
  }

  stopCallMonitor() {
    this.callMonitor?.stop();
    this.callMonitor = null;
  }

  async refreshPhonebook() {
    if (!this.box || this.now() - this.phonebookAt < this.timings.phonebookMs) {
      return;
    }
    this.phonebookAt = this.now();
    try {
      this.lookup = createLookup(await this.box.readPhonebook());
      this.problems.recover('phonebook');
    } catch (err) {
      // Reading the phone books needs the "Voice messages, fax messages,
      // FRITZ!App Fon and call list" right: without it, numbers only (tried
      // again every 6 hours and at every restart of the call monitor).
      this.problems.fail('phonebook', `Phone books unavailable: ${err.message}`);
    }
  }

  /** One call monitor line → the scene events, with the contact name. */
  async onCallLine(event) {
    const events = this.tracker.handle(event);
    if (events.length === 0) {
      return;
    }
    this.refreshPhonebook().catch(() => {});
    for (const { key, data } of events) {
      const name = data.number
        ? (this.lookup(data.number) ?? data.number)
        : (HIDDEN_NUMBER[this.config.language] ?? HIDDEN_NUMBER.en);
      this.fire(key, { ...data, name });
    }
  }

  // --- Widget ------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows. */
  view() {
    const created = this.createdDevices();
    const people = this.createdMacs().map((mac) => {
      const device = created.find(
        (entry) => entry.external_id === hostIds(this.gladys, mac).device,
      );
      return {
        mac,
        externalId: hostIds(this.gladys, mac).device,
        name: device?.name ?? this.hosts.get(mac)?.name ?? mac,
        online: this.presence.get(mac)?.online ?? null,
      };
    });
    return {
      connected: Boolean(this.box),
      boxCreated: this.box ? this.isCreated(this.boxDeviceId()) : false,
      ids: this.box ? boxIds(this.gladys, this.box.info.id) : null,
      capabilities: this.box?.capabilities ?? null,
      internet: this.status?.connected ?? null,
      uptime: this.status?.uptime ?? null,
      guest: this.guest,
      guestOffAt: this.saved.guestOffAt ?? null,
      people,
    };
  }
}
