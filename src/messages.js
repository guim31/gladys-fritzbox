// -----------------------------------------------------------------------------
// Texts sent from the container (connection status, action messages, errors),
// in the four languages of the Gladys interface. Entries are strings or
// functions of one parameter object. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Connection status shown in the Configuration screen (keys: src/hub.js).
export const STATUS = {
  en: {
    credentials: 'Enter the user name and password of a FRITZ!Box user in the configuration.',
    notFound:
      'No FRITZ!Box found on the network: enter its address (e.g. 192.168.178.1) in the configuration.',
    unreachable: ({ host }) => `The FRITZ!Box does not answer at ${host}.`,
    auth: 'The FRITZ!Box refused the user name or password. Retried in 15 minutes, or when the configuration changes.',
    disabled:
      'The FRITZ!Box refuses applications: enable "Allow access for applications" in Home Network > Network > Network Settings.',
    rights: 'The FRITZ!Box user lacks the "FRITZ!Box Settings" right.',
    noRates:
      'Current rates unavailable: enable "Transmit status information over UPnP" in Home Network > Network > Network Settings.',
    callRefused: 'The call monitor is off: dial #96*5* on a phone connected to the FRITZ!Box.',
    callLost: 'The call monitor connection was lost, reconnecting.',
  },
  fr: {
    credentials:
      "Saisissez le nom et le mot de passe d'un utilisateur de la FRITZ!Box dans la configuration.",
    notFound:
      'Aucune FRITZ!Box trouvée sur le réseau : saisissez son adresse (ex. 192.168.178.1) dans la configuration.',
    unreachable: ({ host }) => `La FRITZ!Box ne répond pas à l'adresse ${host}.`,
    auth: 'La FRITZ!Box a refusé le nom ou le mot de passe. Nouvel essai dans 15 minutes, ou au changement de la configuration.',
    disabled:
      "La FRITZ!Box refuse les applications : activez « Autoriser l'accès pour des applications » dans Réseau domestique > Réseau > Paramètres réseau.",
    rights: "L'utilisateur de la FRITZ!Box n'a pas le droit « Paramètres de la FRITZ!Box ».",
    noRates:
      'Débits actuels indisponibles : activez « Transmettre les informations d’état par UPnP » dans Réseau domestique > Réseau > Paramètres réseau.',
    callRefused:
      "Le moniteur d'appels est désactivé : composez #96*5* sur un téléphone branché à la FRITZ!Box.",
    callLost: "La connexion au moniteur d'appels a été perdue, reconnexion en cours.",
  },
  de: {
    credentials:
      'Gib in der Konfiguration den Benutzernamen und das Kennwort eines FRITZ!Box-Benutzers ein.',
    notFound:
      'Keine FRITZ!Box im Netzwerk gefunden: Gib ihre Adresse (z. B. 192.168.178.1) in der Konfiguration ein.',
    unreachable: ({ host }) => `Die FRITZ!Box antwortet nicht unter ${host}.`,
    auth: 'Die FRITZ!Box hat Benutzername oder Kennwort abgelehnt. Neuer Versuch in 15 Minuten oder bei einer Änderung der Konfiguration.',
    disabled:
      'Die FRITZ!Box lässt keine Anwendungen zu: Aktiviere „Zugriff für Anwendungen zulassen“ unter Heimnetz > Netzwerk > Netzwerkeinstellungen.',
    rights: 'Dem FRITZ!Box-Benutzer fehlt das Recht „FRITZ!Box Einstellungen“.',
    noRates:
      'Aktuelle Datenraten nicht verfügbar: Aktiviere „Statusinformationen über UPnP übertragen“ unter Heimnetz > Netzwerk > Netzwerkeinstellungen.',
    callRefused:
      'Der Anrufmonitor ist aus: Wähle #96*5* an einem Telefon, das an der FRITZ!Box angeschlossen ist.',
    callLost: 'Die Verbindung zum Anrufmonitor ist abgebrochen, neuer Verbindungsaufbau.',
  },
  es: {
    credentials:
      'Introduzca el nombre y la contraseña de un usuario de la FRITZ!Box en la configuración.',
    notFound:
      'No se ha encontrado ninguna FRITZ!Box en la red: introduzca su dirección (p. ej. 192.168.178.1) en la configuración.',
    unreachable: ({ host }) => `La FRITZ!Box no responde en ${host}.`,
    auth: 'La FRITZ!Box ha rechazado el nombre o la contraseña. Nuevo intento en 15 minutos o al cambiar la configuración.',
    disabled:
      'La FRITZ!Box rechaza las aplicaciones: active «Permitir el acceso a aplicaciones» en Red doméstica > Red > Ajustes de red.',
    rights: 'Al usuario de la FRITZ!Box le falta el permiso «Ajustes de FRITZ!Box».',
    noRates:
      'Velocidades actuales no disponibles: active «Transmitir información de estado por UPnP» en Red doméstica > Red > Ajustes de red.',
    callRefused:
      'El monitor de llamadas está desactivado: marque #96*5* en un teléfono conectado a la FRITZ!Box.',
    callLost: 'Se ha perdido la conexión con el monitor de llamadas, reconectando.',
  },
};

// Report of the "Test the connection" action.
export const REPORTS = {
  en: {
    found: ({ model, firmware, host }) => `${model} (FRITZ!OS ${firmware}) found at ${host}.`,
    online: ({ ip }) => `Internet connected${ip ? `, external IP ${ip}` : ''}.`,
    offline: 'Internet not connected.',
    noWan: 'This box does not route to the internet (repeater or IP client): no internet features.',
    hosts: ({ active, total }) => `${active} network device(s) connected out of ${total} known.`,
    guestOn: 'Guest Wi-Fi: on.',
    guestOff: 'Guest Wi-Fi: off.',
    discover: 'Open the Discover tab to add the box and the devices to follow.',
    phonebook: ({ count }) => `${count} contact(s) in the phone books.`,
  },
  fr: {
    found: ({ model, firmware, host }) => `${model} (FRITZ!OS ${firmware}) trouvée à ${host}.`,
    online: ({ ip }) => `Internet connecté${ip ? `, IP externe ${ip}` : ''}.`,
    offline: 'Internet non connecté.',
    noWan:
      'Cette box ne route pas vers internet (répéteur ou client IP) : pas de fonctionnalités internet.',
    hosts: ({ active, total }) => `${active} appareil(s) réseau connecté(s) sur ${total} connu(s).`,
    guestOn: 'Wi-Fi invités : activé.',
    guestOff: 'Wi-Fi invités : désactivé.',
    discover: "Ouvrez l'onglet Découverte pour ajouter la box et les appareils à suivre.",
    phonebook: ({ count }) => `${count} contact(s) dans les annuaires.`,
  },
  de: {
    found: ({ model, firmware, host }) => `${model} (FRITZ!OS ${firmware}) unter ${host} gefunden.`,
    online: ({ ip }) => `Internet verbunden${ip ? `, externe IP ${ip}` : ''}.`,
    offline: 'Internet nicht verbunden.',
    noWan:
      'Diese Box leitet nicht ins Internet (Repeater oder IP-Client): keine Internet-Funktionen.',
    hosts: ({ active, total }) => `${active} von ${total} bekannten Netzwerkgeräten verbunden.`,
    guestOn: 'Gast-WLAN: an.',
    guestOff: 'Gast-WLAN: aus.',
    discover: 'Öffne den Tab „Entdecken“, um die Box und die zu verfolgenden Geräte hinzuzufügen.',
    phonebook: ({ count }) => `${count} Kontakt(e) in den Telefonbüchern.`,
  },
  es: {
    found: ({ model, firmware, host }) => `${model} (FRITZ!OS ${firmware}) encontrada en ${host}.`,
    online: ({ ip }) => `Internet conectado${ip ? `, IP externa ${ip}` : ''}.`,
    offline: 'Internet no conectado.',
    noWan: 'Esta box no da salida a internet (repetidor o cliente IP): sin funciones de internet.',
    hosts: ({ active, total }) =>
      `${active} dispositivo(s) de red conectado(s) de ${total} conocido(s).`,
    guestOn: 'Wi-Fi de invitados: activada.',
    guestOff: 'Wi-Fi de invitados: desactivada.',
    discover: 'Abra la pestaña Descubrir para añadir la box y los dispositivos que seguir.',
    phonebook: ({ count }) => `${count} contacto(s) en las agendas.`,
  },
};

// Errors of the commands and of the scene actions, in the configured language
// (a scene action does not receive the user's language).
export const ERRORS = {
  en: {
    notConnected: 'The integration is not connected to the FRITZ!Box yet.',
    noGuestWifi: 'This FRITZ!Box has no guest Wi-Fi.',
    noWan: 'This FRITZ!Box has no internet connection to reconnect.',
    unknownDevice: 'This device does not belong to the FRITZ!Box integration.',
    failed: ({ reason }) => `The FRITZ!Box refused the command (${reason}).`,
  },
  fr: {
    notConnected: "L'intégration n'est pas encore connectée à la FRITZ!Box.",
    noGuestWifi: "Cette FRITZ!Box n'a pas de Wi-Fi invités.",
    noWan: "Cette FRITZ!Box n'a pas de connexion internet à reconnecter.",
    unknownDevice: "Cet appareil n'appartient pas à l'intégration FRITZ!Box.",
    failed: ({ reason }) => `La FRITZ!Box a refusé la commande (${reason}).`,
  },
  de: {
    notConnected: 'Die Integration ist noch nicht mit der FRITZ!Box verbunden.',
    noGuestWifi: 'Diese FRITZ!Box hat kein Gast-WLAN.',
    noWan: 'Diese FRITZ!Box hat keine Internetverbindung, die neu verbunden werden kann.',
    unknownDevice: 'Dieses Gerät gehört nicht zur Integration FRITZ!Box.',
    failed: ({ reason }) => `Die FRITZ!Box hat den Befehl abgelehnt (${reason}).`,
  },
  es: {
    notConnected: 'La integración aún no está conectada a la FRITZ!Box.',
    noGuestWifi: 'Esta FRITZ!Box no tiene Wi-Fi de invitados.',
    noWan: 'Esta FRITZ!Box no tiene conexión a internet que reconectar.',
    unknownDevice: 'Este dispositivo no pertenece a la integración FRITZ!Box.',
    failed: ({ reason }) => `La FRITZ!Box ha rechazado la orden (${reason}).`,
  },
};

// The `name` variable of a call from a hidden number.
export const HIDDEN_NUMBER = {
  en: 'Hidden number',
  fr: 'Numéro masqué',
  de: 'Unterdrückte Nummer',
  es: 'Número oculto',
};

/** A message table entry, rendered in every language. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    Object.entries(table).map(([language, entries]) => {
      const entry = entries[key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Join several rendered messages, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    Object.keys(messages[0]).map((language) => [
      language,
      messages.map((message) => message[language]).join(' '),
    ]),
  );
}
