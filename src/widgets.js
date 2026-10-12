// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `fritzbox`.
//
// The home network at a glance: the current rates (two live tiles bound to
// the box features once the box is added to Gladys), how many followed
// devices are home, a status list (internet with its connection time, guest
// Wi-Fi, then each followed device: home or away), a button that switches the
// guest Wi-Fi on or off and a "Reconnect internet" button that asks first.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): 3 tiles, 1 status of
// 10 rows at most, 2 buttons; a text when the box is not connected. No public
// IP and no MAC address: a dashboard can be shown to visitors.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';

export const TTL_SECONDS = 30;
export const MAX_STATUS_ROWS = 10;
const GUEST_ACTION = 'guest_wifi';
const RECONNECT_ACTION = 'reconnect';

export const TEXT = {
  notConnected: {
    en: 'Not connected to the FRITZ!Box: check the configuration of the integration.',
    fr: "Pas de connexion à la FRITZ!Box : vérifiez la configuration de l'intégration.",
    de: 'Keine Verbindung zur FRITZ!Box: Prüfe die Konfiguration der Integration.',
    es: 'Sin conexión con la FRITZ!Box: revise la configuración de la integración.',
  },
  download: { en: 'Download', fr: 'Descendant', de: 'Download', es: 'Descarga' },
  upload: { en: 'Upload', fr: 'Montant', de: 'Upload', es: 'Subida' },
  home: { en: 'At home', fr: 'À la maison', de: 'Zu Hause', es: 'En casa' },
  internet: { en: 'Internet', fr: 'Internet', de: 'Internet', es: 'Internet' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Getrennt', es: 'Sin conexión' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  guestWifi: {
    en: 'Guest Wi-Fi',
    fr: 'Wi-Fi invités',
    de: 'Gast-WLAN',
    es: 'Wi-Fi de invitados',
  },
  on: { en: 'On', fr: 'Activé', de: 'An', es: 'Activado' },
  off: { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' },
  left: { en: 'left', fr: 'restantes', de: 'übrig', es: 'restantes' },
  present: { en: 'Home', fr: 'Présent', de: 'Zu Hause', es: 'En casa' },
  away: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Fuera' },
  turnOn: {
    en: 'Turn on guest Wi-Fi',
    fr: 'Activer Wi-Fi invités',
    de: 'Gast-WLAN einschalten',
    es: 'Activar Wi-Fi invitados',
  },
  turnOff: {
    en: 'Turn off guest Wi-Fi',
    fr: 'Couper Wi-Fi invités',
    de: 'Gast-WLAN ausschalten',
    es: 'Apagar Wi-Fi invitados',
  },
  reconnect: {
    en: 'Reconnect internet',
    fr: 'Reconnecter internet',
    de: 'Internet neu verbinden',
    es: 'Reconectar internet',
  },
  turnedOn: {
    en: 'Guest Wi-Fi turned on.',
    fr: 'Wi-Fi invités activé.',
    de: 'Gast-WLAN eingeschaltet.',
    es: 'Wi-Fi de invitados activado.',
  },
  turnedOff: {
    en: 'Guest Wi-Fi turned off.',
    fr: 'Wi-Fi invités coupé.',
    de: 'Gast-WLAN ausgeschaltet.',
    es: 'Wi-Fi de invitados apagado.',
  },
  reconnecting: {
    en: 'Reconnection requested: the internet is back in a few seconds.',
    fr: 'Reconnexion demandée : internet revient dans quelques secondes.',
    de: 'Neuverbindung angefordert: Das Internet ist in wenigen Sekunden zurück.',
    es: 'Reconexión solicitada: internet vuelve en unos segundos.',
  },
};

// Units of a duration, as the Gladys interface abbreviates them.
const UNITS = {
  en: { d: 'd', h: 'h', min: 'min' },
  fr: { d: 'j', h: 'h', min: 'min' },
  de: { d: 'T', h: 'h', min: 'min' },
  es: { d: 'd', h: 'h', min: 'min' },
};

const t = (text, language) => text[language] ?? text.en;

/** `2 d 4 h`, `3 h 12 min`, `5 min` (the two largest units). */
export function formatDuration(seconds, language) {
  const units = UNITS[language] ?? UNITS.en;
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) {
    return `${days} ${units.d} ${hours} ${units.h}`;
  }
  if (hours > 0) {
    return `${hours} ${units.h} ${rest} ${units.min}`;
  }
  return `${rest} ${units.min}`;
}

/** The internet row of the status list. */
export function internetRow(view, language) {
  if (view.internet === true) {
    const since = view.uptime ? ` · ${formatDuration(view.uptime, language)}` : '';
    return {
      label: t(TEXT.internet, language),
      value: `${t(TEXT.connected, language)}${since}`,
      icon: 'globe',
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return {
    label: t(TEXT.internet, language),
    value: t(view.internet === false ? TEXT.offline : TEXT.unknown, language),
    icon: 'globe',
    color: view.internet === false ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
  };
}

/** The guest Wi-Fi row, with the time left when a timer runs. */
export function guestRow(view, language, now) {
  const enabled = Boolean(view.guest?.enabled);
  let value = t(enabled ? TEXT.on : TEXT.off, language);
  if (enabled && view.guestOffAt && view.guestOffAt > now) {
    value += ` · ${formatDuration((view.guestOffAt - now) / 1000 + 59, language)} ${t(TEXT.left, language)}`;
  }
  return {
    label: t(TEXT.guestWifi, language),
    value,
    icon: enabled ? 'wifi' : 'wifi-off',
    color: enabled ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
  };
}

/** The followed devices a widget instance shows: the chosen ones, else all. */
function selectedPeople(view, settings) {
  const chosen = Array.isArray(settings?.devices) ? settings.devices : [];
  if (chosen.length === 0) {
    return view.people;
  }
  const byId = new Map(view.people.map((person) => [person.externalId, person]));
  return chosen.map((id) => byId.get(id)).filter(Boolean);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings, language = 'en' }) {
      const view = hub.view();
      if (!view.connected) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.notConnected, language) }],
        };
      }
      const components = [];
      const caps = view.capabilities;
      if (caps.wan) {
        for (const [key, icon] of [
          ['download', 'arrow-down'],
          ['upload', 'arrow-up'],
        ]) {
          const tile = { type: 'value', label: t(TEXT[key], language), icon };
          if (view.boxCreated) {
            tile.device_feature = view.ids[key];
          } else {
            tile.value = hub.status?.[key] ?? '-';
            tile.unit = 'Mbit/s';
          }
          components.push(tile);
        }
      }
      const people = selectedPeople(view, settings);
      if (people.length > 0) {
        const home = people.filter((person) => person.online === true).length;
        components.push({
          type: 'value',
          value: `${home} / ${people.length}`,
          label: t(TEXT.home, language),
          icon: 'users',
        });
      }
      const rows = [];
      if (caps.wan) {
        rows.push(internetRow(view, language));
      }
      if (caps.guestWifi && view.guest) {
        rows.push(guestRow(view, language, hub.now()));
      }
      for (const person of people.slice(0, MAX_STATUS_ROWS - rows.length)) {
        rows.push({
          label: String(person.name).slice(0, 40),
          value: t(
            person.online === true
              ? TEXT.present
              : person.online === false
                ? TEXT.away
                : TEXT.unknown,
            language,
          ),
          icon: person.online === true ? 'user-check' : 'user-x',
          color: person.online === true ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        });
      }
      if (rows.length > 0) {
        components.push({ type: 'status', items: rows });
      }
      if (caps.guestWifi && view.guest) {
        const enabled = view.guest.enabled;
        components.push({
          type: 'button',
          label: t(enabled ? TEXT.turnOff : TEXT.turnOn, language),
          icon: enabled ? 'wifi-off' : 'wifi',
          style: 'secondary',
          action: { key: GUEST_ACTION, params: { enable: !enabled } },
        });
      }
      if (caps.wan) {
        components.push({
          type: 'button',
          label: t(TEXT.reconnect, language),
          icon: 'refresh-cw',
          style: 'secondary',
          action: { key: RECONNECT_ACTION, confirm: true },
        });
      }
      return { ttl_seconds: TTL_SECONDS, components };
    },

    async action(hub, { actionKey, params }) {
      if (actionKey === GUEST_ACTION) {
        const enable = params?.enable === true;
        await hub.setGuestWifi(enable);
        return enable ? TEXT.turnedOn : TEXT.turnedOff;
      }
      if (actionKey === RECONNECT_ACTION) {
        await hub.reconnect();
        return TEXT.reconnecting;
      }
      return undefined;
    },
  },
};
