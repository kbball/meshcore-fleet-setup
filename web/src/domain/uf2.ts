// UF2 container for the nRF52 UF2 bootloader (the T-1000-E has no serial DFU, only a mass-storage drive).
// https://github.com/microsoft/uf2 : 512-byte blocks, each carrying up to 256 bytes at a target address.
import { u32le } from './bytes'

export const NRF52840_FAMILY_ID = 0xada52840
const UF2_MAGIC_START0 = 0x0a324655
const UF2_MAGIC_START1 = 0x9e5d5157
const UF2_MAGIC_END = 0x0ab16f30
const FLAG_FAMILY_ID_PRESENT = 0x2000
const PAYLOAD = 256

// Softdevice id (from the DFU package's manifest) -> where the application starts in flash. Only ids seen
// in our own packages are listed; add an id here once a build needs it. 182 = S140 6.1.1, 291 = S140 7.x.
const APP_START_BY_SOFTDEVICE: Record<number, number> = { 182: 0x26000, 291: 0x27000 }

/**
 * Where the application starts in flash, from the softdevice ids a DFU package requires. Unknown ids are
 * refused: a wrong address would write the app over the softdevice or leave it unbootable.
 */
export function appStartAddress(softdeviceReq: readonly number[] | undefined): number {
  const starts: (number | undefined)[] = [
    ...new Set((softdeviceReq ?? []).map((id) => APP_START_BY_SOFTDEVICE[id])),
  ]
  if (starts.length === 1 && starts[0] !== undefined) return starts[0]
  throw new Error(
    `cannot pick a UF2 start address for softdevice ${softdeviceReq?.length ? softdeviceReq.join(', ') : '(none listed)'}`,
  )
}

/** Wraps a raw application image as UF2 blocks starting at `base`. */
export function packUf2(bin: Uint8Array, base: number, familyId = NRF52840_FAMILY_ID): Uint8Array {
  const blocks = Math.ceil(bin.length / PAYLOAD)
  const out = new Uint8Array(blocks * 512)
  for (let n = 0; n < blocks; n++) {
    const chunk = bin.subarray(n * PAYLOAD, (n + 1) * PAYLOAD)
    const b = out.subarray(n * 512, (n + 1) * 512)
    b.set(u32le(UF2_MAGIC_START0), 0)
    b.set(u32le(UF2_MAGIC_START1), 4)
    b.set(u32le(FLAG_FAMILY_ID_PRESENT), 8)
    b.set(u32le(base + n * PAYLOAD), 12)
    b.set(u32le(PAYLOAD), 16)
    b.set(u32le(n), 20)
    b.set(u32le(blocks), 24)
    b.set(u32le(familyId), 28)
    b.set(chunk, 32) // the rest of the 476-byte data area stays zero
    b.set(u32le(UF2_MAGIC_END), 508)
  }
  return out
}
