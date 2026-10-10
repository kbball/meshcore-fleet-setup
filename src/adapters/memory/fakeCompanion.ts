import { concat, fixedString, i32le, u32le, utf8, cString, fromUtf8 } from '../../domain/bytes'
import { CMD, RESP, encodeFrame, FrameDecoder } from '../../domain/companion'
import type { FrameLink } from '../../app/ports'

export type FakeCompanionState = {
  name: string
  publicKey: Uint8Array
  privateKey: Uint8Array
  lat: number
  lon: number
  freq: number // MHz
  bw: number // kHz
  sf: number
  cr: number
  txPower: number
  blePin: number
  channels: { name: string; secret: Uint8Array }[]
  floodScope: { name: string; key: Uint8Array } | null
  autoadd: { config: number; maxHops: number }
  time: number
  firmwareVersion: string
  manufacturer: string
  privateKeyExport: boolean
}

const PUBLIC_SECRET = Uint8Array.from([
  0x8b, 0x33, 0x87, 0xe9, 0xc5, 0xcd, 0xea, 0x6a, 0xc9, 0xe5, 0xed, 0xba, 0xa1, 0x15, 0xcd, 0x72,
])

export function freshCompanionState(seed = 1): FakeCompanionState {
  const key = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff)
  return {
    name: `MeshCore-${seed.toString(16).padStart(8, '0')}`,
    publicKey: key(32),
    privateKey: key(64),
    lat: 0,
    lon: 0,
    freq: 915,
    bw: 250,
    sf: 10,
    cr: 5,
    txPower: 20,
    blePin: 0,
    channels: [{ name: 'Public', secret: PUBLIC_SECRET }],
    floodScope: null,
    autoadd: { config: 0, maxHops: 0 },
    time: 1000,
    firmwareVersion: 'v1.12.0-fake',
    manufacturer: 'Fake Board',
    privateKeyExport: true,
  }
}

const MAX_CHANNELS = 8

/** In-memory companion node speaking the real wire format, for tests and hardware-free development. */
export class FakeCompanionLink implements FrameLink {
  sent: number[][] = []
  closed = false
  resets = 0
  /** Hooks for tests to make a command fail: command byte -> error code. */
  failWith: Record<number, number> = {}
  private out: Uint8Array[] = []

  constructor(public state: FakeCompanionState = freshCompanionState()) {}

  async send(payload: Uint8Array): Promise<void> {
    this.sent.push(Array.from(payload))
    const reply = this.handle(payload)
    if (reply) this.out.push(reply)
  }
  async receive(): Promise<Uint8Array | null> {
    return this.out.shift() ?? null
  }
  async drain(): Promise<void> {
    this.out = []
  }
  async close(): Promise<void> {
    this.closed = true
  }

  private ok = () => Uint8Array.of(RESP.OK)
  private err = (code: number) => Uint8Array.of(RESP.ERR, code)

  private handle(f: Uint8Array): Uint8Array | null {
    const s = this.state
    const c = f[0]
    if (this.failWith[c] !== undefined) return this.err(this.failWith[c])
    const dv = new DataView(f.buffer, f.byteOffset, f.byteLength)
    switch (c) {
      case CMD.APP_START:
        this.out.push(Uint8Array.of(0x83)) // an unsolicited push the client must skip
        return concat(
          Uint8Array.of(RESP.SELF_INFO, 1, s.txPower, 30),
          s.publicKey,
          i32le(Math.round(s.lat * 1e6)),
          i32le(Math.round(s.lon * 1e6)),
          Uint8Array.of(0, 0, 0, 0),
          u32le(Math.round(s.freq * 1000)),
          u32le(Math.round(s.bw * 1000)),
          Uint8Array.of(s.sf, s.cr),
          utf8(s.name),
        )
      case CMD.DEVICE_QUERY:
        return concat(
          Uint8Array.of(RESP.DEVICE_INFO, 12, 50, MAX_CHANNELS),
          u32le(s.blePin),
          fixedString('10-Oct-2026', 12),
          fixedString(s.manufacturer, 40),
          fixedString(s.firmwareVersion, 20),
          Uint8Array.of(0, 0),
        )
      case CMD.SET_DEVICE_TIME: {
        const t = dv.getUint32(1, true)
        if (t < s.time) return this.err(6)
        s.time = t
        return this.ok()
      }
      case CMD.SET_ADVERT_NAME:
        s.name = fromUtf8(f.subarray(1))
        return this.ok()
      case CMD.SET_ADVERT_LATLON:
        s.lat = dv.getInt32(1, true) / 1e6
        s.lon = dv.getInt32(5, true) / 1e6
        return this.ok()
      case CMD.SET_RADIO_PARAMS:
        s.freq = dv.getUint32(1, true) / 1000
        s.bw = dv.getUint32(5, true) / 1000
        s.sf = f[9]
        s.cr = f[10]
        return this.ok()
      case CMD.SET_RADIO_TX_POWER:
        s.txPower = dv.getInt8(1)
        return this.ok()
      case CMD.GET_CHANNEL: {
        const ch = s.channels[f[1]]
        if (!ch) return this.err(2)
        return concat(Uint8Array.of(RESP.CHANNEL_INFO, f[1]), fixedString(ch.name, 32), ch.secret)
      }
      case CMD.SET_CHANNEL:
        if (f[1] >= MAX_CHANNELS) return this.err(2)
        s.channels[f[1]] = { name: cString(f.subarray(2, 34)), secret: f.slice(34, 50) }
        return this.ok()
      case CMD.EXPORT_PRIVATE_KEY:
        return s.privateKeyExport
          ? concat(Uint8Array.of(RESP.PRIVATE_KEY), s.privateKey)
          : Uint8Array.of(RESP.DISABLED)
      case CMD.IMPORT_PRIVATE_KEY:
        s.privateKey = f.slice(1, 65)
        s.publicKey = f.slice(33, 65) // stand-in for key derivation
        return this.ok()
      case CMD.SET_DEVICE_PIN:
        s.blePin = dv.getUint32(1, true)
        return this.ok()
      case CMD.GET_CUSTOM_VARS:
        return concat(Uint8Array.of(RESP.CUSTOM_VARS), utf8('gps:0'))
      case CMD.GET_AUTOADD_CONFIG:
        return Uint8Array.of(RESP.AUTOADD_CONFIG, s.autoadd.config, s.autoadd.maxHops)
      case CMD.SET_AUTOADD_CONFIG:
        s.autoadd = { config: f[1], maxHops: f.length > 2 ? f[2] : s.autoadd.maxHops }
        return this.ok()
      case CMD.GET_DEFAULT_FLOOD_SCOPE:
        return s.floodScope
          ? concat(
              Uint8Array.of(RESP.DEFAULT_FLOOD_SCOPE),
              fixedString(s.floodScope.name, 31),
              s.floodScope.key,
            )
          : Uint8Array.of(RESP.DEFAULT_FLOOD_SCOPE)
      case CMD.SET_DEFAULT_FLOOD_SCOPE:
        s.floodScope = f.length >= 48 ? { name: cString(f.subarray(1, 32)), key: f.slice(32, 48) } : null
        return this.ok()
      case CMD.FACTORY_RESET: {
        this.resets++
        const fresh = freshCompanionState(100 + this.resets)
        fresh.time = s.time
        this.state = fresh
        return this.ok()
      }
      default:
        return this.err(1)
    }
  }
}

/** Run frames through the real framing, to prove the codec round trips. */
export function roundTrip(payload: Uint8Array): Uint8Array[] {
  return new FrameDecoder().push(encodeFrame(payload).map((b, i) => (i === 0 ? 0x3e : b)))
}
