import { base64ToBytes, hexToBytes } from './bytes'
import { validateTrackerConfig, type TrackerConfig } from './tracker'

export const PUBLIC_CHANNEL_PSK = 'izOH6cXN6mrJ5e26oRXNcg=='

/**
 * A node that speaks the companion protocol. `gateway` is the RAK4631 + Ethernet build: same protocol and
 * settings, but no BLE, so it takes no `ble_pin`.
 */
export type CompanionProfile = {
  kind: 'companion' | 'gateway'
  firmware_variant: string
  wipe_first: boolean
  radio?: { freq: number; bw: number; sf: number; cr: number; tx_power?: number }
  channels?: { name: string; secret: string }[]
  advert?: {
    name_template?: string
    lat?: number
    lon?: number
    flood_scope?: { name: string; key: string }
  }
  /** `generate`: keep the identity the node makes itself (new after a wipe). `import`: write the given key. */
  identity?: { mode: 'generate' } | { mode: 'import'; private_key: string }
  ble_pin?: number
  autoadd?: { config: number; max_hops?: number }
  /** Companion GPS. Firmware default is off. Only boards with a detected GPS (e.g. T-1000-E) have this setting. */
  gps?: { enabled: boolean; interval_sec?: number }
}

export type TrackerProfile = {
  kind: 'tracker'
  firmware_variant: string
  name_template?: string
  config: TrackerConfig
}

export type Profile = CompanionProfile | TrackerProfile

const COMPANION_KEYS = [
  'kind',
  'firmware_variant',
  'wipe_first',
  'radio',
  'channels',
  'advert',
  'identity',
  'ble_pin',
  'autoadd',
  'gps',
]
const TRACKER_KEYS = ['kind', 'firmware_variant', 'name_template', 'config']

/** Channel secret as 16 bytes: 32 hex chars, base64, or the keyword `public`. */
export function parseChannelSecret(s: string): Uint8Array {
  const v = s === 'public' ? PUBLIC_CHANNEL_PSK : s
  const bytes = /^[0-9a-fA-F]{32}$/.test(v) ? hexToBytes(v) : safeBase64(v)
  if (bytes.length !== 16) throw new Error('channel secret must decode to 16 bytes (32 hex chars or base64)')
  return bytes
}

function safeBase64(s: string): Uint8Array {
  try {
    return base64ToBytes(s)
  } catch {
    throw new Error('channel secret is neither hex nor base64')
  }
}

export function parsePrivateKey(s: string): Uint8Array {
  const b = /^[0-9a-fA-F]{128}$/.test(s) ? hexToBytes(s) : null
  if (!b) throw new Error('private_key must be 128 hex characters (64 bytes)')
  return b
}

/** A section must be a JSON object; anything else is reported and then treated as empty. */
const section = (v: unknown, name: string, problems: string[]): Record<string, unknown> => {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
  problems.push(`${name} must be an object`)
  return {}
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validateProfile(p: unknown): string[] {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return ['profile must be a JSON object']
  const o = p as Record<string, unknown>
  const problems: string[] = []
  if (o.kind !== 'companion' && o.kind !== 'gateway' && o.kind !== 'tracker')
    return ["kind must be 'companion', 'gateway' or 'tracker'"]
  if (typeof o.firmware_variant !== 'string' || !o.firmware_variant)
    problems.push('firmware_variant is required')

  const allowed = o.kind === 'tracker' ? TRACKER_KEYS : COMPANION_KEYS
  for (const k of Object.keys(o)) if (!allowed.includes(k)) problems.push(`unknown key '${k}'`)

  if (o.kind === 'tracker') {
    if ('name_template' in o && (typeof o.name_template !== 'string' || !o.name_template))
      problems.push('name_template must be a non-empty string')
    if (!('config' in o)) problems.push('config is required')
    else problems.push(...validateTrackerConfig(o.config).map((m) => `config: ${m}`))
    return problems
  }

  if (typeof o.wipe_first !== 'boolean') problems.push('wipe_first must be true or false')
  const range = (
    obj: Record<string, unknown>,
    key: string,
    lo: number,
    hi: number,
    label: string,
    int = false,
  ) => {
    if (!(key in obj)) return
    const v = obj[key]
    if (!isNum(v) || (int && !Number.isInteger(v)) || v < lo || v > hi)
      problems.push(`${label}.${key} must be ${int ? 'an integer ' : ''}between ${lo} and ${hi}`)
  }
  if (o.radio !== undefined) {
    const r = section(o.radio, 'radio', problems)
    for (const k of ['freq', 'bw', 'sf', 'cr']) if (!(k in r)) problems.push(`radio.${k} is required`)
    range(r, 'freq', 150, 2500, 'radio')
    range(r, 'bw', 7, 500, 'radio')
    range(r, 'sf', 5, 12, 'radio', true)
    range(r, 'cr', 5, 8, 'radio', true)
    range(r, 'tx_power', -9, 30, 'radio', true)
  }
  if (o.channels !== undefined) {
    if (!Array.isArray(o.channels)) problems.push('channels must be a list')
    else
      o.channels.forEach((c: { name?: unknown; secret?: unknown }, i: number) => {
        if (typeof c?.name !== 'string' || !c.name || new TextEncoder().encode(c.name).length > 31)
          problems.push(`channels[${i}].name must be 1-31 bytes`)
        try {
          parseChannelSecret(String(c?.secret))
        } catch (e) {
          problems.push(`channels[${i}].secret: ${(e as Error).message}`)
        }
      })
  }
  if (o.advert !== undefined) {
    const a = section(o.advert, 'advert', problems)
    range(a, 'lat', -90, 90, 'advert')
    range(a, 'lon', -180, 180, 'advert')
    if ('lat' in a !== 'lon' in a) problems.push('advert.lat and advert.lon must be given together')
    if ('name_template' in a && (typeof a.name_template !== 'string' || !a.name_template))
      problems.push('advert.name_template must be a non-empty string')
    if (a.flood_scope !== undefined) {
      const f = section(a.flood_scope, 'advert.flood_scope', problems)
      if (typeof f.name !== 'string' || !f.name || f.name.length > 30)
        problems.push('advert.flood_scope.name must be 1-30 characters')
      if (typeof f.key !== 'string' || !/^[0-9a-fA-F]{32}$/.test(f.key))
        problems.push('advert.flood_scope.key must be 32 hex characters')
    }
  }
  if (o.identity !== undefined) {
    const i = section(o.identity, 'identity', problems)
    if (i.mode === 'import') {
      try {
        parsePrivateKey(String(i.private_key))
      } catch (e) {
        problems.push(`identity.private_key: ${(e as Error).message}`)
      }
    } else if (i.mode !== 'generate') problems.push("identity.mode must be 'generate' or 'import'")
  }
  if (o.kind === 'gateway' && o.ble_pin !== undefined)
    problems.push('a gateway has no BLE, so ble_pin does not apply')
  else if (
    o.ble_pin !== undefined &&
    !(
      o.ble_pin === 0 ||
      (Number.isInteger(o.ble_pin) && (o.ble_pin as number) >= 100000 && (o.ble_pin as number) <= 999999)
    )
  ) {
    problems.push('ble_pin must be 0 or a 6 digit number')
  }
  if (o.autoadd !== undefined) {
    const a = section(o.autoadd, 'autoadd', problems)
    range(a, 'config', 0, 255, 'autoadd', true)
    range(a, 'max_hops', 0, 64, 'autoadd', true)
  }
  if (o.gps !== undefined) {
    const g = section(o.gps, 'gps', problems)
    if (typeof g.enabled !== 'boolean') problems.push('gps.enabled must be true or false')
    range(g, 'interval_sec', 0, 86400, 'gps', true)
    for (const k of Object.keys(g))
      if (k !== 'enabled' && k !== 'interval_sec') problems.push(`unknown key 'gps.${k}'`)
  }
  return problems
}

export function parseProfile(json: string): Profile {
  let o: unknown
  try {
    o = JSON.parse(json)
  } catch (e) {
    throw new Error(`profile is not valid JSON: ${(e as Error).message}`)
  }
  const problems = validateProfile(o)
  if (problems.length) throw new Error('invalid profile:\n  ' + problems.join('\n  '))
  return o as Profile
}

/** True when a companion profile carries secrets (so the UI keeps it out of persistent storage). */
export function profileHasSecrets(p: Profile): boolean {
  if (p.kind === 'tracker') return p.config.channel_psk !== undefined
  return (p.channels?.length ?? 0) > 0 || p.identity?.mode === 'import'
}
