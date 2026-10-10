import { bytesToHex } from '../domain/bytes'
import {
  ERR_ILLEGAL_ARG,
  cmd,
  parseAutoadd,
  parseChannelInfo,
  parseCustomVars,
  parseDeviceInfo,
  parseFloodScope,
  parsePrivateKey,
  parseSelfInfo,
  type ChannelInfo,
  type DeviceInfo,
  type FloodScope,
  type SelfInfo,
} from '../domain/companion'
import { hexToBytes } from '../domain/bytes'
import { parseChannelSecret, parsePrivateKey as parseKeyHex, type CompanionProfile } from '../domain/profile'
import { CompanionClient, CompanionDisabledError, CompanionError } from './companionClient'
import type { Clock, Logger } from './ports'

export type CompanionState = {
  self: SelfInfo
  device: DeviceInfo
  channels: ChannelInfo[]
  floodScope: FloodScope
  autoadd: { config: number; maxHops: number } | null
  customVars: Record<string, string>
}

export async function readIdentity(c: CompanionClient): Promise<{ self: SelfInfo; device: DeviceInfo }> {
  const self = parseSelfInfo(await c.request(cmd.appStart(), 'app start'))
  const device = parseDeviceInfo(await c.request(cmd.deviceQuery(), 'device query'))
  return { self, device }
}

export async function readChannels(c: CompanionClient, max: number): Promise<ChannelInfo[]> {
  const out: ChannelInfo[] = []
  for (let i = 0; i < max; i++) {
    try {
      out.push(parseChannelInfo(await c.request(cmd.getChannel(i), `get channel ${i}`)))
    } catch (e) {
      if (e instanceof CompanionError && e.code === 2) break // not found: past the last slot
      throw e
    }
  }
  return out
}

async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    if (e instanceof CompanionError && (e.code === 1 || e instanceof CompanionDisabledError)) return null
    throw e
  }
}

/** Everything we can read back from a node. Used for backup and for verifying a configure. */
export async function readState(c: CompanionClient): Promise<CompanionState> {
  const { self, device } = await readIdentity(c)
  return {
    self,
    device,
    channels: await readChannels(c, device.maxChannels),
    floodScope:
      (await optional(c.request(cmd.getDefaultFloodScope(), 'get flood scope').then(parseFloodScope))) ??
      null,
    autoadd: await optional(c.request(cmd.getAutoadd(), 'get autoadd').then(parseAutoadd)),
    customVars:
      (await optional(c.request(cmd.getCustomVars(), 'get custom vars').then(parseCustomVars))) ?? {},
  }
}

export async function readPrivateKey(c: CompanionClient): Promise<Uint8Array | null> {
  return optional(c.request(cmd.exportPrivateKey(), 'export private key').then(parsePrivateKey))
}

export type ConfigureOptions = { nodeName?: string; clock: Clock; log: Logger }

/** Write the profile's fields to the node (only the fields present). Returns what was applied, for the log. */
export async function applyCompanionProfile(
  c: CompanionClient,
  p: CompanionProfile,
  o: ConfigureOptions,
): Promise<string[]> {
  const done: string[] = []
  const step = async (label: string, fn: () => Promise<void>) => {
    o.log.info('companion configure', { step: label })
    await fn()
    done.push(label)
  }

  // the device refuses to move its clock backwards; that is fine
  try {
    await c.ok(cmd.setDeviceTime(Math.floor(o.clock.now().getTime() / 1000)), 'set time')
    done.push('time')
  } catch (e) {
    if (!(e instanceof CompanionError && e.code === ERR_ILLEGAL_ARG)) throw e
  }

  if (p.identity?.mode === 'import') {
    await step('identity', () =>
      c.ok(
        cmd.importPrivateKey(
          parseKeyHex(p.identity && 'private_key' in p.identity ? p.identity.private_key : ''),
        ),
        'import private key',
      ),
    )
  }
  if (p.radio) {
    const r = p.radio
    await step('radio', () => c.ok(cmd.setRadioParams(r), 'set radio params'))
    if (r.tx_power !== undefined)
      await step('tx power', () => c.ok(cmd.setTxPower(r.tx_power!), 'set tx power'))
  }
  if (p.channels) {
    for (const [i, ch] of p.channels.entries()) {
      await step(`channel ${i}`, () =>
        c.ok(cmd.setChannel(i, ch.name, parseChannelSecret(ch.secret)), `set channel ${i}`),
      )
    }
  }
  if (o.nodeName !== undefined)
    await step('name', () => c.ok(cmd.setAdvertName(o.nodeName!), 'set advert name'))
  if (p.advert?.lat !== undefined && p.advert.lon !== undefined) {
    const { lat, lon } = p.advert
    await step('location', () => c.ok(cmd.setAdvertLatLon(lat, lon!), 'set location'))
  }
  if (p.advert?.flood_scope) {
    const f = p.advert.flood_scope
    await step('flood scope', () =>
      c.ok(cmd.setDefaultFloodScope(f.name, hexToBytes(f.key)), 'set flood scope'),
    )
  }
  if (p.ble_pin !== undefined) await step('ble pin', () => c.ok(cmd.setDevicePin(p.ble_pin!), 'set ble pin'))
  if (p.autoadd) {
    const a = p.autoadd
    await step('autoadd', () => c.ok(cmd.setAutoadd(a.config, a.max_hops), 'set autoadd'))
  }
  if (p.gps) await applyGps(c, p.gps, step)
  return done
}

/** The node only lists a `gps` setting when its firmware has GPS support and a GPS was detected. */
export async function readCustomVars(c: CompanionClient): Promise<Record<string, string>> {
  return parseCustomVars(await c.request(cmd.getCustomVars(), 'get custom vars'))
}

async function applyGps(
  c: CompanionClient,
  gps: NonNullable<CompanionProfile['gps']>,
  step: (label: string, fn: () => Promise<void>) => Promise<void>,
) {
  if (!('gps' in (await readCustomVars(c)))) {
    // GPS can only be switched on where one exists; off is already the state of a node without one
    if (gps.enabled)
      throw new CompanionError(
        'this node has no GPS (the firmware has none, or none was detected), so it cannot be enabled',
      )
    if (gps.interval_sec !== undefined)
      throw new CompanionError('this node has no GPS, so a GPS interval cannot be set')
    return
  }
  await step('gps', () => c.ok(cmd.setCustomVar('gps', gps.enabled ? '1' : '0'), 'set gps'))
  if (gps.interval_sec !== undefined) {
    const n = gps.interval_sec
    await step('gps interval', () => c.ok(cmd.setCustomVar('gps_interval', String(n)), 'set gps interval'))
  }
}

/** Compare the node against the profile. Returns mismatches; secrets are never printed. */
export async function verifyCompanionProfile(
  c: CompanionClient,
  p: CompanionProfile,
  nodeName?: string,
): Promise<string[]> {
  const bad: string[] = []
  const s = await readState(c)
  if (p.radio) {
    const r = p.radio
    if (Math.abs(s.self.freq - r.freq) > 0.0015) bad.push(`freq: expected ${r.freq}, node has ${s.self.freq}`)
    if (Math.abs(s.self.bw - r.bw) > 0.0015) bad.push(`bw: expected ${r.bw}, node has ${s.self.bw}`)
    if (s.self.sf !== r.sf) bad.push(`sf: expected ${r.sf}, node has ${s.self.sf}`)
    if (s.self.cr !== r.cr) bad.push(`cr: expected ${r.cr}, node has ${s.self.cr}`)
    if (r.tx_power !== undefined && s.self.txPower !== r.tx_power)
      bad.push(`tx power: expected ${r.tx_power}, node has ${s.self.txPower}`)
  }
  p.channels?.forEach((ch, i) => {
    const got = s.channels[i]
    if (!got) return void bad.push(`channel ${i}: missing on node`)
    if (got.name !== ch.name) bad.push(`channel ${i}: name expected '${ch.name}', node has '${got.name}'`)
    if (bytesToHex(got.secret) !== bytesToHex(parseChannelSecret(ch.secret)))
      bad.push(`channel ${i}: secret does not match`)
  })
  if (nodeName !== undefined && s.self.name !== nodeName)
    bad.push(`name: expected '${nodeName}', node has '${s.self.name}'`)
  if (p.advert?.lat !== undefined && p.advert.lon !== undefined) {
    if (Math.abs(s.self.lat - p.advert.lat) > 1e-6 || Math.abs(s.self.lon - p.advert.lon!) > 1e-6)
      bad.push('location does not match')
  }
  if (p.advert?.flood_scope) {
    const f = p.advert.flood_scope
    if (!s.floodScope || s.floodScope.name !== f.name || bytesToHex(s.floodScope.key) !== f.key.toLowerCase())
      bad.push('flood scope does not match')
  }
  if (p.ble_pin !== undefined && s.device.blePin !== p.ble_pin) bad.push('ble pin does not match')
  if (p.autoadd && (!s.autoadd || s.autoadd.config !== p.autoadd.config))
    bad.push('autoadd config does not match')
  if (p.gps && 'gps' in s.customVars && s.customVars.gps !== (p.gps.enabled ? '1' : '0')) {
    bad.push(
      `gps: expected ${p.gps.enabled ? 'on' : 'off'}, node has ${s.customVars.gps === '1' ? 'on' : 'off'}`,
    )
  }
  if (p.identity?.mode === 'import') {
    // the node's public key is derived from the key we imported; compare with a fresh export when allowed
    const k = await readPrivateKey(c)
    if (k && bytesToHex(k) !== p.identity.private_key.toLowerCase()) bad.push('identity does not match')
  }
  return bad
}
