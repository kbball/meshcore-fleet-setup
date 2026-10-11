import { NRF52840_FAMILY_ID, appStartAddress, packUf2 } from './uf2'

const word = (b: Uint8Array, off: number) => new DataView(b.buffer, b.byteOffset).getUint32(off, true)

describe('packUf2', () => {
  const bin = new Uint8Array(600).map((_, i) => i & 0xff)
  const uf2 = packUf2(bin, 0x27000)

  it('makes one 512-byte block per 256 bytes of image', () => {
    expect(uf2.length).toBe(3 * 512)
  })

  it('stamps each block with magics, address, numbering and family', () => {
    for (let n = 0; n < 3; n++) {
      const b = uf2.subarray(n * 512, (n + 1) * 512)
      expect(word(b, 0)).toBe(0x0a324655)
      expect(word(b, 4)).toBe(0x9e5d5157)
      expect(word(b, 8)).toBe(0x2000)
      expect(word(b, 12)).toBe(0x27000 + n * 256)
      expect(word(b, 16)).toBe(256)
      expect(word(b, 20)).toBe(n)
      expect(word(b, 24)).toBe(3)
      expect(word(b, 28)).toBe(NRF52840_FAMILY_ID)
      expect(word(b, 508)).toBe(0x0ab16f30)
    }
  })

  it('carries the image and zero-pads the last block', () => {
    expect([...uf2.subarray(32, 32 + 256)]).toEqual([...bin.subarray(0, 256)])
    const last = uf2.subarray(2 * 512 + 32, 2 * 512 + 32 + 256)
    expect([...last.subarray(0, 88)]).toEqual([...bin.subarray(512)])
    expect(last.subarray(88).every((v) => v === 0)).toBe(true)
  })
})

describe('appStartAddress', () => {
  it('knows the softdevices our builds use', () => {
    expect(appStartAddress([291])).toBe(0x27000)
    expect(appStartAddress([182])).toBe(0x26000)
  })
  it('refuses anything it does not know', () => {
    expect(() => appStartAddress([999])).toThrow(/cannot pick a UF2 start address for softdevice 999/)
    expect(() => appStartAddress([])).toThrow(/none listed/)
    expect(() => appStartAddress(undefined)).toThrow(/none listed/)
    expect(() => appStartAddress([182, 291])).toThrow()
  })
})
