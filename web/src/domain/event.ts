// Event file: one description of a whole event from which every device's profile is derived, so channel
// indexes and secrets cannot drift between radios, gateways, trackers and the apps. Pure logic: randomness
// is injected, nothing touches the browser.
//
// Fixed channel layout on every station radio and gateway (the apps rely on the indexes):
//   0 sweeps (one secret for the event)   1 aid station logging (per station)
//   2 station chat (per station)          3 all-race chat (one secret for the event)
import { bytesToHex } from './bytes'
import { parseChannelSecret, validateProfile, type CompanionProfile, type TrackerProfile } from './profile'
import { expandName, validateTrackerConfig } from './tracker'

export const CHANNEL_SWEEPS = 0
export const CHANNEL_STATION_LOG = 1
export const CHANNEL_STATION_CHAT = 2
export const CHANNEL_ALL_RACE = 3

/** Channel slots on every nRF52 companion build in the fork (MAX_GROUP_CHANNELS). */
export const CHANNEL_SLOTS = 40
/** The net-control device holds 2 event-wide channels plus 2 per station. */
export const MAX_STATIONS = (CHANNEL_SLOTS - 2) / 2

export const GATEWAY_ENV = 'RAK_4631_companion_radio_usb_ethernet'
export const GATEWAY_TCP_PORT = 5000
export const DEFAULT_COMPANION_ENV = 'Xiao_nrf52_companion_radio_usb_ble'
export const DEFAULT_TRACKER_ENV = 't1000e_gps_tracker'

const TAG_RE = /^ares-v\d+\.\d+\.\d+$/
const STATION_ID_RE = /^[A-Za-z0-9_-]{1,12}$/
const SECRET_RE = /^[0-9a-f]{32}$/

export type EventRadio = { freq: number; bw: number; sf: number; cr: number; tx_power?: number }

export type EventStation = {
  /** Short tag used in channel and device names, e.g. `AS3`. */
  id: string
  /** Human name, e.g. `Aid Station 3`. */
  name: string
  /** 32 hex chars, random. */
  log_secret: string
  chat_secret: string
  /** The gateway's reserved address on the station network; the go-box needs it. Optional until known. */
  gateway_address?: string
}

export type EventFile = {
  format: 'meshcore-event'
  version: 1
  name: string
  created: string
  /** Fork release the event flashes, e.g. `ares-v1.0.0`. */
  firmware_tag: string
  radio: EventRadio
  sweeps_secret: string
  all_race_secret: string
  stations: EventStation[]
  /** Tracker names are `<name_template with {n}>` for n = 1..count: stable and unique per tracker. */
  trackers: { name_template: string; count: number; firmware_variant?: string }
  /** Firmware env for station radios. */
  companion_variant?: string
  ble_pin?: number
  /** Optional scope per channel index. Deferred: nothing in the tool depends on it. */
  scope?: Record<string, string>
}

export type Channel = { index: number; name: string; secret: string; scope?: string }

export type NewEventParams = {
  name: string
  firmware_tag: string
  radio: EventRadio
  stationIds: { id: string; name: string }[]
  trackers: { name_template: string; count: number }
  created: string
}

/** Fills n random bytes. The browser passes `crypto.getRandomValues`; tests pass a deterministic source. */
export type RandomBytes = (n: number) => Uint8Array

const newSecret = (rng: RandomBytes, used: Set<string>): string => {
  for (let i = 0; i < 8; i++) {
    const b = rng(16)
    if (b.length !== 16) throw new Error('random source returned the wrong number of bytes')
    const s = bytesToHex(b)
    if (!used.has(s) && /[1-9a-f]/.test(s)) {
      used.add(s)
      return s
    }
  }
  throw new Error('random source keeps returning the same or an empty key')
}

export function createEventFile(p: NewEventParams, rng: RandomBytes): EventFile {
  const used = new Set<string>()
  const ev: EventFile = {
    format: 'meshcore-event',
    version: 1,
    name: p.name,
    created: p.created,
    firmware_tag: p.firmware_tag,
    radio: p.radio,
    sweeps_secret: newSecret(rng, used),
    all_race_secret: newSecret(rng, used),
    stations: p.stationIds.map((s) => ({
      id: s.id,
      name: s.name,
      log_secret: newSecret(rng, used),
      chat_secret: newSecret(rng, used),
    })),
    trackers: p.trackers,
  }
  const problems = validateEventFile(ev)
  if (problems.length) throw new Error('invalid event:\n  ' + problems.join('\n  '))
  return ev
}

/** Add a station with fresh secrets that differ from every secret already in the event. */
export function addStation(ev: EventFile, id: string, name: string, rng: RandomBytes): EventFile {
  const used = new Set(allSecrets(ev))
  const next: EventFile = {
    ...ev,
    stations: [
      ...ev.stations,
      { id, name, log_secret: newSecret(rng, used), chat_secret: newSecret(rng, used) },
    ],
  }
  const problems = validateEventFile(next)
  if (problems.length) throw new Error('invalid event:\n  ' + problems.join('\n  '))
  return next
}

/** Replace one station's secrets (a key that leaked): the new ones never repeat an existing secret. */
export function rotateStationSecrets(ev: EventFile, id: string, rng: RandomBytes): EventFile {
  if (!ev.stations.some((s) => s.id === id)) throw new Error(`no station '${id}'`)
  const used = new Set(allSecrets(ev))
  return {
    ...ev,
    stations: ev.stations.map((s) =>
      s.id === id ? { ...s, log_secret: newSecret(rng, used), chat_secret: newSecret(rng, used) } : s,
    ),
  }
}

export function removeStation(ev: EventFile, id: string): EventFile {
  return { ...ev, stations: ev.stations.filter((s) => s.id !== id) }
}

function allSecrets(ev: EventFile): string[] {
  return [
    ev.sweeps_secret,
    ev.all_race_secret,
    ...ev.stations.flatMap((s) => [s?.log_secret, s?.chat_secret]),
  ].map((s) => String(s).toLowerCase())
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length

export function validateEventFile(o: unknown): string[] {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return ['event file must be a JSON object']
  const e = o as Record<string, unknown>
  const problems: string[] = []
  if (e.format !== 'meshcore-event') problems.push("format must be 'meshcore-event'")
  if (e.version !== 1) problems.push('version must be 1')
  if (typeof e.name !== 'string' || !e.name.trim()) problems.push('name is required')
  if (typeof e.created !== 'string' || Number.isNaN(Date.parse(e.created)))
    problems.push('created must be a date')
  if (typeof e.firmware_tag !== 'string' || !TAG_RE.test(e.firmware_tag))
    problems.push('firmware_tag must look like ares-v1.0.0')

  const radio = e.radio as Record<string, unknown> | undefined
  if (typeof radio !== 'object' || radio === null) problems.push('radio is required')
  else {
    const probe: CompanionProfile = {
      kind: 'companion',
      firmware_variant: 'x',
      wipe_first: false,
      radio: radio as EventRadio,
    }
    problems.push(...validateProfile(probe))
    if (typeof radio.tx_power === 'number' && radio.tx_power > 22)
      problems.push('radio.tx_power must be at most 22 (the SX1262 limit, which trackers enforce)')
  }

  const secretOk = (key: string, v: unknown) => {
    if (typeof v !== 'string' || !SECRET_RE.test(v))
      problems.push(`${key} must be 32 lowercase hex characters`)
    else
      try {
        parseChannelSecret(v)
      } catch (err) {
        problems.push(`${key}: ${(err as Error).message}`)
      }
  }
  secretOk('sweeps_secret', e.sweeps_secret)
  secretOk('all_race_secret', e.all_race_secret)

  if (!Array.isArray(e.stations) || e.stations.length === 0) problems.push('at least one station is required')
  else {
    if (e.stations.length > MAX_STATIONS)
      problems.push(
        `at most ${MAX_STATIONS} stations (the net-control device has ${CHANNEL_SLOTS} channel slots)`,
      )
    const ids = new Set<string>()
    e.stations.forEach((s: Record<string, unknown>, i: number) => {
      const at = `stations[${i}]`
      if (typeof s?.id !== 'string' || !STATION_ID_RE.test(s.id))
        problems.push(`${at}.id must be 1-12 letters, digits, '-' or '_'`)
      else if (ids.has(s.id.toLowerCase())) problems.push(`${at}.id '${s.id}' is used twice`)
      else ids.add(s.id.toLowerCase())
      if (typeof s?.name !== 'string' || !s.name.trim()) problems.push(`${at}.name is required`)
      secretOk(`${at}.log_secret`, s?.log_secret)
      secretOk(`${at}.chat_secret`, s?.chat_secret)
      if (
        s?.gateway_address !== undefined &&
        (typeof s.gateway_address !== 'string' || !s.gateway_address.trim())
      )
        problems.push(`${at}.gateway_address must be a non-empty string`)
    })
  }

  // Every channel needs its own random secret: a repeat would silently merge two channels.
  const secrets = Array.isArray(e.stations)
    ? allSecrets(e as unknown as EventFile).filter((s) => SECRET_RE.test(s))
    : []
  if (new Set(secrets).size !== secrets.length)
    problems.push('every channel needs its own secret; two are equal')

  const t = e.trackers as Record<string, unknown> | undefined
  if (typeof t !== 'object' || t === null) problems.push('trackers is required')
  else {
    if (typeof t.name_template !== 'string' || !t.name_template.includes('{n}'))
      problems.push('trackers.name_template must contain {n} so every tracker gets a unique name')
    if (!Number.isInteger(t.count) || (t.count as number) < 0 || (t.count as number) > 999)
      problems.push('trackers.count must be an integer between 0 and 999')
    if (typeof t.name_template === 'string' && t.name_template.includes('{n}') && Number.isInteger(t.count)) {
      try {
        if ((t.count as number) > 0) expandName(t.name_template, t.count as number)
      } catch (err) {
        problems.push(`trackers.name_template: ${(err as Error).message}`)
      }
    }
  }

  if (e.ble_pin !== undefined) {
    const probe: CompanionProfile = {
      kind: 'companion',
      firmware_variant: 'x',
      wipe_first: false,
      ble_pin: e.ble_pin as number,
    }
    problems.push(...validateProfile(probe))
  }
  if (e.scope !== undefined) {
    if (typeof e.scope !== 'object' || e.scope === null || Array.isArray(e.scope))
      problems.push('scope must be an object keyed by channel index')
  }
  return problems
}

export function parseEventFile(json: string): EventFile {
  let o: unknown
  try {
    o = JSON.parse(json)
  } catch (err) {
    throw new Error(`event file is not valid JSON: ${(err as Error).message}`, { cause: err })
  }
  const problems = validateEventFile(o)
  if (problems.length) throw new Error('invalid event file:\n  ' + problems.join('\n  '))
  return o as EventFile
}

export function trackerNames(ev: EventFile): string[] {
  return Array.from({ length: ev.trackers.count }, (_, i) => expandName(ev.trackers.name_template, i + 1))
}

const channelName = (name: string): string => {
  if (utf8Len(name) > 31) throw new Error(`channel name '${name}' is longer than 31 bytes`)
  return name
}

function withScope(ev: EventFile, c: Omit<Channel, 'scope'>): Channel {
  const scope = ev.scope?.[String(c.index)]
  return scope ? { ...c, scope } : c
}

/** The four channels of one station, in index order. Contains nothing of any other station. */
export function stationChannels(ev: EventFile, st: EventStation): Channel[] {
  return [
    withScope(ev, { index: CHANNEL_SWEEPS, name: 'Sweeps', secret: ev.sweeps_secret }),
    withScope(ev, { index: CHANNEL_STATION_LOG, name: channelName(`${st.id} Log`), secret: st.log_secret }),
    withScope(ev, {
      index: CHANNEL_STATION_CHAT,
      name: channelName(`${st.id} Chat`),
      secret: st.chat_secret,
    }),
    withScope(ev, { index: CHANNEL_ALL_RACE, name: 'All Race', secret: ev.all_race_secret }),
  ]
}

/**
 * All channels for net control: sweeps, all-race, then log and chat for each station. The fixed station
 * layout (0..3) does not apply here; net control is a listener, not a station, so the apps' indexes
 * do not matter for it.
 */
export function netControlChannels(ev: EventFile): Channel[] {
  const list: Omit<Channel, 'index'>[] = [
    { name: 'Sweeps', secret: ev.sweeps_secret },
    { name: 'All Race', secret: ev.all_race_secret },
    ...ev.stations.flatMap((s) => [
      { name: channelName(`${s.id} Log`), secret: s.log_secret },
      { name: channelName(`${s.id} Chat`), secret: s.chat_secret },
    ]),
  ]
  if (list.length > CHANNEL_SLOTS)
    throw new Error(`net control would need ${list.length} channels but a node has ${CHANNEL_SLOTS} slots`)
  return list.map((c, index) => ({ index, ...c }))
}

const toProfileChannels = (cs: Channel[]) => cs.map((c) => ({ name: c.name, secret: c.secret }))

function check<T extends CompanionProfile | TrackerProfile>(p: T): T {
  const problems = validateProfile(p)
  if (problems.length) throw new Error('derived profile is invalid:\n  ' + problems.join('\n  '))
  return p
}

const base = (ev: EventFile) => ({
  wipe_first: true,
  radio: { ...ev.radio },
  identity: { mode: 'generate' as const },
  ...(ev.ble_pin !== undefined ? { ble_pin: ev.ble_pin } : {}),
})

/** A gateway has no BLE, so it takes everything a station radio does except the PIN. */
const gatewayBase = (ev: EventFile) => {
  const { ble_pin: _pin, ...rest } = base(ev)
  void _pin
  return rest
}

/** A station radio: the four channels in index order, a name like `AS3-{n}`, a fresh identity, wiped first. */
export function stationCompanionProfile(ev: EventFile, st: EventStation): CompanionProfile {
  return check({
    kind: 'companion',
    firmware_variant: ev.companion_variant ?? DEFAULT_COMPANION_ENV,
    ...base(ev),
    channels: toProfileChannels(stationChannels(ev, st)),
    advert: { name_template: `${st.id}-{n}` },
  })
}

/** The station's Ethernet gateway: same four channels, one device per station so no counter in its name. */
export function stationGatewayProfile(ev: EventFile, st: EventStation): CompanionProfile {
  return check({
    kind: 'gateway',
    firmware_variant: GATEWAY_ENV,
    ...gatewayBase(ev),
    channels: toProfileChannels(stationChannels(ev, st)),
    advert: { name_template: `${st.id}-GW` },
  })
}

/** A device that hears everything. Not for a station: it carries every station's secrets. */
export function netControlProfile(ev: EventFile): CompanionProfile {
  return check({
    kind: 'companion',
    firmware_variant: ev.companion_variant ?? DEFAULT_COMPANION_ENV,
    ...base(ev),
    channels: toProfileChannels(netControlChannels(ev)),
    advert: { name_template: 'NetControl-{n}' },
  })
}

/** Trackers hold one channel, the sweeps channel; the name (`Sweep{n}`) becomes the team name in sweep-tracker. */
export function trackerProfile(ev: EventFile): TrackerProfile {
  const config = {
    channel_name: 'Sweeps',
    channel_psk: ev.sweeps_secret,
    freq: ev.radio.freq,
    bw: ev.radio.bw,
    sf: ev.radio.sf,
    cr: ev.radio.cr,
    ...(ev.radio.tx_power !== undefined ? { tx_power: ev.radio.tx_power } : {}),
  }
  const problems = validateTrackerConfig(config)
  if (problems.length) throw new Error('derived tracker config is invalid:\n  ' + problems.join('\n  '))
  return check({
    kind: 'tracker',
    firmware_variant: ev.trackers.firmware_variant ?? DEFAULT_TRACKER_ENV,
    name_template: ev.trackers.name_template,
    config,
  })
}

export type GoBoxSettings = {
  /** `.env` file (relative to the go-box) -> its settings, in order. */
  files: { file: string; lines: [key: string, value: string][] }[]
  /** The reminder to show next to the address. */
  reminder: string
}

/**
 * Per-station values for the go-box. Channel indexes are constants of the layout; only the gateway address
 * varies. The address is a DHCP lease: reserve it by the gateway's MAC on the AREDN node.
 */
export function goBoxSettings(st: EventStation): GoBoxSettings {
  return {
    files: [
      {
        file: 'meshcore-bridge/.env',
        lines: [
          ['MESHCORE_ADDRESS', st.gateway_address ?? ''],
          ['MESHCORE_PORT', String(GATEWAY_TCP_PORT)],
        ],
      },
      { file: 'bib-logger/.env', lines: [['MESHCORE_CHANNEL_INDEX', String(CHANNEL_STATION_LOG)]] },
      { file: 'sweep-tracker/.env', lines: [['SWEEP_MESHCORE_CHANNEL', String(CHANNEL_SWEEPS)]] },
    ],
    reminder:
      'The gateway gets its address by DHCP. Reserve it by MAC address on the AREDN node, then put that address in MESHCORE_ADDRESS.',
  }
}

export function formatGoBoxEnv(g: GoBoxSettings): string {
  return g.files.map((f) => `# ${f.file}\n` + f.lines.map(([k, v]) => `${k}=${v}`).join('\n')).join('\n\n')
}

/** What one station gets: its own profiles and settings, and no other station's secrets. */
export type StationBundle = {
  format: 'meshcore-station-bundle'
  version: 1
  event: string
  firmware_tag: string
  station: { id: string; name: string }
  companion: CompanionProfile
  gateway: CompanionProfile
  gobox: GoBoxSettings
}

export function stationBundle(ev: EventFile, st: EventStation): StationBundle {
  return {
    format: 'meshcore-station-bundle',
    version: 1,
    event: ev.name,
    firmware_tag: ev.firmware_tag,
    station: { id: st.id, name: st.name },
    companion: stationCompanionProfile(ev, st),
    gateway: stationGatewayProfile(ev, st),
    gobox: goBoxSettings(st),
  }
}

/** Channel indexes as a table for the operator (names only, never secrets). */
export function channelTable(cs: Channel[]): string[] {
  return cs.map((c) => `${c.index}  ${c.name}`)
}
