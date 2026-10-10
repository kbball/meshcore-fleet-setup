import { bytesToHex, concat, fixedString, u32le, utf8 } from './bytes'
import {
  FrameDecoder,
  cmd,
  encodeFrame,
  parseAutoadd,
  parseChannelInfo,
  parseCustomVars,
  parseDeviceInfo,
  parseFloodScope,
  parsePrivateKey,
  parseSelfInfo,
} from './companion'

describe('framing', () => {
  it('encodes host frames with < and a little-endian length', () => {
    expect(bytesToHex(encodeFrame(Uint8Array.of(22, 3)))).toBe('3c02001603')
  })

  it('decodes frames split across chunks and skips debug text between them', () => {
    const d = new FrameDecoder()
    const a = Uint8Array.of(0x3e, 2, 0, 9, 8)
    const text = utf8('debug line\n')
    const b = Uint8Array.of(0x3e, 1, 0, 7)
    const all = concat(text, a, text, b)
    const out = [...d.push(all.subarray(0, 4)), ...d.push(all.subarray(4, 9)), ...d.push(all.subarray(9))]
    expect(out.map((f) => Array.from(f))).toEqual([[9, 8], [7]])
  })

  it('discards buffered bytes that contain no frame start', () => {
    const d = new FrameDecoder()
    expect(d.push(utf8('no frames here'))).toEqual([])
    expect(d.push(Uint8Array.of(0x3e, 1, 0, 5))).toHaveLength(1)
  })

  it('refuses oversize payloads', () => {
    expect(() => encodeFrame(new Uint8Array(70000))).toThrow(/too large/)
  })
})

describe('command encoders', () => {
  it('app start has 7 reserved bytes then the name', () => {
    expect(bytesToHex(cmd.appStart('ab'))).toBe('0100000000000000' + '6162')
  })
  it('radio params are kHz and Hz, little endian', () => {
    // 910.525 MHz -> 910525 kHz = 0x000DE4BD; 62.5 kHz -> 62500 Hz = 0xF424
    expect(bytesToHex(cmd.setRadioParams({ freq: 910.525, bw: 62.5, sf: 7, cr: 5 }))).toBe(
      '0bbde40d00' + '24f40000' + '0705',
    )
  })
  it('tx power is a signed byte', () => {
    expect(Array.from(cmd.setTxPower(-3))).toEqual([12, 253])
  })
  it('lat/lon are signed micro-degrees', () => {
    const f = cmd.setAdvertLatLon(33.89057, -84.16948)
    const dv = new DataView(f.buffer)
    expect(dv.getInt32(1, true)).toBe(33890570)
    expect(dv.getInt32(5, true)).toBe(-84169480)
  })
  it('channel is index, 32 byte name, 16 byte secret', () => {
    const f = cmd.setChannel(2, 'race', new Uint8Array(16).fill(1))
    expect(f.length).toBe(2 + 32 + 16)
    expect(f[1]).toBe(2)
    expect(() => cmd.setChannel(0, 'x', new Uint8Array(5))).toThrow(/16 bytes/)
    expect(() => cmd.setChannel(0, 'x'.repeat(32), new Uint8Array(16))).toThrow(/longer/)
  })
  it('key import needs 64 bytes', () => {
    expect(cmd.importPrivateKey(new Uint8Array(64)).length).toBe(65)
    expect(() => cmd.importPrivateKey(new Uint8Array(10))).toThrow()
  })
  it('misc encoders', () => {
    expect(Array.from(cmd.setDevicePin(123456).subarray(1))).toEqual(Array.from(u32le(123456)))
    expect(bytesToHex(cmd.setCustomVar('gps', '1'))).toBe('29' + bytesToHex(utf8('gps:1')))
    expect(Array.from(cmd.setAutoadd(3))).toEqual([58, 3])
    expect(Array.from(cmd.setAutoadd(3, 5))).toEqual([58, 3, 5])
    expect(cmd.setDefaultFloodScope('us', new Uint8Array(16)).length).toBe(1 + 31 + 16)
    expect(() => cmd.setDefaultFloodScope('us', new Uint8Array(3))).toThrow()
    expect(cmd.clearDefaultFloodScope().length).toBe(1)
    expect(bytesToHex(cmd.factoryReset())).toBe('33' + bytesToHex(utf8('reset')))
    expect(bytesToHex(cmd.reboot())).toBe('13' + bytesToHex(utf8('reboot')))
    expect(Array.from(cmd.setDeviceTime(1))).toEqual([6, 1, 0, 0, 0])
    expect(Array.from(cmd.setAdvertName('n'))).toEqual([8, 110])
    expect(cmd.getChannel(1)).toEqual(Uint8Array.of(31, 1))
    expect(cmd.exportPrivateKey()).toEqual(Uint8Array.of(23))
    expect(cmd.getCustomVars()).toEqual(Uint8Array.of(40))
    expect(cmd.getAutoadd()).toEqual(Uint8Array.of(59))
    expect(cmd.getDefaultFloodScope()).toEqual(Uint8Array.of(64))
    expect(cmd.deviceQuery()).toEqual(Uint8Array.of(22, 3))
  })
})

describe('response parsers', () => {
  it('self info', () => {
    const f = new Uint8Array(58 + 6)
    const v = new DataView(f.buffer)
    f[0] = 5
    f[2] = 22
    f[3] = 30
    f.fill(9, 4, 36)
    v.setInt32(36, 33890570, true)
    v.setInt32(40, -84169480, true)
    v.setUint32(48, 910525, true)
    v.setUint32(52, 62500, true)
    f[56] = 7
    f[57] = 5
    f.set(utf8('Sweep1'), 58)
    const s = parseSelfInfo(f)
    expect(s).toMatchObject({ txPower: 22, maxTxPower: 30, sf: 7, cr: 5, name: 'Sweep1' })
    expect(s.freq).toBeCloseTo(910.525)
    expect(s.bw).toBeCloseTo(62.5)
    expect(s.lat).toBeCloseTo(33.89057)
    expect(s.lon).toBeCloseTo(-84.16948)
    expect(s.publicKey).toHaveLength(32)
  })
  it('rejects short or wrong frames', () => {
    expect(() => parseSelfInfo(Uint8Array.of(5, 1))).toThrow(/unexpected reply/)
    expect(() => parseChannelInfo(Uint8Array.of(0))).toThrow(/unexpected reply/)
  })
  it('device info', () => {
    const f = concat(
      Uint8Array.of(13, 12, 50, 8),
      u32le(123456),
      fixedString('10-Oct-2026', 12),
      fixedString('Seeed', 40),
      fixedString('v1.12', 20),
      Uint8Array.of(0, 0),
    )
    expect(parseDeviceInfo(f)).toMatchObject({
      firmwareVerCode: 12,
      maxContacts: 100,
      maxChannels: 8,
      blePin: 123456,
      manufacturer: 'Seeed',
      firmwareVersion: 'v1.12',
      buildDate: '10-Oct-2026',
    })
  })
  it('channel info, private key, custom vars, autoadd, flood scope', () => {
    const ch = parseChannelInfo(
      concat(Uint8Array.of(18, 3), fixedString('race', 32), new Uint8Array(16).fill(7)),
    )
    expect(ch).toMatchObject({ index: 3, name: 'race' })
    expect(ch.secret[0]).toBe(7)
    expect(parsePrivateKey(concat(Uint8Array.of(14), new Uint8Array(64)))).toHaveLength(64)
    expect(parseCustomVars(concat(Uint8Array.of(21), utf8('gps:1,gps_interval:900')))).toEqual({
      gps: '1',
      gps_interval: '900',
    })
    expect(parseCustomVars(Uint8Array.of(21))).toEqual({})
    expect(parseAutoadd(Uint8Array.of(25, 3, 4))).toEqual({ config: 3, maxHops: 4 })
    expect(parseFloodScope(Uint8Array.of(28))).toBeNull()
    expect(
      parseFloodScope(concat(Uint8Array.of(28), fixedString('us', 31), new Uint8Array(16).fill(2))),
    ).toMatchObject({ name: 'us' })
  })
})
