// -----------------------------------------------------------------------------
// The Gladys devices of the integration.
//
// The box (one device, id = its serial number, which is its MAC address):
//   internet        input/binary, On = connected to the internet
//   download/upload datarate/rate in Mbit/s, current traffic of the line
//   max_download/max_upload  datarate/rate in Mbit/s, rates of the line
//   external_ip     text/text, public IPv4
//   connection_time duration/integer in minutes since the last (re)connection
//   guest_wifi      switch/binary, controllable
//   reconnect       button/push: a new internet connection (a new IP on most DSL lines)
// The internet features exist only on a box that routes to the internet
// (not on a box used as a mesh repeater or IP client); guest_wifi only on a
// box with a guest Wi-Fi.
//
// A network device the user chose (one device per MAC address):
//   presence        presence-sensor/binary, 1 = connected to the box
//
// Every device is published with should_poll: false: the integration reads
// the box itself, at the configured interval (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const BOX_TYPE = 'box';
export const HOST_TYPE = 'host';

export const BOX_FEATURES = {
  INTERNET: 'internet',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  MAX_DOWNLOAD: 'max_download',
  MAX_UPLOAD: 'max_upload',
  EXTERNAL_IP: 'external_ip',
  CONNECTION_TIME: 'connection_time',
  GUEST_WIFI: 'guest_wifi',
  RECONNECT: 'reconnect',
};
export const HOST_FEATURES = { PRESENCE: 'presence' };

// Display bounds of the rate features (history chart, gauges): 10 Gbit/s
// covers every FRITZ!Box line.
export const MAX_RATE_MBPS = 10000;
// Display bound of the connection time: one year, in minutes.
export const MAX_CONNECTION_MINUTES = 525600;

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    internet: 'Internet',
    download: 'Download',
    upload: 'Upload',
    max_download: 'Line download rate',
    max_upload: 'Line upload rate',
    external_ip: 'External IP',
    connection_time: 'Connection time',
    guest_wifi: 'Guest Wi-Fi',
    reconnect: 'Reconnect',
    presence: 'Presence',
  },
  fr: {
    internet: 'Internet',
    download: 'Débit descendant',
    upload: 'Débit montant',
    max_download: 'Débit descendant de la ligne',
    max_upload: 'Débit montant de la ligne',
    external_ip: 'IP externe',
    connection_time: 'Durée de connexion',
    guest_wifi: 'Wi-Fi invités',
    reconnect: 'Reconnecter',
    presence: 'Présence',
  },
  de: {
    internet: 'Internet',
    download: 'Download',
    upload: 'Upload',
    max_download: 'Download-Rate der Leitung',
    max_upload: 'Upload-Rate der Leitung',
    external_ip: 'Externe IP',
    connection_time: 'Verbindungsdauer',
    guest_wifi: 'Gast-WLAN',
    reconnect: 'Neu verbinden',
    presence: 'Anwesenheit',
  },
  es: {
    internet: 'Internet',
    download: 'Descarga',
    upload: 'Subida',
    max_download: 'Velocidad de bajada de la línea',
    max_upload: 'Velocidad de subida de la línea',
    external_ip: 'IP externa',
    connection_time: 'Tiempo de conexión',
    guest_wifi: 'Wi-Fi de invitados',
    reconnect: 'Reconectar',
    presence: 'Presencia',
  },
};

const macKey = (mac) => mac.replace(/:/g, '');

/** External ids of the box device and its features. */
export function boxIds(gladys, boxId) {
  const ids = gladys.externalIds(BOX_TYPE, boxId);
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(BOX_FEATURES).map((key) => [key, ids.feature(key)])),
  };
}

/** External ids of a network device (by MAC `aa:bb:…`). */
export function hostIds(gladys, mac) {
  const ids = gladys.externalIds(HOST_TYPE, macKey(mac));
  return { device: ids.device, presence: ids.feature(HOST_FEATURES.PRESENCE) };
}

/** The MAC (`aa:bb:…`) of a network device external id, or null if not one. */
export function macOf(gladys, externalId) {
  const prefix = gladys.externalIds(HOST_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const hex = externalId.slice(prefix.length).split(':')[0];
  return /^[0-9a-f]{12}$/.test(hex) ? hex.match(/../g).join(':') : null;
}

/** The box id of a box device external id, or null if not one. */
export function boxIdOfDevice(gladys, externalId) {
  const prefix = gladys.externalIds(BOX_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

const sensor = (name, externalId, category, type, extra = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

/**
 * The discovery payload of the box.
 * @param {object} gladys
 * @param {{ id, model, name, firmware }} info from FritzBox.connect()
 * @param {object} capabilities from FritzBox.connect()
 * @param {string} host the address the integration reaches it at
 * @param {string} language language of the feature names
 */
export function buildBoxDevice(gladys, info, capabilities, host, language = 'fr') {
  const ids = boxIds(gladys, info.id);
  const names = NAMES[language] ?? NAMES.en;
  const features = [];
  if (capabilities.wan) {
    const rate = (key) =>
      sensor(
        names[key],
        ids[key],
        DEVICE_FEATURE_CATEGORIES.DATARATE,
        DEVICE_FEATURE_TYPES.DATARATE.RATE,
        {
          unit: DEVICE_FEATURE_UNITS.MEGABITS_PER_SECOND,
          max: MAX_RATE_MBPS,
        },
      );
    features.push(
      sensor(
        names.internet,
        ids.internet,
        DEVICE_FEATURE_CATEGORIES.INPUT,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      ),
      rate(BOX_FEATURES.DOWNLOAD),
      rate(BOX_FEATURES.UPLOAD),
      rate(BOX_FEATURES.MAX_DOWNLOAD),
      rate(BOX_FEATURES.MAX_UPLOAD),
      sensor(
        names.external_ip,
        ids.external_ip,
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        {
          min: 0,
          max: 0,
        },
      ),
      sensor(
        names.connection_time,
        ids.connection_time,
        DEVICE_FEATURE_CATEGORIES.DURATION,
        DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        {
          unit: DEVICE_FEATURE_UNITS.MINUTES,
          max: MAX_CONNECTION_MINUTES,
          // It moves every minute: the last value is enough.
          keep_history: false,
        },
      ),
    );
  }
  if (capabilities.guestWifi) {
    features.push({
      name: names.guest_wifi,
      external_id: ids.guest_wifi,
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    });
  }
  if (capabilities.wan) {
    features.push({
      name: names.reconnect,
      external_id: ids.reconnect,
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 1,
    });
  }
  const params = [{ name: 'HOST', value: host }];
  if (info.firmware) {
    params.push({ name: 'FRITZ_OS', value: info.firmware });
  }
  return {
    name: info.name,
    external_id: ids.device,
    model: info.model,
    should_poll: false,
    params,
    features,
  };
}

/**
 * The discovery payload of a network device.
 * @param {object} gladys
 * @param {{ mac, name, ip }} host
 * @param {string} language
 */
export function buildHostDevice(gladys, host, language = 'fr') {
  const ids = hostIds(gladys, host.mac);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'MAC', value: host.mac }];
  if (host.ip) {
    params.push({ name: 'IP', value: host.ip });
  }
  return {
    name: String(host.name || host.mac).slice(0, 60),
    external_id: ids.device,
    model: 'FRITZ!Box network device',
    should_poll: false,
    params,
    features: [
      sensor(
        names.presence,
        ids.presence,
        DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      ),
    ],
  };
}
