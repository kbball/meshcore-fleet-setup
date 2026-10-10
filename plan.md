# Plan (remaining work)

Everything below needs hardware or an external action; the code for the original five steps exists and is unit tested against fakes.

1. **Hardware verification, in this order** (see `docs/hardware-checklist.md`). Ask before flashing anything.
   - Flash one board with a `_usb_ble` env and confirm USB and BLE work at the same time.
   - Provision the T-1000-E tracker from the app (the tracker CLI path is the best understood).
   - Companion configure + verify, backup, wipe, restore on one spare board.
   - Browser DFU on each board type (1200 baud touch, bootloader port discovery, re-enumeration).
2. **Fork**: create one release branch containing both `companion-usb-ble` and `gps-tracker`; copy `docs/fork/publish-firmware.yml` to the fork's workflows; add the `FLEET_SETUP_TOKEN` secret.
3. **This repo on GitHub**: enable Pages (source: GitHub Actions); protect `main` with the `Frontend` check.
4. Verify against the protocol where the code assumed:
   - Flood scope key: the profile takes an explicit 16-byte key; check how the official app derives it from a region name and add that.
   - Hashtag channels (`#name`): the profile takes explicit secrets only; add derivation if wanted.
   - Whether contacts can be read/restored over the protocol (backups do not include them).
   - Restore does not reflash the firmware version recorded in the backup.
5. Try `make bundle` on the actual event laptop OS (needs Python 3; Windows laptops may need it installed).
6. Smoke test script / container image: not applicable (static site), so CI builds and deploys Pages instead.

## Decisions

- Firmware is hosted on this app's own Pages site (same origin, no CORS). The fork pushes an orphan `firmware` branch holding `manifest.json` and the newest 5 versions; the Deploy workflow merges it into the site.
- Backups are opt-in per node, always passphrase-encrypted (PBKDF2-SHA256 600k + AES-GCM), delivered by download plus a prefilled `mailto:` (browsers cannot attach files).
- Trackers have no wipe or backup; flash + provision is the clean state.
