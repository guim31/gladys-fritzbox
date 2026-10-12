// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - enable_guest_wifi: switch the guest Wi-Fi on, optionally for a number of
//   minutes (the integration switches it off again, even after a restart),
//   and return its name and password for a message to the guests. The core's
//   "Control a device" can flip the switch too; this action adds the timer
//   and the outputs.
// - disable_guest_wifi: switch it off (and forget any timer).
// - reconnect_internet: a new internet connection (a new external IP on most
//   DSL lines), optionally waiting until the box is connected again. The core
//   waits 120 s at most for an action: the wait stops at 100 s.
//
// Outputs are numbers (1/0), not booleans: the core's "Continue only if"
// compares with ===, and its value field only produces numbers and strings
// (Gladys 5.2.0).
// -----------------------------------------------------------------------------

import { MAX_GUEST_MINUTES, RECONNECT_WAIT_CAP_SECONDS } from './hub.js';

const isTrue = (value) => value === true || value === 'true' || value === 1 || value === '1';

/** Minutes from a number field (or a scene variable resolved to a string). */
export function minutesOf(value) {
  const minutes = Math.round(Number(String(value ?? '').replace(',', '.')));
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, MAX_GUEST_MINUTES) : 0;
}

export const SCENE_ACTIONS = {
  async enable_guest_wifi(hub, { fields }) {
    await hub.setGuestWifi(true, { minutes: minutesOf(fields?.duration_minutes) });
    const { ssid, password } = await hub.guestWifiDetails();
    return { ssid, password };
  },

  async disable_guest_wifi(hub) {
    await hub.setGuestWifi(false);
    return {};
  },

  async reconnect_internet(hub, { fields }) {
    if (!isTrue(fields?.wait)) {
      await hub.reconnect();
      return {};
    }
    const result = await hub.reconnect({ waitMs: RECONNECT_WAIT_CAP_SECONDS * 1000 });
    return {
      connected: result.connected ? 1 : 0,
      external_ip: result.externalIp,
      ip_changed: result.ipChanged ? 1 : 0,
    };
  },
};
