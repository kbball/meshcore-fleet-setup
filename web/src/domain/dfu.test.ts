import { bytesToHex, hexToBytes } from './bytes'
import {
  HciPacketizer,
  activateWaitMs,
  crc16,
  dfuPayloads,
  eraseWaitMs,
  parseAck,
  slipDecode,
  slipEncode,
} from './dfu'

// Vectors generated with adafruit-nrfutil (nordicsemi.dfu) from PlatformIO.
describe('dfu framing matches adafruit-nrfutil', () => {
  it('crc16', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(10673)
  })

  it('start packet (sequence 1) and a data packet (sequence 2) with escaped bytes', () => {
    const h = new HciPacketizer()
    expect(bytesToHex(h.packet(dfuPayloads.start(1234)))).toBe(
      'c0d14e01e003000000040000000000000000000000d2040000dbdc36c0',
    )
    expect(
      bytesToHex(h.packet(dfuPayloads.data(Uint8Array.of(0, 0, 0, 0xc0, 0xdb, 1, 2)).subarray(0)).slice(0)),
    ).not.toBe('')
  })

  it('escapes 0xC0 and 0xDB in data', () => {
    const h = new HciPacketizer()
    h.packet(new Uint8Array(1)) // sequence 1
    const p = h.packet(Uint8Array.of(4, 0, 0, 0, 0xc0, 0xdb, 1, 2)) // sequence 2
    expect(bytesToHex(p)).toBe('c0da8e009804000000dbdcdbdd0102b6fcc0')
  })

  it('wraps the sequence number at 8', () => {
    const h = new HciPacketizer()
    const seqs = Array.from({ length: 9 }, () => h.packet(new Uint8Array(1))[1] & 7)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1])
    h.reset()
    expect(h.packet(new Uint8Array(1))[1] & 7).toBe(1)
  })
})

describe('slip', () => {
  it('round trips', () => {
    const d = Uint8Array.of(1, 0xc0, 0xdb, 2)
    expect(slipDecode(slipEncode(d))).toEqual(d)
  })
  it('rejects a bad escape', () => {
    expect(() => slipDecode(Uint8Array.of(0xdb, 0x01))).toThrow(/0xDB/)
  })
})

describe('ack', () => {
  it('reads the ack number from the header', () => {
    // header byte0 = seq | ack<<3 ...: ack 5
    expect(parseAck(hexToBytes('c0' + ((5 << 3) | 1).toString(16).padStart(2, '0') + '00000000c0'))).toBe(5)
  })
})

describe('timing', () => {
  it('waits at least half a second for erase and scales with size', () => {
    expect(eraseWaitMs(10)).toBe(500)
    expect(eraseWaitMs(400_000)).toBeGreaterThan(8000)
    expect(activateWaitMs()).toBeGreaterThan(100)
  })
})
