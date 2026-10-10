import { describe, expect, it } from 'vitest'
import {
  addStation,
  CHANNEL_ALL_RACE,
  CHANNEL_SLOTS,
  channelTable,
  createEventFile,
  formatGoBoxEnv,
  GATEWAY_ENV,
  goBoxSettings,
  MAX_STATIONS,
  netControlChannels,
  netControlProfile,
  parseEventFile,
  removeStation,
  rotateStationSecrets,
  stationBundle,
  stationChannels,
  stationCompanionProfile,
  stationGatewayProfile,
  trackerNames,
  trackerProfile,
  validateEventFile,
  type EventFile,
  type NewEventParams,
  type RandomBytes,
} from './event'
import { validateProfile } from './profile'

/** Deterministic, never repeats: a counter spread over 16 bytes. */
function counterRng(start = 1): RandomBytes {
  let n = start
  return (len) => {
    const b = new Uint8Array(len)
    new DataView(b.buffer).setUint32(0, n++ * 2654435761)
    b[len - 1] = n
    return b
  }
}

const params = (stations = 7): NewEventParams => ({
  name: 'ARES 100',
  firmware_tag: 'ares-v1.0.0',
  radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
  stationIds: Array.from({ length: stations }, (_, i) => ({
    id: `AS${i + 1}`,
    name: `Aid Station ${i + 1}`,
  })),
  trackers: { name_template: 'Sweep{n}', count: 4 },
  created: '2026-10-10T12:00:00Z',
})

const make = (stations = 7): EventFile => createEventFile(params(stations), counterRng())

describe('createEventFile', () => {
  it('makes a valid event with a distinct random secret for every channel', () => {
    const ev = make()
    expect(validateEventFile(ev)).toEqual([])
    const secrets = [
      ev.sweeps_secret,
      ev.all_race_secret,
      ...ev.stations.flatMap((s) => [s.log_secret, s.chat_secret]),
    ]
    expect(secrets).toHaveLength(16)
    expect(new Set(secrets).size).toBe(16)
    for (const s of secrets) expect(s).toMatch(/^[0-9a-f]{32}$/)
  })

  it('never derives secrets from names', () => {
    const a = createEventFile(params(), counterRng(1))
    const b = createEventFile(params(), counterRng(1000))
    expect(a.stations[0].log_secret).not.toBe(b.stations[0].log_secret)
    expect(a.sweeps_secret).not.toBe(b.sweeps_secret)
  })

  it('retries on a repeated key and gives up on a stuck random source', () => {
    const calls: number[] = []
    const rng: RandomBytes = (n) => {
      calls.push(n)
      return new Uint8Array(n).fill(calls.length < 3 ? 0 : calls.length)
    }
    // all-zero keys are rejected, the first non-zero one is taken, later repeats are rejected too
    expect(() => createEventFile(params(1), rng)).not.toThrow()
    expect(() => createEventFile(params(1), (n) => new Uint8Array(n))).toThrow(/same or an empty key/)
    expect(() => createEventFile(params(1), () => new Uint8Array(4))).toThrow(/wrong number of bytes/)
  })

  it('rejects invalid input', () => {
    expect(() => createEventFile({ ...params(), firmware_tag: 'v1' }, counterRng())).toThrow(/firmware_tag/)
  })
})

describe('validateEventFile', () => {
  const bad = (patch: Record<string, unknown>) => validateEventFile({ ...make(2), ...patch }).join('\n')

  it('rejects non-objects and wrong headers', () => {
    expect(validateEventFile(null)).toEqual(['event file must be a JSON object'])
    expect(validateEventFile([])).toEqual(['event file must be a JSON object'])
    expect(bad({ format: 'x', version: 2 })).toMatch(/format.*\n.*version/)
  })

  it('checks name, created, tag', () => {
    expect(bad({ name: ' ' })).toMatch(/name is required/)
    expect(bad({ created: 'soon' })).toMatch(/created must be a date/)
    expect(bad({ firmware_tag: 'ares-v1.0' })).toMatch(/firmware_tag/)
  })

  it('checks the radio', () => {
    expect(bad({ radio: undefined })).toMatch(/radio is required/)
    expect(bad({ radio: { freq: 1, bw: 62.5, sf: 7, cr: 5 } })).toMatch(/radio.freq/)
    expect(bad({ radio: { freq: 910, bw: 62.5, sf: 7, cr: 5, tx_power: 30 } })).toMatch(/at most 22/)
  })

  it('checks secrets', () => {
    expect(bad({ sweeps_secret: 'nope' })).toMatch(/sweeps_secret must be 32 lowercase hex/)
    expect(bad({ all_race_secret: 'A'.repeat(32) })).toMatch(/all_race_secret/)
  })

  it('rejects two channels sharing a secret', () => {
    const ev = make(2)
    expect(bad({ all_race_secret: ev.sweeps_secret })).toMatch(/own secret/)
  })

  it('checks stations', () => {
    expect(bad({ stations: [] })).toMatch(/at least one station/)
    expect(bad({ stations: undefined })).toMatch(/at least one station/)
    const ev = make(2)
    const dup = [ev.stations[0], { ...ev.stations[1], id: 'as1' }]
    expect(bad({ stations: dup })).toMatch(/used twice/)
    expect(bad({ stations: [{ ...ev.stations[0], id: 'bad id!', name: '', gateway_address: ' ' }] })).toMatch(
      /id must be.*\n.*name is required\n.*gateway_address/s,
    )
    expect(bad({ stations: [null] })).toMatch(/id must be/)
  })

  it('caps the number of stations at what net control can hold', () => {
    expect(MAX_STATIONS * 2 + 2).toBe(CHANNEL_SLOTS)
    const ev = make(MAX_STATIONS)
    expect(validateEventFile(ev)).toEqual([])
    expect(netControlChannels(ev)).toHaveLength(CHANNEL_SLOTS)
    const over = addStationRaw(ev)
    expect(validateEventFile(over).join()).toMatch(/at most 19 stations/)
    expect(() => netControlChannels(over)).toThrow(/slots/)
  })

  it('checks trackers', () => {
    expect(bad({ trackers: undefined })).toMatch(/trackers is required/)
    expect(bad({ trackers: { name_template: 'Sweep', count: 2 } })).toMatch(/contain \{n\}/)
    expect(bad({ trackers: { name_template: 'Sweep{n}', count: 1.5 } })).toMatch(/count must be an integer/)
    expect(bad({ trackers: { name_template: 'x'.repeat(40) + '{n}', count: 2 } })).toMatch(/1-31 characters/)
    expect(validateEventFile({ ...make(2), trackers: { name_template: 'Sweep{n}', count: 0 } })).toEqual([])
  })

  it('checks optional ble_pin and scope', () => {
    expect(bad({ ble_pin: 12 })).toMatch(/ble_pin/)
    expect(validateEventFile({ ...make(2), ble_pin: 123456 })).toEqual([])
    expect(bad({ scope: [] })).toMatch(/scope must be an object/)
    expect(validateEventFile({ ...make(2), scope: { '0': 'sweeps-region' } })).toEqual([])
  })
})

function addStationRaw(ev: EventFile): EventFile {
  const extra = counterRng(5000)
  const h = (n: number) => Array.from(extra(16), (b) => b.toString(16).padStart(2, '0')).join('') + String(n)
  return {
    ...ev,
    stations: [
      ...ev.stations,
      { id: 'EXTRA', name: 'Extra', log_secret: h(0).slice(0, 32), chat_secret: h(1).slice(0, 32) },
    ],
  }
}

describe('parseEventFile', () => {
  it('round-trips', () => {
    const ev = make(3)
    expect(parseEventFile(JSON.stringify(ev))).toEqual(ev)
  })
  it('reports bad JSON and bad content', () => {
    expect(() => parseEventFile('{')).toThrow(/not valid JSON/)
    expect(() => parseEventFile('{}')).toThrow(/invalid event file/)
  })
})

describe('editing', () => {
  it('adds a station with secrets that differ from all others', () => {
    const ev = make(2)
    const next = addStation(ev, 'AS3', 'Aid Station 3', counterRng(777))
    expect(next.stations).toHaveLength(3)
    const all = [
      next.sweeps_secret,
      next.all_race_secret,
      ...next.stations.flatMap((s) => [s.log_secret, s.chat_secret]),
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(ev.stations).toHaveLength(2) // original untouched
    expect(() => addStation(ev, 'AS1', 'dup', counterRng(9))).toThrow(/used twice/)
  })

  it('rotates only the named station', () => {
    const ev = make(3)
    const next = rotateStationSecrets(ev, 'AS2', counterRng(4242))
    expect(next.stations[1].log_secret).not.toBe(ev.stations[1].log_secret)
    expect(next.stations[1].chat_secret).not.toBe(ev.stations[1].chat_secret)
    expect(next.stations[0]).toEqual(ev.stations[0])
    expect(next.stations[2]).toEqual(ev.stations[2])
    expect(next.sweeps_secret).toBe(ev.sweeps_secret)
    expect(() => rotateStationSecrets(ev, 'nope', counterRng())).toThrow(/no station/)
  })

  it('removes a station', () => {
    expect(removeStation(make(3), 'AS2').stations.map((s) => s.id)).toEqual(['AS1', 'AS3'])
  })
})

describe('channel layout', () => {
  const ev = make(3)

  it('gives every station the same fixed indexes 0..3 in order', () => {
    for (const st of ev.stations) {
      const cs = stationChannels(ev, st)
      expect(cs.map((c) => c.index)).toEqual([0, 1, 2, 3])
      expect(cs[0].secret).toBe(ev.sweeps_secret)
      expect(cs[1].secret).toBe(st.log_secret)
      expect(cs[2].secret).toBe(st.chat_secret)
      expect(cs[CHANNEL_ALL_RACE].secret).toBe(ev.all_race_secret)
      expect(cs.map((c) => c.name)).toEqual(['Sweeps', `${st.id} Log`, `${st.id} Chat`, 'All Race'])
    }
  })

  it('shares only the event-wide secrets between stations', () => {
    const a = stationChannels(ev, ev.stations[0]).map((c) => c.secret)
    const b = stationChannels(ev, ev.stations[1]).map((c) => c.secret)
    expect(a.filter((s) => b.includes(s))).toEqual([ev.sweeps_secret, ev.all_race_secret])
  })

  it('carries an optional scope per channel without depending on it', () => {
    const scoped = { ...ev, scope: { '1': 'as1' } }
    const cs = stationChannels(scoped, ev.stations[0])
    expect(cs[1].scope).toBe('as1')
    expect(cs[0].scope).toBeUndefined()
    expect(stationCompanionProfile(scoped, ev.stations[0]).channels).toHaveLength(4)
  })

  it('lays out 16 channels for 7 stations at net control', () => {
    const e7 = make(7)
    const cs = netControlChannels(e7)
    expect(cs).toHaveLength(16)
    expect(cs.map((c) => c.index)).toEqual(Array.from({ length: 16 }, (_, i) => i))
    expect(new Set(cs.map((c) => c.name)).size).toBe(16)
    expect(new Set(cs.map((c) => c.secret)).size).toBe(16)
  })

  it('rejects a channel name over 31 bytes', () => {
    const long = { ...ev, stations: [{ ...ev.stations[0], id: 'ABCDEFGHIJKL' }] }
    expect(() => stationChannels(long, long.stations[0])).not.toThrow()
    const crazy = { ...ev.stations[0], id: 'é'.repeat(20) }
    expect(() => stationChannels(ev, crazy)).toThrow(/31 bytes/)
  })

  it('prints a table without secrets', () => {
    const lines = channelTable(stationChannels(ev, ev.stations[0]))
    expect(lines).toEqual(['0  Sweeps', '1  AS1 Log', '2  AS1 Chat', '3  All Race'])
    expect(lines.join()).not.toContain(ev.sweeps_secret)
  })
})

describe('derived profiles', () => {
  const ev = { ...make(3), ble_pin: 123456 }

  it('station radio profile validates and wipes first with a fresh identity', () => {
    const p = stationCompanionProfile(ev, ev.stations[0])
    expect(validateProfile(p)).toEqual([])
    expect(p).toMatchObject({
      kind: 'companion',
      wipe_first: true,
      identity: { mode: 'generate' },
      ble_pin: 123456,
      advert: { name_template: 'AS1-{n}' },
      radio: ev.radio,
    })
    expect(p.channels).toHaveLength(4)
    expect(p.firmware_variant).toBe('Xiao_nrf52_companion_radio_usb_ble')
  })

  it('honours a chosen companion variant and omits ble_pin when unset', () => {
    const p = stationCompanionProfile(
      { ...make(1), companion_variant: 'RAK_4631_companion_radio_usb_ble' },
      make(1).stations[0],
    )
    expect(p.firmware_variant).toBe('RAK_4631_companion_radio_usb_ble')
    expect('ble_pin' in p).toBe(false)
  })

  it('gateway profile uses the ethernet env and a fixed name', () => {
    const p = stationGatewayProfile(ev, ev.stations[1])
    expect(validateProfile(p)).toEqual([])
    expect(p.firmware_variant).toBe(GATEWAY_ENV)
    expect(p.advert?.name_template).toBe('AS2-GW')
    expect(p.channels?.map((c) => c.secret)).toEqual(stationChannels(ev, ev.stations[1]).map((c) => c.secret))
  })

  it('station profiles never contain another station’s secrets', () => {
    const json = JSON.stringify([
      stationCompanionProfile(ev, ev.stations[0]),
      stationGatewayProfile(ev, ev.stations[0]),
    ])
    expect(json).not.toContain(ev.stations[1].log_secret)
    expect(json).not.toContain(ev.stations[2].chat_secret)
  })

  it('net-control profile holds every channel', () => {
    const p = netControlProfile(ev)
    expect(validateProfile(p)).toEqual([])
    expect(p.channels).toHaveLength(2 + 2 * 3)
    expect(p.advert?.name_template).toBe('NetControl-{n}')
  })

  it('tracker profile holds only the sweeps channel and a templated name', () => {
    const p = trackerProfile(ev)
    expect(validateProfile(p)).toEqual([])
    expect(p.name_template).toBe('Sweep{n}')
    expect(p.config).toMatchObject({
      channel_name: 'Sweeps',
      channel_psk: ev.sweeps_secret,
      freq: 910.525,
      tx_power: 20,
    })
    expect(JSON.stringify(p)).not.toContain(ev.all_race_secret)
    expect(JSON.stringify(p)).not.toContain(ev.stations[0].log_secret)
    expect(p.firmware_variant).toBe('t1000e_gps_tracker')
  })

  it('tracker profile omits tx_power when the radio has none and honours the variant', () => {
    const e = make(1)
    const { tx_power: _drop, ...radio } = e.radio
    void _drop
    const p = trackerProfile({
      ...e,
      radio,
      trackers: { ...e.trackers, firmware_variant: 'Xiao_nrf52_gps_tracker' },
    })
    expect('tx_power' in p.config).toBe(false)
    expect(p.firmware_variant).toBe('Xiao_nrf52_gps_tracker')
  })

  it('tracker names are stable and unique', () => {
    expect(trackerNames(ev)).toEqual(['Sweep1', 'Sweep2', 'Sweep3', 'Sweep4'])
    expect(trackerNames(make(1))).toEqual(trackerNames(make(1)))
    expect(new Set(trackerNames({ ...ev, trackers: { name_template: 'Sweep{n}', count: 99 } })).size).toBe(99)
  })

  it('a derived profile that fails validation is reported, not emitted', () => {
    const broken = { ...ev, ble_pin: 5 }
    expect(() => stationCompanionProfile(broken, ev.stations[0])).toThrow(/derived profile is invalid/)
    const noTrackerOk = { ...ev, radio: { ...ev.radio, sf: 4 } }
    expect(() => trackerProfile(noTrackerOk)).toThrow(/derived tracker config is invalid/)
  })
})

describe('go-box export', () => {
  it('uses constant channel indexes and the gateway address', () => {
    const st = { ...make(1).stations[0], gateway_address: '10.1.2.3' }
    const g = goBoxSettings(st)
    expect(g.files).toEqual([
      {
        file: 'meshcore-bridge/.env',
        lines: [
          ['MESHCORE_ADDRESS', '10.1.2.3'],
          ['MESHCORE_PORT', '5000'],
        ],
      },
      { file: 'bib-logger/.env', lines: [['MESHCORE_CHANNEL_INDEX', '1']] },
      { file: 'sweep-tracker/.env', lines: [['SWEEP_MESHCORE_CHANNEL', '0']] },
    ])
    expect(g.reminder).toMatch(/Reserve it by MAC/)
    expect(formatGoBoxEnv(g)).toBe(
      '# meshcore-bridge/.env\nMESHCORE_ADDRESS=10.1.2.3\nMESHCORE_PORT=5000\n\n# bib-logger/.env\nMESHCORE_CHANNEL_INDEX=1\n\n# sweep-tracker/.env\nSWEEP_MESHCORE_CHANNEL=0',
    )
  })

  it('leaves the address blank until it is known', () => {
    expect(goBoxSettings(make(1).stations[0]).files[0].lines[0]).toEqual(['MESHCORE_ADDRESS', ''])
  })
})

describe('station bundle', () => {
  it('contains the station’s profiles, the tag and no other station’s secrets', () => {
    const ev = make(3)
    const b = stationBundle(ev, ev.stations[1])
    expect(b).toMatchObject({
      format: 'meshcore-station-bundle',
      event: 'ARES 100',
      firmware_tag: 'ares-v1.0.0',
      station: { id: 'AS2' },
    })
    const json = JSON.stringify(b)
    for (const other of [ev.stations[0], ev.stations[2]]) {
      expect(json).not.toContain(other.log_secret)
      expect(json).not.toContain(other.chat_secret)
    }
    expect(b.gateway.advert?.name_template).toBe('AS2-GW')
    expect(json).toContain(ev.stations[1].log_secret)
    expect(json).toContain(ev.sweeps_secret)
  })
})

describe('gateway kind in derived output', () => {
  it('is kind gateway without a BLE PIN even when the event has one', () => {
    const ev = { ...make(1), ble_pin: 123456 }
    const g = stationGatewayProfile(ev, ev.stations[0])
    expect(g.kind).toBe('gateway')
    expect('ble_pin' in g).toBe(false)
    expect(stationCompanionProfile(ev, ev.stations[0]).ble_pin).toBe(123456)
  })
})
