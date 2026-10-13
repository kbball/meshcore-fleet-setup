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

- [ ] T-1000-E: profile with `gps.enabled: true` turns the GPS on (check a position appears); a XIAO/RAK with `enabled: true` fails with the "no GPS" message.

## 3. Browser DFU (each board type)

- [ ] Does the 1200 baud touch enter the bootloader? (T-1000-E may need a button / double reset: the app prompts.)
- [ ] Is the bootloader port found automatically, or does the app need the prompt + port chooser?
- [ ] Does the application port come back after flashing and is it picked up again (same USB ids)?
- [ ] Flash completes and the new firmware version shows in a backup / device query.
- [ ] Runner alert board (XIAO nRF52840 + Wio-SX1262, see section 4): same four checks once the app accepts its kind. Until then flash it with PlatformIO.

Record what differs from the assumptions in `src/adapters/webserial/connector.ts` and fix it there.

## 4. Runner alert (early-warning MeshCore board)

A new device type: the MeshCore board of the runner early-warning node (XIAO nRF52840 + Wio-SX1262, optional L76K
GNSS module). Firmware: fork branch `feature/runner-alert`, env `Xiao_nrf52_runner_alert`, docs in the fork's
`docs/runner_alert.md`. **The app does not know this kind yet** (the manifest kind and the profile, Event tab and CLI
provisioning are still to be built; the fork's `docs/ares_firmware.md` has the order), so until then flash it with
PlatformIO and drive it over USB serial. Nothing here has run on a radio yet. Ask before flashing.

Bench, without the camera:

- [ ] Flash `Xiao_nrf52_runner_alert`; over USB serial `ver` prints `runner_alert v1` and `get` lists the settings.
- [ ] Provision by CLI: `set name`, `set channel <psk> <name>`, `set freq|bw|sf|cr|tx`, `reboot`, then `get` reads the values back.
- [ ] `test` sends `<name>: test bat=<V>` and it arrives on the channel with the right sender-name prefix.
- [ ] `cam EW,VERDICT,1,PERSON,90` sends `<name>: runner score=90 bat=<V>`; a second one within 20 s prints "alert suppressed" and sends nothing; one after 20 s sends.
- [ ] `cam EW,VERDICT,1,NONE,4` sends nothing.
- [ ] Heartbeat: `<name>: alive bat=<V> alerts=<n>` arrives about 15 s after boot (use `set status_interval 300` to see a second one).
- [ ] The node never advertises and never repeats: a second radio does not see an advert from it, and it does not forward a packet sent from another node.
- [ ] Clock: `status` shows `source=none` at first; `set time <epoch>` changes it; after `reboot` the time is restored (`source=saved`).

With the L76K module fitted (D6/D7):

- [ ] `status` shows `gps=fix` and `source=gps` after a fix, and the time is right (try outdoors, with a clear sky).
- [ ] With no fix (indoors), the node still runs and `set time` works.
- [ ] Measure the current draw with the GPS on, since it has no enable pin and runs all the time (the estimate of tens of mA is unmeasured).

With the real camera (its TX wired to this board's D0, common ground):

- [ ] Camera lines are counted in `status` (`camera_lines`), and the ESP32's power-up boot text lands in `noise_lines` only.
- [ ] A real PERSON verdict from the camera becomes a channel message; the camera's TX line still works with the trigger board listening on the same wire.
- [ ] Check how D0 is wired on the Wio-SX1262 board (MeshCore treats it as a user button): pressing a button there must not matter, or the line needs a different pin.

Fleet tool, once the app supports the kind:

- [ ] The manifest lists the new kind and the app flashes this board (section 3 checks).
- [ ] A runner alert profile configures it and verifies, and the Event tab can include these nodes.
- [ ] The go-box and apps that show channel messages recognise `runner score=...` and `alive bat=...`.
