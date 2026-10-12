# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the user name and password of a FRITZ!Box user, entered in the
  Gladys configuration (the password is a `secret` field) and received from
  Gladys at start. They are kept in memory only, never written under `/data`
  nor logged. The password never travels either: TR-064 uses HTTP Digest
  authentication. After a refused login, the integration waits 15 minutes
  before trying again, so that it never locks the user out of the box.
- **Stored in `/data`** (`/data/state.json`): the address of the box found by
  the network search, its serial number, the last external IP address, and
  the end time of a guest Wi-Fi timer.
- **Personal data in transit**: the list of the devices known by the box
  (names, IP and MAC addresses), the phone numbers of the call monitor and the
  phone books of the box. They are kept in memory, never logged; numbers and
  names only reach Gladys as scene variables. The guest Wi-Fi password is read
  only when a scene asks for it, and only returned to that scene.
- **Network**: from its container, HTTP (port 49000) or HTTPS (port 49443,
  certificate not verified: the box's own) towards the FRITZ!Box only, and,
  when the call monitor is enabled, one TCP connection to its port 1012. The
  SSDP search is sent by the Gladys core on the integration's behalf
  (manifest `network_discovery`). Nothing leaves the local network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the FRITZ!Box and its firmware (report those to AVM).
