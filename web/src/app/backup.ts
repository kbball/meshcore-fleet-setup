import { buildBackup, type NodeBackup } from '../domain/backup'
import { bytesToHex } from '../domain/bytes'
import { CompanionClient } from './companionClient'
import { applyCompanionProfile, readPrivateKey, readState, verifyCompanionProfile } from './companionConfig'
import type { BackupCipher, BackupSink, Clock, Logger } from './ports'

/** Read a node's current configuration into a backup. */
export async function captureBackup(
  c: CompanionClient,
  clock: Clock,
  firmwareVariant: string,
): Promise<NodeBackup> {
  const s = await readState(c)
  const privateKey = await readPrivateKey(c)
  return buildBackup({
    created: clock.now(),
    board: s.device.manufacturer,
    firmware: s.device.firmwareVersion,
    firmwareVariant,
    publicKey: s.self.publicKey,
    name: s.self.name,
    lat: s.self.lat,
    lon: s.self.lon,
    radio: { freq: s.self.freq, bw: s.self.bw, sf: s.self.sf, cr: s.self.cr, tx_power: s.self.txPower },
    channels: s.channels,
    privateKey,
    floodScope: s.floodScope,
    autoadd: s.autoadd,
    customVars: s.customVars,
  })
}

export function backupFilename(b: NodeBackup): string {
  const safe = b.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 24) || 'node'
  return `backup-${safe}-${b.public_key.slice(0, 8)}-${b.created.slice(0, 10)}.mcbackup.json`
}

/** Capture, encrypt with the passphrase and hand to the sink. Resolves with the filename once saved. */
export async function backupNode(
  c: CompanionClient,
  deps: { clock: Clock; cipher: BackupCipher; sink: BackupSink; log: Logger },
  passphrase: string,
  firmwareVariant: string,
): Promise<{ filename: string; publicKey: string; name: string }> {
  if (!passphrase) throw new Error('a backup passphrase is required')
  const backup = await captureBackup(c, deps.clock, firmwareVariant)
  const text = await deps.cipher.encrypt(backup, passphrase)
  const filename = backupFilename(backup)
  await deps.sink.save(filename, text)
  deps.log.info('backup saved', { filename, publicKey: backup.public_key })
  return { filename, publicKey: backup.public_key, name: backup.name }
}

/** Write a decrypted backup back to a node and verify it. Returns mismatches (empty = restored). */
export async function restoreBackup(
  c: CompanionClient,
  backup: NodeBackup,
  deps: { clock: Clock; log: Logger },
): Promise<string[]> {
  const profile = { ...backup.profile, wipe_first: false }
  await applyCompanionProfile(c, profile, { nodeName: backup.name, clock: deps.clock, log: deps.log })
  const bad = await verifyCompanionProfile(c, profile, backup.name)
  if (!backup.profile.identity)
    bad.push('private key was not in the backup, so the node keeps a different identity')
  return bad
}

export const shortKey = (key: Uint8Array) => bytesToHex(key).slice(0, 8)
