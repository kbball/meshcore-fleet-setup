# Hardware verification checklist

Nothing in the Web Serial or DFU adapters has touched a real board yet. Use a spare board, Chrome desktop, and a USB data cable. Ask before flashing.

## 0. Firmware (in the fork)

- [ ] Flash `*_companion_radio_usb_ble` on one board with PlatformIO; connect over USB serial and over BLE at the same time.

## 1. Tracker (T-1000-E)

- [ ] Load `profiles/tracker.example.json` (with your real key), Flash off, run next node: configure + verify passes, node reboots.
- [ ] Confirm reports arrive on the channel with the name `Sweep<n>`.

## 2. Companion

- [ ] Flash off, wipe_first false, radio only: values read back correctly.
- [ ] Backup on: file downloads, wrong passphrase is rejected, right one restores name, channels and identity (public key unchanged).
- [ ] wipe_first true: node comes back with a new identity, then gets configured.
- [ ] Check what private key export returns on your firmware (`ENABLE_PRIVATE_KEY_EXPORT=1` is set in the root platformio.ini).

## 3. Browser DFU (each board type)

- [ ] Does the 1200 baud touch enter the bootloader? (T-1000-E may need a button / double reset: the app prompts.)
- [ ] Is the bootloader port found automatically, or does the app need the prompt + port chooser?
- [ ] Does the application port come back after flashing and is it picked up again (same USB ids)?
- [ ] Flash completes and the new firmware version shows in a backup / device query.

Record what differs from the assumptions in `src/adapters/webserial/connector.ts` and fix it there.
