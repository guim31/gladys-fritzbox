# FRITZ!Box for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that connects an AVM
**FRITZ!Box**: internet status and rates, external IP, guest Wi-Fi switch, presence of the network
devices you choose, and phone calls as scene triggers. The equivalent of the Home Assistant
**AVM FRITZ!Box Tools** (`fritz`) and **AVM FRITZ!Box Call Monitor** (`fritzbox_callmonitor`)
integrations, in one. Everything stays local: TR-064, AVM's documented interface, and the call
monitor of the box. No cloud, no MyFRITZ! account.

> **Developed without the hardware: feedback welcome.** The integration is covered by automated
> tests built on real answers of FRITZ!Boxes (descriptions, host list and action outputs collected
> by fritzconnection and Home Assistant), and its TR-064 client was checked against a simulated box
> in the locked-down container, but it has not run against a real FRITZ!Box yet. Please report what
> works and what does not in the [issues](https://github.com/guim31/gladys-fritzbox/issues).
>
> **Ohne die Hardware entwickelt: Rückmeldungen sind willkommen.**

## Features

- **The box**: **Internet** (on/off), current **Download** and **Upload** rates (Mbit/s, with
  history), maximum rates of the line, **External IP**, **Connection time**, a **Guest Wi-Fi**
  switch and a **Reconnect** button (a new IP on most DSL lines).
- **Presence**: one device per network device you choose in the Discover tab (only the connected
  ones are proposed, never the hundreds the box remembers), present while the box sees it, away
  after a delay (3 minutes by default, for phones asleep on Wi-Fi).
- **Discovery**: the box is found through the SSDP search of the Gladys core, or reached at the
  address you enter. Stable identity: the serial number of the box (its MAC address) and the MAC
  address of each device.
- **Call monitor** (optional): scene triggers _Incoming call_, _Missed call_ (also when the
  answering machine took it) and _Call ended_, with the number and the name from the phone books of
  the box.
- **Scene triggers** _Internet connection restored_ (with the outage duration) and _External IP
  changed_.
- **Scene actions** _Turn on the guest Wi-Fi_ (optionally for a number of minutes, kept across
  restarts, with the Wi-Fi name and password as results), _Turn off the guest Wi-Fi_ and _Reconnect
  the internet_ (can wait until the box is connected again).
- **Dashboard widget** _FRITZ!Box_: rates, internet status, guest Wi-Fi with its button, who is
  home, and a _Reconnect internet_ button (with confirmation). No public IP nor MAC address on the
  dashboard.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A FRITZ!Box (FRITZ!OS 7 or later recommended) with **Allow access for applications** and
  **Transmit status information over UPnP** enabled (Home Network > Network > Network Settings), and
  a FRITZ!Box user with the **FRITZ!Box Settings** right (plus **Voice messages, faxes, FRITZ!App
  Fon and call list** for the callers' names).
- For the calls: the call monitor switched on by dialing `#96*5*` on a phone connected to the box.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-fritzbox` (or install it from the catalog once it is listed).
   The install screen shows the access the integration asks for: the **SSDP search for
   urn:dslforum-org:device:InternetGatewayDevice:1** (to find the box).
2. In **Configuration**, enter the user name and password (the address is optional), then run
   **Test the connection**.
3. Open the **Discover** tab and press **Add to Gladys** on the box and on the devices to follow.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──TR-064: SOAP over HTTP :49000 (or HTTPS :49443), Digest auth──▶ FRITZ!Box
      │                ──UPnP IGD status (current rates), no auth──────────────────────▶
      │                ──call monitor, TCP :1012 (optional)────────────────────────────▶
      │ SDK (WebSocket + host API)
      ▼
Gladys core (host network) ──SSDP M-SEARCH urn:dslforum-org:device:InternetGatewayDevice:1──▶ LAN
```

- The TR-064 client is written on `node:http` (no dependency): it reads `tr64desc.xml` and
  `igddesc.xml` to learn the services the box offers, then sends the same actions as fritzconnection
  and Home Assistant (`DeviceInfo1.GetInfo`, `<connection>.GetInfo`, `WANCommonIFC1.GetAddonInfos`,
  `WLANConfiguration<last>.SetEnable`, `Hosts1.X_AVM-DE_GetHostListPath`,
  `<connection>.ForceTermination`…). The guest Wi-Fi is the last Wi-Fi network of the box, as in
  fritzconnection and Home Assistant.
- Devices are published with `should_poll: false`: the integration reads the box itself at the
  configured interval (4 to 6 small requests every 30 s by default) and publishes only the changes,
  plus every value every 12 hours so that a stable value never shows "No recent value".
- A refused login stops the reads for 15 minutes: the FRITZ!Box blocks logins for longer and longer
  after failures, retrying at every cycle would lock the user out.
- Phone numbers, names and the guest Wi-Fi password are never logged. `/data/state.json` keeps the
  address found by the search, the serial number, the last external IP and a guest Wi-Fi timer.

## Limitations

- **Developed without the hardware**: see above.
- One FRITZ!Box per installation; FRITZ!Repeaters are not read (the devices they serve appear in the
  list of the box all the same). A box used as a mesh repeater or IP client gets no internet
  features.
- **FRITZ!SmartHome** (DECT plugs and thermostats, AHA-HTTP) is out of scope: another integration,
  later.
- External IPv4 only. The current rates are a snapshot read at the configured interval.
- The reconnection gives a new IP on most DSL (PPPoE) lines; on cable and fiber, the address often
  stays the same.
- Phones with a "rotating" private Wi-Fi address appear as new devices every few days.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + the SDK's fake Gladys and a simulated FRITZ!Box
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              handlers → hub, configuration action
src/hub.js              connection, read cycle, states, presence, scene events, commands
src/fritz/client.js     TR-064 client (descriptions, SOAP, Digest, errors)
src/fritz/digest.js     HTTP Digest authentication
src/fritz/http.js       the one place that opens HTTP connections
src/fritz/box.js        what is read and changed on the box
src/fritz/callmonitor.js  call monitor (TCP 1012) and call events
src/fritz/phonebook.js  phone books, number matching
src/discovery.js        SSDP answers relayed by the core
src/devices.js          Gladys devices (box, network devices), names in four languages
src/scenes.js           scene actions
src/widgets.js          dashboard widget
src/messages.js         texts sent from the container, four languages
src/store.js            /data persistence
src/config.js           configuration defaults and normalization
```

## Credits

- [fritzconnection](https://github.com/kbr/fritzconnection) (MIT, Klaus Bremer): the reference
  for the TR-064 actions, the call monitor format, and the real descriptions and host list used as
  test fixtures.
- [Home Assistant](https://www.home-assistant.io) ([`fritz`](https://www.home-assistant.io/integrations/fritz/)
  and [`fritzbox_callmonitor`](https://www.home-assistant.io/integrations/fritzbox_callmonitor/),
  Apache-2.0): what users expect from these integrations, and the action outputs of its tests used
  as fixtures.
- [AVM](https://avm.de/service/schnittstellen/): the public TR-064 documentation.
- Cover: the FRITZ! logo (December 2025) from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fritz!_Logo_2025.12.svg), public
  domain, recolored white.

Not affiliated with FRITZ! GmbH (formerly AVM). FRITZ! and FRITZ!Box are trademarks of FRITZ! GmbH.

## License

Apache-2.0, see [LICENSE](LICENSE).
