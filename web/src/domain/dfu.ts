// Adafruit nRF52 bootloader serial DFU (HCI/SLIP framing). Port of adafruit-nrfutil
// (nordicsemi/dfu/dfu_transport_serial.py, util.py, crc16.py). Integers are little-endian.
import { concat, u32le } from './bytes'

export const DFU_INIT_PACKET = 1
export const DFU_START_PACKET = 3
export const DFU_DATA_PACKET = 4
export const DFU_STOP_DATA_PACKET = 5
export const DFU_UPDATE_MODE_APP = 4
export const DFU_PACKET_MAX_SIZE = 512
export const FLASH_PAGE_SIZE = 4096
export const FLASH_PAGE_ERASE_TIME_MS = 89.7
const FLASH_WORD_WRITE_TIME_MS = 0.1
export const FLASH_PAGE_WRITE_TIME_MS = (FLASH_PAGE_SIZE / 4) * FLASH_WORD_WRITE_TIME_MS
const SLIP_END = 0xc0

export function crc16(data: Uint8Array, crc = 0xffff): number {
  for (const b of data) {
    crc = ((crc >> 8) & 0x00ff) | ((crc << 8) & 0xff00)
    crc ^= b
    crc ^= (crc & 0x00ff) >> 4
    crc ^= (crc << 8) << 4
    crc ^= ((crc & 0x00ff) << 4) << 1
    crc &= 0xffff
  }
  return crc & 0xffff
}

export function slipEncode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (const b of data) {
    if (b === 0xc0) out.push(0xdb, 0xdc)
    else if (b === 0xdb) out.push(0xdb, 0xdd)
    else out.push(b)
  }
  return Uint8Array.from(out)
}

export function slipDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0xdb) {
      const n = data[++i]
      if (n === 0xdc) out.push(0xc0)
      else if (n === 0xdd) out.push(0xdb)
      else throw new Error('0xDB not followed by 0xDC or 0xDD')
    } else out.push(data[i])
  }
  return Uint8Array.from(out)
}

/** Builds HCI packets with the rolling 3-bit sequence number the bootloader expects. */
export class HciPacketizer {
  private seq = 0

  reset() {
    this.seq = 0
  }

  packet(payload: Uint8Array): Uint8Array {
    this.seq = (this.seq + 1) % 8
    const len = payload.length
    const h = [0, 0, 0, 0]
    h[0] = this.seq | (((this.seq + 1) % 8) << 3) | (1 << 6) | (1 << 7) // data integrity + reliable
    h[1] = 14 | ((len & 0x000f) << 4) // HCI packet type 14
    h[2] = (len & 0x0ff0) >> 4
    h[3] = -(h[0] + h[1] + h[2]) & 0xff
    const body = concat(Uint8Array.from(h), payload)
    const crc = crc16(body)
    const framed = concat(body, Uint8Array.of(crc & 0xff, crc >> 8))
    return concat(Uint8Array.of(SLIP_END), slipEncode(framed), Uint8Array.of(SLIP_END))
  }
}

/** Ack number carried in an ACK packet read from the device (two 0xC0 delimiters around the packet). */
export function parseAck(raw: Uint8Array): number {
  const data = slipDecode(raw)
  return (data[1] >> 3) & 0x07
}

export const dfuPayloads = {
  start: (appSize: number, mode = DFU_UPDATE_MODE_APP) =>
    concat(u32le(DFU_START_PACKET), u32le(mode), u32le(0), u32le(0), u32le(appSize)), // sd, bl, app sizes
  init: (initPacket: Uint8Array) => concat(u32le(DFU_INIT_PACKET), initPacket, Uint8Array.of(0, 0)),
  data: (chunk: Uint8Array) => concat(u32le(DFU_DATA_PACKET), chunk),
  stop: () => u32le(DFU_STOP_DATA_PACKET),
}

export const eraseWaitMs = (totalSize: number) =>
  Math.max(500, (Math.floor(totalSize / FLASH_PAGE_SIZE) + 1) * FLASH_PAGE_ERASE_TIME_MS)

/** Single-bank, application-only update: only the bootloader settings page needs time. */
export const activateWaitMs = () => FLASH_PAGE_ERASE_TIME_MS + FLASH_PAGE_WRITE_TIME_MS

export type DfuPackage = { bin: Uint8Array; dat: Uint8Array }
