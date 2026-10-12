// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (stored by Gladys as typed); the
// normalized config holds numbers, in seconds.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the box. The scheduler runs in the container
// (devices are published with should_poll: false): each read is 4 to 6 small
// requests, well within what a FRITZ!Box serves.
export const POLL_INTERVALS = ['10', '30', '60', '120', '300'];

// Seconds a device may be missing from the box's list before it is shown
// away. Phones asleep on Wi-Fi drop off for a few minutes; Home Assistant
// waits 180 s by default too.
export const OFFLINE_DELAYS = ['0', '60', '180', '300', '600', '900', '1800'];

export const DEFAULT_CONFIG = {
  host: '',
  username: '',
  password: '',
  https: false,
  poll_interval: '30',
  offline_after: '180',
  call_monitor: false,
  language: 'fr',
};

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? Number(value) : Number(fallback);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bool = (value) => value === true || value === 'true' || value === 1 || value === '1';

/** `http://192.168.178.1:49000/` or `fritz.box` → `192.168.178.1` / `fritz.box`. */
export function normalizeHost(value) {
  let host = text(value);
  if (!host) {
    return '';
  }
  try {
    if (/^[a-z]+:\/\//i.test(host)) {
      host = new URL(host).hostname;
    }
  } catch {
    return host;
  }
  host = host.replace(/\/.*$/, '');
  // A bare IPv4 or name with a port: the port is the integration's business.
  const withPort = host.match(/^([^:[\]]+):\d+$/);
  return (withPort ? withPort[1] : host).replace(/^\[|\]$/g, '');
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    host: normalizeHost(source.host),
    username: text(source.username),
    // Passwords may legitimately start or end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    https: bool(source.https),
    pollInterval: pick(source.poll_interval, POLL_INTERVALS, DEFAULT_CONFIG.poll_interval),
    offlineAfter: pick(source.offline_after, OFFLINE_DELAYS, DEFAULT_CONFIG.offline_after),
    callMonitor: bool(source.call_monitor),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
