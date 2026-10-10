# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Offline bundle (`make bundle`): app, firmware and a stdlib Python local server (`serve.py`); relative asset paths.

- Project scaffold (Vite, React, TypeScript, Vitest), CI, and a Pages deploy workflow.
- Sweep tracker provisioning over the tracker text CLI (port of `provision_tracker.py`): validate, apply, read back, reboot.
- Companion node support over the companion serial protocol: radio, channels, advert name/location, flood scope, identity import, BLE PIN, auto-add; read-back verification; optional factory-reset wipe.
- Opt-in, passphrase-encrypted backup of a companion node (AES-GCM) with download and a prefilled mailto, and restore from a backup file.
- Browser nRF52 serial DFU flashing (Adafruit bootloader protocol), verified against `adafruit-nrfutil` test vectors; not yet tried on hardware.
- Firmware manifest with sha256 verification; `scripts/build-firmware-manifest.mjs` and a draft fork workflow (`docs/fork/publish-firmware.yml`).
- Batch UI: profile loading, next-node loop with name counter, results log with CSV export.
