# MeshCore Fleet Setup

Chrome web app that flashes and configures batches of MeshCore nodes over Web Serial before an event. Two kinds of node:

- **Companion** nodes for people (radio, channels, name, location, identity, BLE PIN; optional wipe; optional encrypted backup).
- **Sweep trackers** (GPS tracker firmware, configured through its text CLI).

Design notes and rules are in `CLAUDE.md`; remaining work in `plan.md`.

## Use

1. Open the app in Chrome or Edge on desktop.
2. Load a profile file (`profiles/*.example.json` show the shape; real profiles contain keys, stay in memory and are gitignored).
3. Plug in a node, tick Flash if it needs firmware, tick Back up (with a passphrase) only for nodes someone else owns, click **Run next node**.
4. The results log lists every node; download it as CSV.

Firmware is fetched from `./firmware/manifest.json` on the same site and checked against its sha256 before flashing.

## Develop

```
make install
make run      # dev server
make test     # type check + unit tests
make cover    # fails under 80%
make lint
```

Status: all logic is unit tested against in-memory fakes. The Web Serial / DFU adapters have not been run on hardware yet (see `docs/hardware-checklist.md`).
