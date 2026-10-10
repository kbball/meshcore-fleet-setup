import { bytesToHex } from './bytes'
import { parseChannelInfo } from './companion'
import type { CompanionProfile } from './profile'

export type NodeBackup = {
  format: 'meshcore-fleet-backup'
  version: 1
  created: string // ISO timestamp
  board: string
  firmware: string
  public_key: string // hex
  name: string
  /** Restorable as a profile (wipe_first false, identity imported). */
  profile: CompanionProfile
  /** Things that could not be read back from the node, so a restore will not set them. */
  not_captured: string[]
}

export type BackupInputs = {
  created: Date
  board: string
  firmware: string
  publicKey: Uint8Array
  name: string
  lat: number
  lon: number
  radio: { freq: number; bw: number; sf: number; cr: number; tx_power: number }
  channels: ReturnType<typeof parseChannelInfo>[]
  privateKey: Uint8Array | null
  floodScope: { name: string; key: Uint8Array } | null
  autoadd: { config: number; maxHops: number } | null
  /** Custom variables as read from the node; `gps` is present only on nodes with a GPS. */
  customVars: Record<string, string>
  firmwareVariant: string
}

export function buildBackup(i: BackupInputs): NodeBackup {
  const notCaptured = ['BLE PIN', 'contacts', 'messages']
  if ('gps' in i.customVars) notCaptured.push('GPS interval')
  if (!i.privateKey) notCaptured.push('private key (export disabled in this firmware)')
  const profile: CompanionProfile = {
    kind: 'companion',
    firmware_variant: i.firmwareVariant,
    wipe_first: false,
    radio: i.radio,
    channels: i.channels
      .filter((c) => c.name !== '')
      .map((c) => ({ name: c.name, secret: bytesToHex(c.secret) })),
    advert: {
      name_template: i.name,
      lat: i.lat,
      lon: i.lon,
      ...(i.floodScope
        ? { flood_scope: { name: i.floodScope.name, key: bytesToHex(i.floodScope.key) } }
        : {}),
    },
    ...(i.privateKey ? { identity: { mode: 'import' as const, private_key: bytesToHex(i.privateKey) } } : {}),
    ...(i.autoadd ? { autoadd: { config: i.autoadd.config, max_hops: i.autoadd.maxHops } } : {}),
    ...('gps' in i.customVars ? { gps: { enabled: i.customVars.gps === '1' } } : {}),
  }
  return {
    format: 'meshcore-fleet-backup',
    version: 1,
    created: i.created.toISOString(),
    board: i.board,
    firmware: i.firmware,
    public_key: bytesToHex(i.publicKey),
    name: i.name,
    profile,
    not_captured: notCaptured,
  }
}

/** Fields that are safe to show without the passphrase (no keys). */
export type BackupLabel = { board: string; name: string; created: string; public_key: string }
export const backupLabel = (b: NodeBackup): BackupLabel => ({
  board: b.board,
  name: b.name,
  created: b.created,
  public_key: b.public_key,
})
