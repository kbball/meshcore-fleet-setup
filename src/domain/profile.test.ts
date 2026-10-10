import {
  PUBLIC_CHANNEL_PSK,
  parseChannelSecret,
  parsePrivateKey,
  parseProfile,
  profileHasSecrets,
  validateProfile,
} from './profile'

const hex16 = '00112233445566778899aabbccddeeff'
const companion = {
  kind: 'companion',
  firmware_variant: 'Xiao_nrf52_companion_radio_usb_ble',
  wipe_first: true,
  radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
  channels: [
    { name: 'Public', secret: 'public' },
    { name: 'aid3', secret: hex16 },
  ],
  advert: { name_template: 'AS3-{n}', lat: 33.8, lon: -84.1, flood_scope: { name: 'ga', key: hex16 } },
  identity: { mode: 'generate' },
  ble_pin: 123456,
  autoadd: { config: 2, max_hops: 3 },
}
const tracker = {
  kind: 'tracker',
  firmware_variant: 't1000e_gps_tracker',
  name_template: 'Sweep{n}',
  config: { channel_name: 'race', channel_psk: 'abc=', interval_sec: 300 },
}

describe('validateProfile', () => {
  it('accepts good companion and tracker profiles', () => {
    expect(validateProfile(companion)).toEqual([])
    expect(validateProfile(tracker)).toEqual([])
  })
  it('requires an object with a kind', () => {
    expect(validateProfile(null)).toEqual(['profile must be a JSON object'])
    expect(validateProfile({})[0]).toMatch(/kind must be/)
  })
  it('flags unknown keys and missing basics', () => {
    const p = validateProfile({ kind: 'companion', bogus: 1 })
    expect(p).toEqual(
      expect.arrayContaining([
        'firmware_variant is required',
        'wipe_first must be true or false',
        "unknown key 'bogus'",
      ]),
    )
  })
  it('checks radio', () => {
    expect(validateProfile({ ...companion, radio: { freq: 5, bw: 62.5, sf: 13, cr: 5 } })).toEqual(
      expect.arrayContaining([
        'radio.freq must be between 150 and 2500',
        'radio.sf must be an integer between 5 and 12',
      ]),
    )
    expect(validateProfile({ ...companion, radio: { freq: 910 } })).toEqual(
      expect.arrayContaining(['radio.bw is required', 'radio.sf is required']),
    )
  })
  it('checks channels', () => {
    expect(validateProfile({ ...companion, channels: 'x' })).toContain('channels must be a list')
    const p = validateProfile({ ...companion, channels: [{ name: '', secret: 'zz' }] })
    expect(p.some((m) => m.startsWith('channels[0].name'))).toBe(true)
    expect(p.some((m) => m.startsWith('channels[0].secret'))).toBe(true)
  })
  it('checks advert', () => {
    const p = validateProfile({
      ...companion,
      advert: { lat: 95, name_template: '', flood_scope: { name: '', key: 'x' } },
    })
    expect(p).toEqual(
      expect.arrayContaining([
        'advert.lat must be between -90 and 90',
        'advert.lat and advert.lon must be given together',
        'advert.name_template must be a non-empty string',
        'advert.flood_scope.name must be 1-30 characters',
        'advert.flood_scope.key must be 32 hex characters',
      ]),
    )
  })
  it('checks identity, pin and autoadd', () => {
    expect(validateProfile({ ...companion, identity: { mode: 'import', private_key: 'abc' } })[0]).toMatch(
      /identity.private_key/,
    )
    expect(validateProfile({ ...companion, identity: { mode: 'other' } })).toContain(
      "identity.mode must be 'generate' or 'import'",
    )
    expect(validateProfile({ ...companion, ble_pin: 12 })).toContain('ble_pin must be 0 or a 6 digit number')
    expect(validateProfile({ ...companion, ble_pin: 0 })).toEqual([])
    expect(validateProfile({ ...companion, autoadd: { config: 300, max_hops: 100 } })).toHaveLength(2)
  })
  it('validates the tracker block', () => {
    expect(validateProfile({ kind: 'tracker', firmware_variant: 'x' })).toContain('config is required')
    expect(validateProfile({ ...tracker, name_template: '' })).toContain(
      'name_template must be a non-empty string',
    )
    expect(validateProfile({ ...tracker, config: { sf: 99 } })[0]).toMatch(/^config: sf/)
  })
})

describe('parsing', () => {
  it('parseProfile returns the object or explains why not', () => {
    expect(parseProfile(JSON.stringify(companion)).kind).toBe('companion')
    expect(() => parseProfile('{nope')).toThrow(/not valid JSON/)
    expect(() => parseProfile('{"kind":"tracker"}')).toThrow(/invalid profile/)
  })
  it('channel secrets: hex, base64 and public', () => {
    expect(parseChannelSecret(hex16)).toHaveLength(16)
    expect(parseChannelSecret('public')).toHaveLength(16)
    expect(parseChannelSecret(PUBLIC_CHANNEL_PSK)).toHaveLength(16)
    expect(() => parseChannelSecret('AAAA')).toThrow(/16 bytes/)
    expect(() => parseChannelSecret('%%%')).toThrow(/neither/)
  })
  it('private key is 128 hex chars', () => {
    expect(parsePrivateKey('ab'.repeat(64))).toHaveLength(64)
    expect(() => parsePrivateKey('ab')).toThrow()
  })
  it('knows which profiles carry secrets', () => {
    expect(profileHasSecrets(parseProfile(JSON.stringify(companion)))).toBe(true)
    expect(profileHasSecrets({ kind: 'companion', firmware_variant: 'x', wipe_first: false })).toBe(false)
    expect(profileHasSecrets(tracker as never)).toBe(true)
    expect(profileHasSecrets({ kind: 'tracker', firmware_variant: 'x', config: {} })).toBe(false)
  })
})
