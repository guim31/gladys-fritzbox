# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Quieter logs: a box that does not answer, a network search the Gladys
  version refuses, a missing right on the box, states Gladys refuses or a call
  monitor that cannot connect now write one line when the problem starts and
  one when it is over, instead of a line at every read or reconnection
  attempt. The connection to the box is logged at the start and when it comes
  back after a loss.

## [1.0.0] - 2026-10-12

### Added

- A **FRITZ!Box** device: internet connection (on/off), current download and
  upload rates, maximum rates of the line, external IP, connection time, a
  **Guest Wi-Fi** switch and a **Reconnect** button (a new IP on most DSL
  lines), read over TR-064, AVM's local interface. No cloud.
- **Presence** of the network devices you choose (phones, computers…) in the
  Discover tab, with a delay before a device is shown away.
- The box is found on the network (SSDP through Gladys), or reached at the
  address you enter; **Test the connection** says what the box reports or
  what to fix (access for applications, user, rights, UPnP status).
- Optional **call monitor**: scene triggers **Incoming call**, **Missed
  call** and **Call ended**, with the caller's name from the phone books of
  the box.
- Scene triggers **Internet connection restored** (with the length of the
  outage) and **External IP changed**.
- Scene actions **Turn on the guest Wi-Fi** (optionally for a number of
  minutes, with its name and password as results), **Turn off the guest
  Wi-Fi** and **Reconnect the internet** (can wait until the box is connected
  again).
- Dashboard widget **FRITZ!Box**: rates, internet status, guest Wi-Fi with
  its button, who is home, and a **Reconnect internet** button.
- Texts and documentation in English, French, German and Spanish; feature
  names in French by default (setting **Language of the feature names**).
- Apache-2.0 `LICENSE` file.

[Unreleased]: https://github.com/guim31/gladys-fritzbox/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-fritzbox/releases/tag/v1.0.0
