// Editable form model for profiles. Everything is a string, as typed; toProfile turns it into the real
// profile (dropping empty fields) and fromProfile does the reverse so an existing file can be edited.
import type { CompanionProfile, Profile, TrackerProfile } from './profile'
import type { TrackerConfig } from './tracker'

export const FIRMWARE_VARIANTS: { env: string; label: string; kind: ProfileForm['kind'] }[] = [
  {
    env: 'Xiao_nrf52_companion_radio_usb_ble',
    label: 'XIAO nRF52840 companion (USB + BLE)',
    kind: 'companion',
  },
  { env: 't1000e_companion_radio_usb_ble', label: 'T-1000-E companion (USB + BLE)', kind: 'companion' },
  { env: 'RAK_4631_companion_radio_usb_ble', label: 'RAK4631 companion (USB + BLE)', kind: 'companion' },
  {
    env: 'RAK_4631_companion_radio_usb_ethernet',
    label: 'RAK4631 + Ethernet gateway (USB + TCP)',
    kind: 'gateway',
  },
  { env: 't1000e_gps_tracker', label: 'T-1000-E sweep tracker', kind: 'tracker' },
  { env: 'Xiao_nrf52_gps_tracker', label: 'XIAO nRF52840 sweep tracker', kind: 'tracker' },
]

export type ChannelForm = { name: string; secret: string }

export type ProfileForm = {
  kind: 'companion' | 'gateway' | 'tracker'
  firmware_variant: string
  name_template: string // companion: advert name; tracker: node name
  // companion
  wipe_first: boolean
  radio: { enabled: boolean; freq: string; bw: string; sf: string; cr: string; tx_power: string }
  channels: ChannelForm[]
  lat: string
  lon: string
  flood_name: string
  flood_key: string
  identity: 'none' | 'generate' | 'import'
  private_key: string
  ble_pin: string
  autoadd: { enabled: boolean; config: string; max_hops: string }
  gps: 'leave' | 'on' | 'off'
  gps_interval: string
  // tracker (JSON key -> text)
  tracker: Record<keyof TrackerConfig, string>
}

const TRACKER_KEYS: (keyof TrackerConfig)[] = [
  'channel_name',
  'channel_psk',
  'interval_sec',
  'nofix_mode',
  'nofix_notify_interval_sec',
  'freq',
  'bw',
  'sf',
  'cr',
  'tx_power',
  'idle_interval_sec',
  'idle_holdoff_sec',
  'fix_timeout_sec',
  'move_distance_m',
  'motion_threshold',
]
const TRACKER_TEXT = new Set<keyof TrackerConfig>(['channel_name', 'channel_psk', 'nofix_mode'])

export function emptyForm(kind: ProfileForm['kind'] = 'companion'): ProfileForm {
  const tracker = Object.fromEntries(TRACKER_KEYS.map((k) => [k, ''])) as ProfileForm['tracker']
  Object.assign(tracker, {
    interval_sec: '300',
    nofix_mode: 'notify',
    freq: '910.525',
    bw: '62.5',
    sf: '7',
    cr: '5',
    tx_power: '22',
  })
  return {
    kind,
    firmware_variant: FIRMWARE_VARIANTS.find((v) => v.kind === kind)!.env,
    name_template: { companion: 'AS-{n}', gateway: 'AS-GW', tracker: 'Sweep{n}' }[kind],
    wipe_first: true,
    radio: { enabled: true, freq: '910.525', bw: '62.5', sf: '7', cr: '5', tx_power: '20' },
    channels: [{ name: 'Public', secret: 'public' }],
    lat: '',
    lon: '',
    flood_name: '',
    flood_key: '',
    identity: 'generate',
    private_key: '',
    ble_pin: '',
    autoadd: { enabled: false, config: '0', max_hops: '' },
    gps: 'leave',
    gps_interval: '',
    tracker,
  }
}

const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))
const str = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim())

export function toProfile(f: ProfileForm): Profile {
  if (f.kind === 'tracker') {
    const config: Record<string, string | number> = {}
    for (const k of TRACKER_KEYS) {
      const v = f.tracker[k].trim()
      if (v === '') continue
      config[k] = TRACKER_TEXT.has(k) ? v : Number(v)
    }
    const p: TrackerProfile = {
      kind: 'tracker',
      firmware_variant: f.firmware_variant,
      config: config as TrackerConfig,
    }
    if (str(f.name_template)) p.name_template = f.name_template.trim()
    return p
  }
  const p: CompanionProfile = {
    kind: f.kind,
    firmware_variant: f.firmware_variant,
    wipe_first: f.wipe_first,
  }
  if (f.radio.enabled) {
    p.radio = {
      freq: Number(f.radio.freq),
      bw: Number(f.radio.bw),
      sf: Number(f.radio.sf),
      cr: Number(f.radio.cr),
    }
    const tx = num(f.radio.tx_power)
    if (tx !== undefined) p.radio.tx_power = tx
  }
  const channels = f.channels.filter((c) => c.name.trim() !== '' || c.secret.trim() !== '')
  if (channels.length) p.channels = channels.map((c) => ({ name: c.name.trim(), secret: c.secret.trim() }))
  const advert: NonNullable<CompanionProfile['advert']> = {}
  if (str(f.name_template)) advert.name_template = f.name_template.trim()
  if (str(f.lat) || str(f.lon)) {
    advert.lat = Number(f.lat)
    advert.lon = Number(f.lon)
  }
  if (str(f.flood_name) || str(f.flood_key))
    advert.flood_scope = { name: f.flood_name.trim(), key: f.flood_key.trim() }
  if (Object.keys(advert).length) p.advert = advert
  if (f.identity === 'generate') p.identity = { mode: 'generate' }
  if (f.identity === 'import') p.identity = { mode: 'import', private_key: f.private_key.trim() }
  const pin = num(f.ble_pin)
  if (pin !== undefined && f.kind !== 'gateway') p.ble_pin = pin
  if (f.autoadd.enabled) {
    p.autoadd = { config: Number(f.autoadd.config) }
    const hops = num(f.autoadd.max_hops)
    if (hops !== undefined) p.autoadd.max_hops = hops
  }
  if (f.gps !== 'leave') {
    p.gps = { enabled: f.gps === 'on' }
    const iv = num(f.gps_interval)
    if (f.gps === 'on' && iv !== undefined) p.gps.interval_sec = iv
  }
  return p
}

export function fromProfile(p: Profile): ProfileForm {
  const f = emptyForm(p.kind)
  f.firmware_variant = p.firmware_variant
  if (p.kind === 'tracker') {
    f.name_template = p.name_template ?? ''
    f.tracker = Object.fromEntries(
      TRACKER_KEYS.map((k) => [k, p.config[k] === undefined ? '' : String(p.config[k])]),
    ) as ProfileForm['tracker']
    return f
  }
  f.wipe_first = p.wipe_first
  f.radio = p.radio
    ? {
        enabled: true,
        freq: String(p.radio.freq),
        bw: String(p.radio.bw),
        sf: String(p.radio.sf),
        cr: String(p.radio.cr),
        tx_power: p.radio.tx_power === undefined ? '' : String(p.radio.tx_power),
      }
    : { ...f.radio, enabled: false }
  f.channels = (p.channels ?? []).map((c) => ({ name: c.name, secret: c.secret }))
  f.name_template = p.advert?.name_template ?? ''
  f.lat = p.advert?.lat === undefined ? '' : String(p.advert.lat)
  f.lon = p.advert?.lon === undefined ? '' : String(p.advert.lon)
  f.flood_name = p.advert?.flood_scope?.name ?? ''
  f.flood_key = p.advert?.flood_scope?.key ?? ''
  f.identity = p.identity?.mode ?? 'none'
  f.private_key = p.identity?.mode === 'import' ? p.identity.private_key : ''
  f.ble_pin = p.ble_pin === undefined ? '' : String(p.ble_pin)
  f.autoadd = p.autoadd
    ? {
        enabled: true,
        config: String(p.autoadd.config),
        max_hops: p.autoadd.max_hops === undefined ? '' : String(p.autoadd.max_hops),
      }
    : { enabled: false, config: '0', max_hops: '' }
  f.gps = p.gps ? (p.gps.enabled ? 'on' : 'off') : 'leave'
  f.gps_interval = p.gps?.interval_sec === undefined ? '' : String(p.gps.interval_sec)
  return f
}

/** Copy of a profile that is safe to show: keys and secrets replaced. */
export function redactProfile(p: Profile): Profile {
  const mask = '••••••••'
  if (p.kind === 'tracker')
    return { ...p, config: { ...p.config, ...(p.config.channel_psk ? { channel_psk: mask } : {}) } }
  return {
    ...p,
    channels: p.channels?.map((c) => ({ ...c, secret: c.secret === 'public' ? c.secret : mask })), // the public key is not a secret
    identity: p.identity?.mode === 'import' ? { mode: 'import', private_key: mask } : p.identity,
    advert: p.advert?.flood_scope
      ? { ...p.advert, flood_scope: { ...p.advert.flood_scope, key: mask } }
      : p.advert,
  }
}

export const profileFileName = (p: Profile) => `${p.kind}-profile.json`
export const profileJson = (p: Profile) => JSON.stringify(p, null, 2) + '\n'
