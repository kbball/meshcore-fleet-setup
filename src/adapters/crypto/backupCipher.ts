import { backupLabel, type NodeBackup } from '../../domain/backup'
import { base64ToBytes, bytesToBase64, utf8, fromUtf8 } from '../../domain/bytes'
import type { BackupCipher } from '../../app/ports'

const ITERATIONS = 600_000 // OWASP guidance for PBKDF2-HMAC-SHA256

type Envelope = {
  format: 'meshcore-fleet-backup-encrypted'
  version: 1
  /** Not secret: lets the owner see which node a file is for without the passphrase. Also authenticated. */
  label: ReturnType<typeof backupLabel>
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  data: string
}

async function deriveKey(
  pass: string,
  salt: Uint8Array,
  iterations: number,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', utf8(pass) as BufferSource, 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export class WebCryptoBackupCipher implements BackupCipher {
  constructor(
    private c: Crypto = globalThis.crypto,
    private iterations = ITERATIONS,
  ) {}

  async encrypt(backup: NodeBackup, passphrase: string): Promise<string> {
    const salt = this.c.getRandomValues(new Uint8Array(16))
    const iv = this.c.getRandomValues(new Uint8Array(12))
    const label = backupLabel(backup)
    const key = await deriveKey(passphrase, salt, this.iterations, this.c.subtle)
    const ct = await this.c.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: utf8(JSON.stringify(label)) as BufferSource,
      },
      key,
      utf8(JSON.stringify(backup)) as BufferSource,
    )
    const env: Envelope = {
      format: 'meshcore-fleet-backup-encrypted',
      version: 1,
      label,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: this.iterations, salt: bytesToBase64(salt) },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
      data: bytesToBase64(new Uint8Array(ct)),
    }
    return JSON.stringify(env, null, 2)
  }

  async decrypt(text: string, passphrase: string): Promise<NodeBackup> {
    let env: Envelope
    try {
      env = JSON.parse(text)
    } catch {
      throw new Error('not a backup file')
    }
    if (env.format !== 'meshcore-fleet-backup-encrypted' || env.version !== 1)
      throw new Error('not a supported backup file')
    const key = await deriveKey(passphrase, base64ToBytes(env.kdf.salt), env.kdf.iterations, this.c.subtle)
    try {
      const pt = await this.c.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToBytes(env.cipher.iv) as BufferSource,
          additionalData: utf8(JSON.stringify(env.label)) as BufferSource,
        },
        key,
        base64ToBytes(env.data) as BufferSource,
      )
      return JSON.parse(fromUtf8(new Uint8Array(pt)))
    } catch {
      throw new Error('wrong passphrase, or the file was changed')
    }
  }
}
