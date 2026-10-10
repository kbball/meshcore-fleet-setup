# MeshCore Fleet Setup

Chrome web app that flashes and configures batches of MeshCore nodes over Web Serial before an event. Two kinds of node:

- **Companion** nodes for people (radio, channels, name, location, identity, BLE PIN; optional wipe; optional encrypted backup).
- **Sweep trackers** (GPS tracker firmware, configured through its text CLI).

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

## Getting firmware

The firmware fork publishes `manifest.json` plus `<version>/<env>.zip` (see `docs/fork/publish-firmware.yml`). Put them in `./firmware`. `scripts/build-firmware-manifest.mjs` builds the manifest from local zips.

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
