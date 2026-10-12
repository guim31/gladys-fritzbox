// -----------------------------------------------------------------------------
// What the integration reads and changes on a FRITZ!Box, over TR-064
// (src/fritz/client.js). The actions are the ones fritzconnection and the Home
// Assistant `fritz` integration use, and AVM documents
// (avm.de/service/schnittstellen):
//
//   DeviceInfo1.GetInfo                       serial number, model, FRITZ!OS
//   Layer3Forwarding1.GetDefaultConnectionService  WANPPPConnection (DSL) or WANIPConnection
//   <connection>.GetInfo                      connected, uptime, external IPv4
//   <connection>.ForceTermination             reconnect (a new IP on most DSL lines)
//   WANCommonInterfaceConfig1.GetCommonLinkProperties  line rates (physical link)
//   WANCommonIFC1.GetAddonInfos (UPnP IGD)    current rates, in bytes per second
//   WLANConfiguration<last>.GetInfo/SetEnable guest Wi-Fi (the last Wi-Fi of the box)
//   WLANConfiguration<last>.GetSecurityKeys   its password (scene output only)
//   Hosts1.X_AVM-DE_GetHostListPath           every known host in one XML document
//   X_AVM-DE_OnTel1.GetPhonebookList/GetPhonebook  phone books, for caller names
// -----------------------------------------------------------------------------

import { Tr064Client, Tr064Error } from './client.js';
import { parsePhonebook } from './phonebook.js';
import { blocks, children } from './xml.js';

/** The UPnP error AVM answers to a reconnection already in progress. */
const DISCONNECT_IN_PROGRESS = 707;

/** `1.WANPPPConnection.1` → `WANPPPConnection1`. */
export function connectionServiceName(value) {
  const match = String(value ?? '').match(/(WAN(?:PPP|IP)Connection)\.(\d+)$/);
  return match ? `${match[1]}${match[2]}` : null;
}

/** The guest Wi-Fi is the last WLANConfiguration of a box that has several. */
export function guestWifiService(services) {
  const indexes = [...services.keys()]
    .map((name) => name.match(/^WLANConfiguration(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  return indexes.length >= 2 ? `WLANConfiguration${Math.max(...indexes)}` : null;
}

/** A stable id: the serial number (the MAC of the box), else the end of its UDN. */
export function boxIdOf({ serial, udn }) {
  const clean = String(serial ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
  if (clean.length >= 6) {
    return clean;
  }
  const tail = String(udn ?? '')
    .toLowerCase()
    .match(/([0-9a-f]{12})$/);
  return tail ? tail[1] : null;
}

/** `aa:bb:cc:dd:ee:ff` from any MAC spelling, or null. */
export function normalizeMac(value) {
  const hex = String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex.match(/../g).join(':') : null;
}

const toNumber = (value) => {
  const number = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(number) ? number : null;
};
const isTrue = (value) => value === '1' || value === 'true';

/** Mbit/s from bit/s or byte/s, rounded to what a dashboard shows. */
export function megabits(value, { bytes = false } = {}) {
  const number = toNumber(value);
  if (number === null || number < 0) {
    return null;
  }
  const mbps = (bytes ? number * 8 : number) / 1e6;
  if (mbps < 1) {
    return Math.round(mbps * 100) / 100;
  }
  if (mbps < 100) {
    return Math.round(mbps * 10) / 10;
  }
  return Math.round(mbps);
}

/**
 * The hosts of `devicehostlist.lua` (X_AVM-DE_GetHostListPath).
 * @returns {Array<{ mac, ip, name, active, interface, guest }>}
 */
export function parseHostList(xml) {
  const hosts = [];
  for (const item of blocks(xml, 'Item')) {
    const fields = children(item);
    const mac = normalizeMac(fields.MACAddress);
    if (!mac) {
      continue;
    }
    hosts.push({
      mac,
      ip: fields.IPAddress || null,
      name: fields.HostName || mac,
      active: isTrue(fields.Active),
      interface: fields.InterfaceType || null,
      guest: isTrue(fields['X_AVM-DE_Guest']),
    });
  }
  return hosts;
}

export class FritzBox {
  /**
   * @param {object} options see Tr064Client; `client` replaces it (tests)
   */
  constructor(options) {
    this.client = options.client ?? new Tr064Client(options);
    this.info = null;
    this.capabilities = null;
  }

  get host() {
    return this.client.host;
  }

  /**
   * Read the descriptions and the identity, find what this box offers.
   * @returns {Promise<{ info, capabilities }>}
   */
  async connect() {
    const description = await this.client.loadDescriptions();
    let device = {};
    try {
      device = await this.client.call('DeviceInfo1', 'GetInfo');
    } catch (err) {
      if (err.kind === 'auth' || err.kind === 'unreachable') {
        throw err;
      }
    }
    let connectionService = null;
    if (this.client.has('Layer3Forwarding1')) {
      try {
        const result = await this.client.call('Layer3Forwarding1', 'GetDefaultConnectionService');
        connectionService = connectionServiceName(result.NewDefaultConnectionService);
      } catch (err) {
        if (err.kind === 'auth' || err.kind === 'unreachable') {
          throw err;
        }
      }
    }
    if (connectionService && !this.client.has(connectionService)) {
      connectionService = null;
    }
    const services = this.client.services;
    this.info = {
      id: boxIdOf({ serial: device.NewSerialNumber, udn: description.udn }),
      model: device.NewModelName || description.modelName || 'FRITZ!Box',
      name: description.friendlyName || device.NewModelName || 'FRITZ!Box',
      firmware: device.NewSoftwareVersion || description.firmware || null,
    };
    this.capabilities = {
      wan: connectionService !== null,
      connectionService,
      link: services.has('WANCommonInterfaceConfig1'),
      rates: services.has('WANCommonIFC1'),
      igd: this.client.igd,
      guestWifi: guestWifiService(services),
      hosts: services.has('Hosts1'),
      phonebook: services.has('X_AVM-DE_OnTel1'),
    };
    return { info: this.info, capabilities: this.capabilities };
  }

  /**
   * The internet status, each part read on its own: a part the box refuses
   * stays null, the others are still returned. Connection and authentication
   * failures are thrown.
   */
  async readStatus() {
    const status = {
      connected: null,
      uptime: null,
      externalIp: null,
      linkUp: null,
      maxDownload: null,
      maxUpload: null,
      download: null,
      upload: null,
    };
    const caps = this.capabilities ?? {};
    const tolerate = async (fn) => {
      try {
        await fn();
      } catch (err) {
        if (err.kind === 'auth' || err.kind === 'unreachable') {
          throw err;
        }
      }
    };
    if (caps.wan) {
      await tolerate(async () => {
        const info = await this.client.call(caps.connectionService, 'GetInfo');
        status.connected = info.NewConnectionStatus === 'Connected';
        status.uptime = status.connected ? toNumber(info.NewUptime) : 0;
        let ip = info.NewExternalIPAddress;
        if (ip === undefined && status.connected) {
          const result = await this.client.call(caps.connectionService, 'GetExternalIPAddress');
          ip = result.NewExternalIPAddress;
        }
        // 0.0.0.0 while the connection is down.
        status.externalIp = ip && ip !== '0.0.0.0' ? ip : null;
      });
    }
    if (caps.link) {
      await tolerate(async () => {
        const link = await this.client.call('WANCommonInterfaceConfig1', 'GetCommonLinkProperties');
        status.linkUp = link.NewPhysicalLinkStatus === 'Up';
        status.maxDownload = megabits(link.NewLayer1DownstreamMaxBitRate);
        status.maxUpload = megabits(link.NewLayer1UpstreamMaxBitRate);
      });
    }
    if (caps.rates) {
      await tolerate(async () => {
        const rates = await this.client.call('WANCommonIFC1', 'GetAddonInfos');
        status.download = megabits(rates.NewByteReceiveRate, { bytes: true });
        status.upload = megabits(rates.NewByteSendRate, { bytes: true });
      });
    }
    return status;
  }

  /** `{ enabled, ssid }` of the guest Wi-Fi, or null when the box has none. */
  async readGuestWifi() {
    const service = this.capabilities?.guestWifi;
    if (!service) {
      return null;
    }
    const info = await this.client.call(service, 'GetInfo');
    return { enabled: isTrue(info.NewEnable), ssid: info.NewSSID || null };
  }

  async setGuestWifi(enabled) {
    const service = this.requireGuestWifi();
    await this.client.call(service, 'SetEnable', { NewEnable: enabled ? 1 : 0 });
  }

  /** The guest Wi-Fi password (never logged, scene output only). */
  async guestWifiPassword() {
    const service = this.requireGuestWifi();
    const keys = await this.client.call(service, 'GetSecurityKeys');
    return keys.NewKeyPassphrase ?? '';
  }

  requireGuestWifi() {
    const service = this.capabilities?.guestWifi;
    if (!service) {
      throw new Tr064Error('service', 'This FRITZ!Box has no guest Wi-Fi');
    }
    return service;
  }

  /** Every host the box knows, active or not. */
  async readHosts() {
    if (!this.capabilities?.hosts) {
      return [];
    }
    try {
      const result = await this.client.call('Hosts1', 'X_AVM-DE_GetHostListPath');
      const path = result['NewX_AVM-DE_HostListPath'];
      if (path) {
        return parseHostList(await this.client.fetchText(path));
      }
    } catch (err) {
      // FRITZ!OS before 7.10 has no host list document: one entry at a time below.
      if (err.kind !== 'fault' && err.kind !== 'http') {
        throw err;
      }
    }
    const count = toNumber(
      (await this.client.call('Hosts1', 'GetHostNumberOfEntries')).NewHostNumberOfEntries,
    );
    const hosts = [];
    for (let index = 0; index < Math.min(count ?? 0, 256); index += 1) {
      const entry = await this.client.call('Hosts1', 'GetGenericHostEntry', { NewIndex: index });
      const mac = normalizeMac(entry.NewMACAddress);
      if (mac) {
        hosts.push({
          mac,
          ip: entry.NewIPAddress || null,
          name: entry.NewHostName || mac,
          active: isTrue(entry.NewActive),
          interface: entry.NewInterfaceType || null,
          guest: false,
        });
      }
    }
    return hosts;
  }

  /** Terminate the internet connection; the box dials again at once. */
  async reconnect() {
    const service = this.capabilities?.connectionService;
    if (!service) {
      throw new Tr064Error('service', 'This FRITZ!Box has no internet connection to reconnect');
    }
    try {
      await this.client.call(service, 'ForceTermination');
    } catch (err) {
      if (!(err.kind === 'fault' && err.code === DISCONNECT_IN_PROGRESS)) {
        throw err;
      }
    }
  }

  /** Every contact of every phone book of the box, merged. */
  async readPhonebook() {
    if (!this.capabilities?.phonebook) {
      return [];
    }
    const list = await this.client.call('X_AVM-DE_OnTel1', 'GetPhonebookList');
    const ids = String(list.NewPhonebookList ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id));
    const contacts = [];
    for (const id of ids) {
      const book = await this.client.call('X_AVM-DE_OnTel1', 'GetPhonebook', {
        NewPhonebookID: id,
      });
      if (book.NewPhonebookURL) {
        contacts.push(...parsePhonebook(await this.client.fetchText(book.NewPhonebookURL)));
      }
    }
    return contacts;
  }
}
