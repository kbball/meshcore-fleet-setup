# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- A failed connect (for example `timeout waiting for reply to app start`) left the serial port open and locked, so the retry failed with "The port is already open" until the page was reloaded. The port is now closed when the identity read fails.
- A node that does not answer (a new board, or one running firmware without the USB companion protocol) could not be flashed, because the run read its identity before anything else and stopped there. With flash selected the run now goes on to the bootloader and records the connect step as "no reply from the node; going on to flash it". With backup selected it still stops, with a message saying the node cannot be backed up (a backup needs a talking node).
- The T-1000-E could not be flashed from the app: its bootloader is UF2-only (a `T1000-E` drive, no serial port), so the serial DFU path found nothing to talk to. See Added.
- Loading a station's downloaded file into the profile builder or the batch failed with "invalid profile": the Event tab's per-station download is a bundle (radio profile, gateway profile and go-box settings in one wrapper), not a profile. The Event tab now also offers **Download radio profile** and **Download gateway profile** for each station (real profile files the importers accept), and loading a bundle says what it is and what to load instead.

### Changed
- The Event tab and `profiles/event.example.json` default to firmware release `ares-v1.0.1`, the first release that lists the gateway with its own kind.
- The Docker image no longer copies `./firmware` in: it has an empty `/firmware` to mount the release onto. The smoke test checks that the image itself carries no firmware and that `/firmware/.release` is served.
- Firmware is distributed as a GitHub Release of the firmware fork (built when an `ares-vX.Y.Z` tag is pushed) instead of an orphan `firmware` branch of this repository. Documentation updated; `scripts/build-firmware-manifest.mjs` is now run by the fork's workflow, so its command line is kept stable.

### Removed
- `docs/fork/publish-firmware.yml`, the draft workflow that pushed firmware to a branch of this repo with an access token. The fork has its own workflow now.

### Added
- UF2 flashing for boards whose bootloader is a drive (the T-1000-E, companion and tracker). The app wraps the DFU package's `firmware.bin` as a UF2 for the nRF52840 (start address chosen from the softdevice id in the package; unknown ids are refused), asks the operator to double-click the board's button and choose the `T1000-E` drive in Chrome's folder picker, checks the folder is a UF2 drive (`INFO_UF2.TXT`), and writes the file. Nothing is needed from the firmware release: it still ships only the DFU `.zip`. The manifest may carry `"bootloader": "dfu" | "uf2"` per entry (`scripts/build-firmware-manifest.mjs` takes it as an optional fifth `--entry` field); without it, `t1000e_*` envs are UF2 and everything else is serial DFU. Not yet verified through the app on hardware.
- Firmware banner: shows the installed firmware release (from `firmware/.release` and the manifest versions), says when none is loaded, and warns when the loaded event expects a different release.
- `gateway` device kind (RAK4631 + Ethernet, `RAK_4631_companion_radio_usb_ethernet`): manifest kind, profile kind and builder option. It is configured like a companion over USB but has no BLE, so a gateway profile with `ble_pin` is rejected; the builder reminds you to reserve its DHCP address by MAC on the AREDN node. `scripts/build-firmware-manifest.mjs` and the Go server accept `gateway` entries (command line unchanged).
- Event tab: create an event (generates the random keys in the browser) or import an event file, then use any derived profile for the batch, download per-station bundles (only that station's channels), the tracker and net-control profiles, see the go-box settings with the DHCP/MAC reminder, add, rotate and remove stations. The event is held in memory only.
- Event file: one JSON file per event holding the firmware release tag, radio settings, the event-wide sweeps and all-race secrets and a per-station log and chat secret (random 16-byte keys, never derived from names). Derives each station's radio and gateway profile (fixed channel layout 0 sweeps, 1 aid station logging, 2 station chat, 3 all-race), tracker profiles with unique `Sweep{n}` names and the sweeps channel only, an all-channels net-control profile, and the go-box settings (`MESHCORE_ADDRESS`, channel indexes). Per-station bundles carry only that station's channels. Example in `profiles/event.example.json`.
- GPS setting for companion profiles (`gps: { enabled, interval_sec? }`) and in the profile builder: written with the node's `gps` / `gps_interval` settings, verified by read-back, captured in backups. Fails clearly on a node without a GPS.
- Profile builder: a form for building and editing companion and tracker profile files (validated live, keys generated in the browser and masked in the preview, download or use directly for the batch).

- UI theme adapted from sweep-tracker: shared colour tokens, light/dark/system toggle, DM Sans bundled for offline use, card/panel layout.

- Go server (`cmd/fleetsetup`) embedding the frontend and serving the firmware directory, with security headers, a healthcheck and a startup check of firmware against its manifest; distroless Docker image, compose file, image smoke test, GHCR publishing in CI.
- Offline bundle (`make bundle`) for laptops without Docker: app, firmware and a stdlib Python local server (`serve.py`).

- Project scaffold (Vite, React, TypeScript, Vitest), CI, and a Pages deploy workflow.
- Sweep tracker provisioning over the tracker text CLI (port of `provision_tracker.py`): validate, apply, read back, reboot.
- Companion node support over the companion serial protocol: radio, channels, advert name/location, flood scope, identity import, BLE PIN, auto-add; read-back verification; optional factory-reset wipe.
- Opt-in, passphrase-encrypted backup of a companion node (AES-GCM) with download and a prefilled mailto, and restore from a backup file.
- Browser nRF52 serial DFU flashing (Adafruit bootloader protocol), verified against `adafruit-nrfutil` test vectors; not yet tried on hardware.
- Firmware manifest with sha256 verification; `scripts/build-firmware-manifest.mjs` and a draft fork workflow (`docs/fork/publish-firmware.yml`).
- Batch UI: profile loading, next-node loop with name counter, results log with CSV export.

### Changed

- Frontend moved to `web/`.
