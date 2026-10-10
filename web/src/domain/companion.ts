// MeshCore companion protocol over USB serial. Source of truth: examples/companion_radio/MyMesh.cpp and
// src/helpers/ArduinoSerialInterface.cpp in the firmware fork. Integers are little-endian.
import { cString, concat, fixedString, fromUtf8, i32le, u32le, utf8 } from './bytes'

export const CMD = {
  APP_START: 1,
  SET_DEVICE_TIME: 6,
  SET_ADVERT_NAME: 8,
  SET_RADIO_PARAMS: 11,
  SET_RADIO_TX_POWER: 12,
  SET_ADVERT_LATLON: 14,
  REBOOT: 19,
  DEVICE_QUERY: 22,
  EXPORT_PRIVATE_KEY: 23,
  IMPORT_PRIVATE_KEY: 24,
  GET_CHANNEL: 31,
  SET_CHANNEL: 32,
  SET_DEVICE_PIN: 37,
  GET_CUSTOM_VARS: 40,
  SET_CUSTOM_VAR: 41,
  FACTORY_RESET: 51,
  SET_AUTOADD_CONFIG: 58,
  GET_AUTOADD_CONFIG: 59,
  SET_DEFAULT_FLOOD_SCOPE: 63,
  GET_DEFAULT_FLOOD_SCOPE: 64,
} as const

export const RESP = {
  OK: 0,
  ERR: 1,
  SELF_INFO: 5,
  DEVICE_INFO: 13,
  PRIVATE_KEY: 14,
  DISABLED: 15,
  CHANNEL_INFO: 18,
  CUSTOM_VARS: 21,
  AUTOADD_CONFIG: 25,
  DEFAULT_FLOOD_SCOPE: 28,
} as const

export const ERR_CODES: Record<number, string> = {
  1: 'unsupported command',
  2: 'not found',
  3: 'table full',
  4: 'bad state',
  5: 'file I/O error',
  6: 'illegal argument',
}
export const ERR_ILLEGAL_ARG = 6

export const PUB_KEY_SIZE = 32
export const CHANNEL_NAME_SIZE = 32
export const CHANNEL_SECRET_SIZE = 16
export const SCOPE_NAME_SIZE = 31
export const PUSH_MIN = 0x80 // frames with the high bit set are unsolicited pushes

/** Host -> device frame: '<' + u16 length + payload. */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffff) throw new Error('frame too large')
  return concat(Uint8Array.of(0x3c, payload.length & 0xff, payload.length >> 8), payload)
}

/**
 * Streaming decoder for device -> host frames ('>' + u16 length + payload). Bytes outside a frame
 * (debug text printed on the same port) are skipped.
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0)

  push(chunk: Uint8Array): Uint8Array[] {
    this.buf = concat(this.buf, chunk)
    const frames: Uint8Array[] = []
    for (;;) {
      const start = this.buf.indexOf(0x3e)
      if (start < 0) {
        this.buf = new Uint8Array(0)
        break
      }
      if (this.buf.length < start + 3) {
        this.buf = this.buf.subarray(start)
        break
      }
      const len = this.buf[start + 1] | (this.buf[start + 2] << 8)
      if (this.buf.length < start + 3 + len) {
        this.buf = this.buf.subarray(start)
        break
      }
      frames.push(this.buf.slice(start + 3, start + 3 + len))
      this.buf = this.buf.subarray(start + 3 + len)
    }
    return frames
  }
}

// ---- commands -------------------------------------------------------------------------------

export const cmd = {
  appStart: (appName = 'fleet-setup') =>
    concat(Uint8Array.of(CMD.APP_START, 0, 0, 0, 0, 0, 0, 0), utf8(appName)),
  deviceQuery: () => Uint8Array.of(CMD.DEVICE_QUERY, 3),
  setDeviceTime: (epochSecs: number) => concat(Uint8Array.of(CMD.SET_DEVICE_TIME), u32le(epochSecs)),
  setAdvertName: (name: string) => concat(Uint8Array.of(CMD.SET_ADVERT_NAME), utf8(name)),
  setAdvertLatLon: (lat: number, lon: number) =>
    concat(Uint8Array.of(CMD.SET_ADVERT_LATLON), i32le(Math.round(lat * 1e6)), i32le(Math.round(lon * 1e6))),
  setRadioParams: (r: { freq: number; bw: number; sf: number; cr: number }) =>
    concat(
      Uint8Array.of(CMD.SET_RADIO_PARAMS),
      u32le(Math.round(r.freq * 1000)), // MHz -> kHz
      u32le(Math.round(r.bw * 1000)), // kHz -> Hz
      Uint8Array.of(r.sf, r.cr),
    ),
  setTxPower: (dbm: number) => Uint8Array.of(CMD.SET_RADIO_TX_POWER, dbm & 0xff),
  getChannel: (idx: number) => Uint8Array.of(CMD.GET_CHANNEL, idx),
  setChannel: (idx: number, name: string, secret: Uint8Array) => {
    if (secret.length !== CHANNEL_SECRET_SIZE) throw new Error('channel secret must be 16 bytes')
    return concat(Uint8Array.of(CMD.SET_CHANNEL, idx), fixedString(name, CHANNEL_NAME_SIZE), secret)
  },
  exportPrivateKey: () => Uint8Array.of(CMD.EXPORT_PRIVATE_KEY),
  importPrivateKey: (key: Uint8Array) => {
    if (key.length !== 64) throw new Error('private key must be 64 bytes')
    return concat(Uint8Array.of(CMD.IMPORT_PRIVATE_KEY), key)
  },
  setDevicePin: (pin: number) => concat(Uint8Array.of(CMD.SET_DEVICE_PIN), u32le(pin)),
  getCustomVars: () => Uint8Array.of(CMD.GET_CUSTOM_VARS),
  setCustomVar: (name: string, value: string) =>
    concat(Uint8Array.of(CMD.SET_CUSTOM_VAR), utf8(`${name}:${value}`)),
  getAutoadd: () => Uint8Array.of(CMD.GET_AUTOADD_CONFIG),
  setAutoadd: (config: number, maxHops?: number) =>
    maxHops === undefined
      ? Uint8Array.of(CMD.SET_AUTOADD_CONFIG, config)
      : Uint8Array.of(CMD.SET_AUTOADD_CONFIG, config, maxHops),
  getDefaultFloodScope: () => Uint8Array.of(CMD.GET_DEFAULT_FLOOD_SCOPE),
  setDefaultFloodScope: (name: string, key: Uint8Array) => {
    if (key.length !== 16) throw new Error('flood scope key must be 16 bytes')
    return concat(Uint8Array.of(CMD.SET_DEFAULT_FLOOD_SCOPE), fixedString(name, SCOPE_NAME_SIZE), key)
  },
  clearDefaultFloodScope: () => Uint8Array.of(CMD.SET_DEFAULT_FLOOD_SCOPE),
  factoryReset: () => concat(Uint8Array.of(CMD.FACTORY_RESET), utf8('reset')),
  reboot: () => concat(Uint8Array.of(CMD.REBOOT), utf8('reboot')),
}

// ---- responses ------------------------------------------------------------------------------

export type SelfInfo = {
  txPower: number
  maxTxPower: number
  publicKey: Uint8Array
  lat: number
  lon: number
  freq: number // MHz
  bw: number // kHz
  sf: number
  cr: number
  name: string
}

export type DeviceInfo = {
  firmwareVerCode: number
  maxContacts: number
  maxChannels: number
  blePin: number
  buildDate: string
  manufacturer: string
  firmwareVersion: string
}

export type ChannelInfo = { index: number; name: string; secret: Uint8Array }
export type FloodScope = { name: string; key: Uint8Array } | null

function expect(frame: Uint8Array, code: number, minLen: number): DataView {
  if (frame[0] !== code || frame.length < minLen) {
    throw new Error(`unexpected reply (code ${frame[0]}, ${frame.length} bytes; wanted code ${code})`)
  }
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
}

export function parseSelfInfo(f: Uint8Array): SelfInfo {
  const v = expect(f, RESP.SELF_INFO, 58)
  return {
    txPower: v.getInt8(2),
    maxTxPower: v.getInt8(3),
    publicKey: f.slice(4, 4 + PUB_KEY_SIZE),
    lat: v.getInt32(36, true) / 1e6,
    lon: v.getInt32(40, true) / 1e6,
    freq: v.getUint32(48, true) / 1000,
    bw: v.getUint32(52, true) / 1000,
    sf: f[56],
    cr: f[57],
    name: fromUtf8(f.subarray(58)),
  }
}

export function parseDeviceInfo(f: Uint8Array): DeviceInfo {
  const v = expect(f, RESP.DEVICE_INFO, 80)
  return {
    firmwareVerCode: f[1],
    maxContacts: f[2] * 2,
    maxChannels: f[3],
    blePin: v.getUint32(4, true),
    buildDate: cString(f.subarray(8, 20)),
    manufacturer: cString(f.subarray(20, 60)),
    firmwareVersion: cString(f.subarray(60, 80)),
  }
}

export function parseChannelInfo(f: Uint8Array): ChannelInfo {
  expect(f, RESP.CHANNEL_INFO, 2 + CHANNEL_NAME_SIZE + CHANNEL_SECRET_SIZE)
  return { index: f[1], name: cString(f.subarray(2, 34)), secret: f.slice(34, 50) }
}

export function parsePrivateKey(f: Uint8Array): Uint8Array {
  expect(f, RESP.PRIVATE_KEY, 65)
  return f.slice(1, 65)
}

export function parseCustomVars(f: Uint8Array): Record<string, string> {
  expect(f, RESP.CUSTOM_VARS, 1)
  const out: Record<string, string> = {}
  const text = fromUtf8(f.subarray(1))
  if (!text) return out
  for (const pair of text.split(',')) {
    const i = pair.indexOf(':')
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return out
}

export function parseAutoadd(f: Uint8Array): { config: number; maxHops: number } {
  expect(f, RESP.AUTOADD_CONFIG, 3)
  return { config: f[1], maxHops: f[2] }
}

export function parseFloodScope(f: Uint8Array): FloodScope {
  expect(f, RESP.DEFAULT_FLOOD_SCOPE, 1)
  if (f.length < 1 + SCOPE_NAME_SIZE + 16) return null
  return {
    name: cString(f.subarray(1, 1 + SCOPE_NAME_SIZE)),
    key: f.slice(1 + SCOPE_NAME_SIZE, 1 + SCOPE_NAME_SIZE + 16),
  }
}
