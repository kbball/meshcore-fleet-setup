import { WebCryptoBackupCipher } from './backupCipher'
import { buildBackup } from '../../domain/backup'

const backup = buildBackup({
  created: new Date('2026-10-10T12:00:00Z'),
  board: 'Seeed',
  firmware: 'v1',
  firmwareVariant: 'x',
  publicKey: new Uint8Array(32).fill(1),
  name: 'Bob',
  lat: 1,
  lon: 2,
  radio: { freq: 910, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
  channels: [{ index: 0, name: 'Public', secret: new Uint8Array(16).fill(3) }],
  privateKey: new Uint8Array(64).fill(0xab),
  floodScope: null,
  autoadd: null,
  customVars: {},
})
const cipher = new WebCryptoBackupCipher(globalThis.crypto, 1000)

describe('WebCryptoBackupCipher', () => {
  it('round trips with the right passphrase', async () => {
    const text = await cipher.encrypt(backup, 'correct horse')
    expect(await cipher.decrypt(text, 'correct horse')).toEqual(backup)
  })

  it('keeps keys out of the clear but labels the file', async () => {
    const text = await cipher.encrypt(backup, 'pw')
    expect(text).not.toContain('abababab')
    expect(text).not.toContain(Buffer.from(new Uint8Array(16).fill(3)).toString('base64'))
    expect(JSON.parse(text).label).toMatchObject({ name: 'Bob', board: 'Seeed' })
  })

  it('uses a fresh salt and iv each time', async () => {
    const a = JSON.parse(await cipher.encrypt(backup, 'pw'))
    const b = JSON.parse(await cipher.encrypt(backup, 'pw'))
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
  })

  it('rejects a wrong passphrase, tampering, and non-backup files', async () => {
    const text = await cipher.encrypt(backup, 'pw')
    await expect(cipher.decrypt(text, 'nope')).rejects.toThrow(/wrong passphrase/)
    const env = JSON.parse(text)
    env.label.name = 'Mallory' // label is authenticated
    await expect(cipher.decrypt(JSON.stringify(env), 'pw')).rejects.toThrow(/wrong passphrase/)
    await expect(cipher.decrypt('not json', 'pw')).rejects.toThrow(/not a backup/)
    await expect(cipher.decrypt('{"format":"x"}', 'pw')).rejects.toThrow(/not a supported/)
  })

  it('defaults to a strong iteration count', async () => {
    const text = await new WebCryptoBackupCipher().encrypt(backup, 'pw')
    expect(JSON.parse(text).kdf.iterations).toBeGreaterThanOrEqual(600_000)
  })
})
