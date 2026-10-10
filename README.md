# MeshCore Fleet Setup

Chrome web app that flashes and configures batches of MeshCore nodes over Web Serial before an event. Three kinds of node:

- **Companion** nodes for people (radio, channels, name, location, identity, BLE PIN; optional wipe; optional encrypted backup).
- **Gateways** (RAK4631 + Ethernet, the station's link to the go-box): configured like a companion, without a BLE PIN. Its address comes from DHCP: reserve it by MAC on the AREDN node.
- **Sweep trackers** (GPS tracker firmware, configured through its text CLI).

The **Event** tab builds one event file (channel secrets, stations, trackers, firmware release) and derives every device's profile and the go-box settings from it, so station radios, gateways, trackers and the apps always agree on channel indexes and keys.

Design notes and rules are in `CLAUDE.md`; remaining work in `plan.md`.

## Use

1. Open the app in Chrome or Edge on desktop.
2. Build a profile in the **Profile builder** tab (or load a file; `profiles/*.example.json` show the shape). Profiles contain keys: they stay in memory, are never uploaded, and `profiles/*.json` is gitignored.
3. Plug in a node, tick Flash if it needs firmware, tick Back up (with a passphrase) only for nodes someone else owns, click **Run next node**.
4. The results log lists every node; download it as CSV.

Firmware is fetched from `./firmware/manifest.json` on the same site and checked against its sha256 before flashing.

## Run it (Docker)

```
docker compose up          # http://localhost:8080, firmware from ./firmware
```

or `make image && docker run -p 127.0.0.1:8080:8080 ghcr.io/kbball/meshcore-fleet-setup`. The image is about 17 MB, distroless, non-root, has a healthcheck, and works with no internet. Pull or `docker save` it before the event.

Server settings are environment variables (`.env.example`): `FLEET_ADDR`, `FLEET_FIRMWARE_DIR`, `LOG_LEVEL`. At startup it checks every firmware file against `manifest.json` and logs any that is missing or does not match.

## The image has no firmware

The published image (`ghcr.io/kbball/meshcore-fleet-setup`) bakes in whatever was in `./firmware` when it was built, and the repository's `firmware/` holds nothing but a `.gitkeep`. So the published image has **no firmware**: the app loads, logs `firmware manifest … no such file or directory`, and cannot flash. Mount a directory containing `manifest.json` and the zips at `/firmware` (the compose file above does this with `./firmware`), or build the image yourself with a populated `./firmware`.

## Getting firmware

Firmware comes from a GitHub Release of the firmware fork, [kbball/MeshCore-tracker](https://github.com/kbball/MeshCore-tracker/releases). Pushing a tag like `ares-v1.0.0` there builds every board the team uses and publishes `ares-firmware-<version>.tar.gz`: `manifest.json` plus `<version>/<env>.zip`, ready to extract into `./firmware`. On the go-box, `make firmware` does the download and sha256 check for you (set `FIRMWARE_TAG` in its `.env`). `scripts/build-firmware-manifest.mjs` (used by the fork's workflow) builds the manifest from local zips if you want to assemble a folder by hand.

## Secure context and the field server

Web Serial only works on `http://localhost` or over HTTPS. Running it on your own laptop is fine as is (the compose file binds it to `127.0.0.1` only). To use it from other laptops on a field server, serve it over HTTPS: the [aredn-go-box](https://github.com/kbball/aredn-go-box) `fleet-mgmt` stack does this at `https://<host>/fleet/` behind a Caddy proxy with its own certificate (each laptop trusts that certificate once). Asset URLs are relative, so the app works under a path like `/fleet/`. The `fleet-mgmt` stack there mounts its own `firmware/` folder and will not deploy until it has a `manifest.json`.

## How it fits with the other event tools

- **Sweep trackers** configured here report to [sweep-tracker](https://github.com/kbball/sweep-tracker); the tracker name you set here is the name you give the team under *Admin → Sweep teams* there.
- **Channels:** the channels in your profile are what the radios, the MeshCore node on the field server and the [bib logger](https://github.com/kbball/ares-bib-logger) share. The bib logger listens on the channel index set by `MESHCORE_CHANNEL_INDEX`, so keep it in step with the profile.

## No Docker on the laptop

`make bundle FIRMWARE=<dir with manifest.json>` writes `dist-bundle/fleet-setup-<VERSION>.zip` with the app, the firmware and `serve.py`. Unzip, `python3 serve.py`, use Chrome or Edge.

## Develop

```
make run      # build the frontend and serve it from Go on :8080
make test     # go vet + race tests
make web-test # frontend type check + tests
make cover web-cover
make lint
make check    # all of the above
make smoke    # build the image and run real requests through it
```

Frontend dev server with hot reload: `cd web && npm run dev`.

Status: all logic is unit tested against in-memory fakes, and the image passes its smoke test. The Web Serial / DFU adapters have not been run on hardware yet (see `docs/hardware-checklist.md`).
