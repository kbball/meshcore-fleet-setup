# meshcore-fleet-setup

Chrome web app that flashes and configures batches of MeshCore companion nodes before an event deployment. React + TypeScript (Vite) frontend in `web/`, served by a small Go server (`cmd/fleetsetup`) that embeds the built frontend (`web/embed.go`) and serves a firmware directory. One distroless container. No database: the server holds no state (the browser does the device work over Web Serial), so the Postgres/Goose rules from the global config do not apply. Everything else (layering, config, errors, testing, versioning, CI, git) does, as adapted below. This file wins on conflict.

## Server (Go)

- `internal/domain` (firmware manifest types and validation), `internal/app` (`Catalog` checks firmware files against the manifest at startup; ports in `ports.go`), `internal/adapters/{httpapi,fsstore,memory}`, `internal/config`, `cmd/fleetsetup` (composition root + `serve | healthcheck | version`).
- Env: `FLEET_ADDR` (default `:8080`), `FLEET_FIRMWARE_DIR` (manifest.json + zips, served read-only under `/firmware/`; unset disables), `LOG_LEVEL`. slog JSON to stderr.
- Serves `/` (embedded app, `assets/` immutable-cached), `/firmware/` (no directory listings, no-store), `/healthz`. Every response carries a CSP (`default-src 'self'`), nosniff, no-referrer and `Permissions-Policy: serial=(self)`. Keep the CSP tight: the app must never load or call anything off-origin.
- Bind to localhost on the event laptop (Web Serial needs a secure origin; `http://localhost` qualifies). The compose file publishes on 127.0.0.1 only.
- Image bakes in `./firmware` at build time; a volume at `/firmware` overrides it.
- `go test` must be run on explicit packages (`make test`), not `./...`: `web/node_modules` contains Go files.

## Architecture (hexagonal, frontend mirror)

Dependency direction is always inward: `adapters -> app -> domain`.

- `src/domain/`: entities and pure logic (profile model, name templating, protocol frame encode/decode, config diffing). Imports nothing from other src layers, no browser APIs, no framework.
- `src/app/`: use cases (flash node, wipe, configure, verify, batch loop) and the **port interfaces** (`ports.ts`): serial transport, DFU flasher, firmware manifest source, profile storage, clock, logger. Depends only on domain. No React, Web Serial, fetch or DOM.
- `src/adapters/`: implementations of ports (`webserial`, `dfu`, `manifest-http`, `profile-file`, `memory`, ...). Adapters may depend on app/domain, never on each other.
- `src/ui/`: React components and hooks. Talks to app use cases only; never to Web Serial or fetch directly.
- Composition root (`src/main.tsx` / `src/wiring.ts`): config, wiring and construction of adapters only.
- Include `adapters/memory` plus a simulated-node fake (a fake serial port speaking the companion protocol) so business logic is tested without hardware.
- Multi-step operations (flash -> wipe -> reconnect -> configure -> verify) live in an app service, not in UI handlers, with explicit per-step results so a half-finished node is reported, never silently left.
- Optional capabilities (DFU flashing, wipe) are adapters behind ports; if unsupported or disabled the app still loads and says why, with no crash.

## Configuration (12-factor)

- Server config from `FLEET_*` env vars, frontend build config from `VITE_*` (`web/.env.example`). Nothing hardcoded. Root `.env.example` is the canonical list for the server; `.env` is gitignored.
- Runs fully offline except explicit, user-triggered actions (fetching a firmware manifest/zip).
- No in-memory-only state that matters: persist loaded profile choice and batch results log locally (IndexedDB/localStorage) so a page reload does not lose a batch. Channel secrets are never persisted unless the user opts in.

## Logging and errors

- One logger built in the composition root and passed in through ports, not a global. No `console.log` in committed code. Never log secrets or PII (channel keys, private keys).
- Never swallow an error: wrap with context (`new Error("...", { cause })`) and rethrow; handle and log once at the boundary (use case result or UI).

## Testing and quality gates

- Coverage must stay above 80% (lines, statements, functions, branches) via Vitest thresholds in `vite.config.ts`; domain and app aim for 90%+. `npm run cover` also type checks and fails below thresholds. Enforced in CI.
- Vitest + React Testing Library + MSW (manifest/firmware fetches). Domain and app tested in isolation against `adapters/memory` and the simulated node.
- Makefile is the single entry point: `make test`, `make cover`, `make lint`, `make fmt`, `make build`, `make run`, delegating to npm.
- Before any commit: type check, ESLint, Prettier, tests all pass. Each unit of work leaves `make test` green.

## Versioning, changelog, CI, git

- Semver; `VERSION` file at repo root is the single source (Makefile and build read it; app reports it, with `-pr<N>`/`-dev` suffix for non-releases).
- Every user-visible change gets a `CHANGELOG.md` entry (Keep a Changelog) under `Unreleased`. README describes current state only. `plan.md` lists only remaining work; delete items when done and log decisions with rationale.
- Never commit directly to `main`; branch `feature/...`, `fix/...`, `chore/...`. Merge via PR with required checks passing. Commit only when asked.
- CI (`.github/workflows/ci.yml`; triggers PR, push to main, workflow_dispatch; PR runs cancel when superseded; least-privilege permissions): jobs **Go** (gofmt, `make test`, `make cover`), **Frontend** (`npm ci`, `npm run cover`, `npm run build` in `web/`) and **Image** (needs both: validates `VERSION`, builds, runs `scripts/smoke-image.sh`, publishes to GHCR as `ghcr.io/kbball/meshcore-fleet-setup` multi-arch: release tags from `main`, `pr-<n>` previews for same-repo PRs, nothing for fork PRs; a weekly/PR-close workflow prunes previews). Reference layout: `~/code/sweep-tracker`.

## Targets

Seeed T-1000-E, Seeed XIAO nRF52840 + Wio-SX1262, RAK4631. All nRF52840.

## Firmware (fork kbball/MeshCore-tracker, upstream meshcore-dev/MeshCore)

- Branch `companion-usb-ble` adds envs enabling USB serial and BLE together (`-D ENABLE_USB_INTERFACE` on each `_ble` env): `Xiao_nrf52_companion_radio_usb_ble`, `t1000e_companion_radio_usb_ble`, `RAK_4631_companion_radio_usb_ble`.
- Each builds `firmware.zip` (nRF52 serial DFU package) and `firmware.hex` under `.pio/build/<env>/`.
- USB + BLE simultaneously is NOT yet tested on hardware. Verify on one board first.
- These envs exist only in the fork, so the official MeshCore flasher won't carry them.

## Design decisions

- **Runs offline at the event.** Primary: the Docker image (`docker compose up`, pulled or loaded before the event). Fallback for laptops without Docker: `make bundle` (app + firmware + `serve.py`, Python 3 stdlib). Neither needs internet. Keep all asset URLs relative (`base: './'`).

- No per-deployment compiling. One binary per board per firmware version, served by the same server as the app (same origin, so no CORS) from `FLEET_FIRMWARE_DIR`. The firmware fork (`kbball/MeshCore-tracker`) builds a fixed set of boards (`.github/ares-firmware.json` there) when a tag `ares-vX.Y.Z` is pushed and publishes a GitHub Release: `ares-firmware-<version>.tar.gz` (`manifest.json` plus `<version>/<env>.zip`, the layout this server serves), `manifest.json`, and each `.zip`. The fork's workflow checks out this repo's `scripts/build-firmware-manifest.mjs` from `main` to write the manifest, so keep that script's command line stable. Extract the tarball into `./firmware` (the go-box's `make firmware` downloads and verifies it) and mount it at `/firmware`; the published image contains no firmware. Manifest entries: `{board, env, kind, version, file, sha256}`; the app verifies sha256 before flashing. Only the `.zip` is published (about 350-500 KB each; the `.hex` is not needed). A release holds one version.
- Transport is Web Serial over USB, not Web Bluetooth (no pairing, faster, port permission is remembered). Skip BLE for batch work.
- All configuration is runtime over the companion protocol (`docs/companion_protocol.md`, command IDs in `examples/companion_radio/MyMesh.cpp` in the fork). The Python `meshcore` library is a framing reference.
- Per-node flow: (0) backup (see below); (a) flash: enter bootloader (T-1000-E needs button/double-reset, so prompt), upload DFU zip over Web Serial; (b) optional wipe: `CMD_FACTORY_RESET` or erase extrafs during DFU; (c) reconnect, since the USB port disappears and reappears on reboot/reflash; (d) configure, then read back to verify.
- Browser nRF52 serial DFU is unverified. esp-web-tools doesn't cover nRF52, so research open-source JS nRF52 DFU first.
- Commands: `CMD_SET_RADIO_PARAMS`, `CMD_SET_RADIO_TX_POWER`, `CMD_SET_CHANNEL`/`CMD_GET_CHANNEL`, `CMD_SET_ADVERT_NAME`, `CMD_SET_ADVERT_LATLON`, `CMD_IMPORT_PRIVATE_KEY`/`CMD_EXPORT_PRIVATE_KEY`, `CMD_SET_DEVICE_PIN`, `CMD_SET_DEVICE_TIME`, `CMD_SET_AUTOADD_CONFIG`, `CMD_SET_DEFAULT_FLOOD_SCOPE`, `CMD_SET_CUSTOM_VAR`.

## Backup and restore

Nodes may be brought in by other people. Backup is **opt-in per node** (a toggle in the node loop, default off, since most nodes don't need it). When the operator turns it on, read the node's current configuration and save a backup before any flash or wipe so it can be restored after the event. Companion nodes only; sweep trackers are not backed up.

- Capture over the companion protocol: device info and firmware version, radio params and TX power, all channels (`CMD_GET_CHANNEL`), advert name and lat/lon, private key (`CMD_EXPORT_PRIVATE_KEY`), flood scope, autoadd config, custom vars. Contacts are included only if the protocol exposes a way to read and restore them (to be verified). BLE PIN may not be readable; record that explicitly in the backup.
- Backup file is JSON in the same shape as a profile (so restore = apply it as a profile with `identity` import and `wipe_first: false`), plus metadata (node public key, board, firmware version, timestamp).
- The backup contains the private key and channel keys: treat as highly sensitive. The backup is always passphrase-encrypted (WebCrypto PBKDF2 + AES-GCM); the operator types the passphrase for the owner and there is no unencrypted option. The metadata needed to identify the file (board, node name, timestamp) may sit outside the encrypted payload; keys never do. Never upload it or send it through any server.
- Delivery: the browser cannot send email with an attachment on its own. Save the file locally, then offer Web Share (with file) or open a `mailto:` with recipient and subject prefilled and instruct the user to attach the file. No backend.
- Gate: when backup is enabled for a node, wipe and flash stay disabled until the backup file has been saved (user confirms). A failed backup read blocks the wipe and is reported in the results log. With backup off, nothing is gated.
- Restore flow: connect node, load backup, apply (optionally reflash the recorded firmware version), read back to verify.

## Sweep tracker nodes ("Sweep1" etc.)

A second device kind: the GPS tracker firmware on fork branch `gps-tracker` (`examples/gps_tracker/`, docs in `docs/gps_tracker.md`). It is NOT the companion firmware and does NOT speak the companion protocol. Reports feed `~/code/sweep-tracker` as plain text (`Sweep1: lat,lon alt=..ft sats=.. bat=..V mv|idle`).

- Envs: `t1000e_gps_tracker` and `Xiao_nrf52_gps_tracker` (XIAO + L76K GNSS). T-1000-E is verified on hardware; XIAO is not. RAK4631 has no tracker env. Both are nRF52840 and flash the same way as companion boards (same DFU path). Publish their `firmware.zip` through the same manifest, tagged with `kind: "tracker"`.
- The `gps-tracker` and `companion-usb-ble` branches are separate. The fork needs one build/release branch that contains both before CI can publish everything.
- Configuration is a line-based text CLI over USB serial at 115200: `get` (prints `key=value` lines), `set <key> <value>`, `set channel <psk> <name>`, `set name <name>`, `reboot`. Every command ends with an `OK` or `ERR ...` line; other lines are log noise. The device reports `min_interval` (interval floor, default 300 s), which validation must use.
- Reference implementation and behavior spec: `tools/provision_tracker.py` and its tests in the fork. Port it to TypeScript (domain: validation and command building; adapter: serial CLI), keep the validation rules identical, and cross-check against the Python tests. Read back with `get` and compare after setting; then `reboot` and reconnect (the port drops).
- Tracker profile keys: `channel_name`, `channel_psk` (base64, or 32/64 hex), `interval_sec`, `nofix_mode` (`silent|notify`), `nofix_notify_interval_sec`, `freq`, `bw`, `sf`, `cr`, `tx_power`, `idle_interval_sec`, `idle_holdoff_sec`, `fix_timeout_sec`, `move_distance_m`, `motion_threshold`. Node name is NOT in the profile; it comes per unit from a name template such as `Sweep{n}` (the name appears as the prefix in report messages, so confirm the exact format the sweep-tracker parser expects). Keep `tools/tracker_config.example.json` as the example shape.
- No wipe step and no companion-style backup: provisioning overwrites the listed settings and prefs (`/tracker_prefs`, append-only struct) persist across upgrades. A fresh flash plus provisioning is the "clean" state.
- Trackers only transmit; they never advertise or forward. Do not try to read contacts or adverts from them.
- Channel PSKs are secrets, same rules as below. Tracker configs with real keys are gitignored like the rest of `profiles/*.json`.

## Profile format

One shareable JSON file with a `kind` of `companion` (below) or `tracker` (see the sweep tracker section). A companion profile: `radio` (freq, bw, sf, cr, tx power), `channels` (ordered `{name, secret}`), `advert` (name template like `AS3-{n}`, lat/lon, flood scope), `identity` (generate per node or import), `ble_pin`, `gps` (`{enabled, interval_sec?}`, companion only; set through the node's `gps` / `gps_interval` custom variables, which exist only on a board with a detected GPS such as the T-1000-E; firmware default is off and a wipe turns it off), `wipe_first` (bool), `firmware_variant`. With `wipe_first: false`, write only the listed fields. Wiping is optional per profile.

## Secrets

Channel keys are sensitive. Profiles are loaded locally and never committed or uploaded. Gitignore `profiles/*.json` (keep an example with fake keys). Never log secrets.

## Rules carried over from the fork

Ask before flashing hardware or pushing. Keep channel keys out of git.
