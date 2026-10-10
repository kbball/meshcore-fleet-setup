import { findFirmware, parseManifest } from './manifest'
import { buildBackup, backupLabel } from './backup'
import { bytesToHex } from './bytes'

const e = (env: string, version: string) => ({
  board: 'b',
  env,
  kind: 'companion',
  version,
  file: `${env}-${version}.zip`,
  sha256: 'a'.repeat(64),
})

describe('manifest', () => {
  it('parses and picks the newest version', () => {
    const m = parseManifest({
      entries: [e('x', '0.9.0'), e('x', '0.10.0'), e('x', '0.2.1'), e('y', '9.0.0')],
    })
    expect(findFirmware(m, 'x')?.version).toBe('0.10.0')
    expect(findFirmware(m, 'x', '0.2.1')?.version).toBe('0.2.1')
    expect(findFirmware(m, 'z')).toBeUndefined()
    expect(findFirmware(m, 'x', '1.0.0')).toBeUndefined()
  })
  it('orders pre-release and v-prefixed versions sensibly', () => {
    const m = parseManifest({ entries: [e('x', 'v1.2.0-abc'), e('x', 'v1.2.0-abd'), e('x', 'v1.1.9')] })
    expect(findFirmware(m, 'x')?.version).toBe('v1.2.0-abd')
  })
  it('rejects malformed manifests', () => {
    expect(() => parseManifest({})).toThrow(/entries/)
    expect(() => parseManifest({ entries: [{ ...e('x', '1'), file: '' }] })).toThrow(/file/)
    expect(() => parseManifest({ entries: [{ ...e('x', '1'), kind: 'weird' }] })).toThrow(/kind/)
    expect(() => parseManifest({ entries: [{ ...e('x', '1'), sha256: 'zz' }] })).toThrow(/sha256/)
  })
})

describe('buildBackup', () => {
  const base = {
    created: new Date('2026-10-10T12:00:00Z'),
    board: 'Seeed',
    firmware: 'v1',
    firmwareVariant: 'x',
    publicKey: new Uint8Array(32).fill(1),
    name: 'Bob',
    lat: 1,
    lon: 2,
    radio: { freq: 910, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
    channels: [
      { index: 0, name: 'Public', secret: new Uint8Array(16).fill(3) },
      { index: 1, name: '', secret: new Uint8Array(16) },
    ],
    privateKey: new Uint8Array(64).fill(4),
    floodScope: { name: 'ga', key: new Uint8Array(16).fill(5) },
    autoadd: { config: 1, maxHops: 2 },
    customVars: { gps: '1' },
  }
  it('captures a restorable profile and notes what it could not read', () => {
    const b = buildBackup(base)
    expect(b.profile.wipe_first).toBe(false)
    expect(b.profile.channels).toEqual([{ name: 'Public', secret: bytesToHex(new Uint8Array(16).fill(3)) }])
    expect(b.profile.identity).toEqual({ mode: 'import', private_key: '04'.repeat(64) })
    expect(b.profile.advert?.flood_scope?.name).toBe('ga')
    expect(b.profile.gps).toEqual({ enabled: true })
    expect(b.not_captured).toEqual(['BLE PIN', 'contacts', 'messages', 'GPS interval'])
    expect(backupLabel(b)).toEqual({
      board: 'Seeed',
      name: 'Bob',
      created: '2026-10-10T12:00:00.000Z',
      public_key: '01'.repeat(32),
    })
  })
  it('records a disabled key export', () => {
    const b = buildBackup({ ...base, privateKey: null, floodScope: null, autoadd: null, customVars: {} })
    expect(b.profile.identity).toBeUndefined()
    expect(b.not_captured.some((m) => m.startsWith('private key'))).toBe(true)
  })
})
