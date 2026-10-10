# Plan (remaining work)

1. Flash a `_usb_ble` env on one board; confirm USB and BLE work together.
2. Web Serial prototype page: backup, configure and verify one node.
3. Browser DFU flashing for nRF52 boards (research JS nRF52 DFU libs first).
4. CI workflow in the fork to build and publish firmware + manifest to this app's Pages site on tag (needs cross-repo token/dispatch; retain last N versions).
5. Backup/restore (opt-in per node, always passphrase-encrypted): read config, encrypted JSON file, mailto/Web Share delivery, wipe gate, restore flow.
6. Sweep tracker support: TS port of `provision_tracker.py` (CLI adapter, validation), `kind: tracker` profiles, name template `Sweep{n}`, merge `gps-tracker` + `companion-usb-ble` into one fork release branch, add tracker envs to the manifest and CI.
7. Batch UX: next-node loop, per-node name counter, results log.

Open: scaffold (Vite/React/TS, Makefile, VERSION, CHANGELOG, CI) not yet created.
