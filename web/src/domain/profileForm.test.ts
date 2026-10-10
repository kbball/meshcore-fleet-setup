import { parseProfile, validateProfile } from './profile'
import { emptyForm, fromProfile, profileFileName, profileJson, redactProfile, toProfile } from './profileForm'

describe('profile form', () => {
  it('default forms produce valid profiles', () => {
    expect(validateProfile(toProfile(emptyForm('companion')))).toEqual([])
    const t = emptyForm('tracker')
    t.tracker.channel_name = 'race'
    t.tracker.channel_psk = '00112233445566778899aabbccddeeff'
    expect(validateProfile(toProfile(t))).toEqual([])
  })

  it('companion round trips through the form', () => {
    const f = emptyForm('companion')
    f.channels = [
      { name: 'Public', secret: 'public' },
      { name: 'aid', secret: '00112233445566778899aabbccddeeff' },
    ]
    f.lat = '33.8'
    f.lon = '-84.1'
    f.flood_name = 'ga'
    f.flood_key = '00112233445566778899aabbccddeeff'
    f.identity = 'import'
    f.private_key = 'ab'.repeat(64)
    f.ble_pin = '123456'
    f.autoadd = { enabled: true, config: '2', max_hops: '3' }
    const p = toProfile(f)
    expect(validateProfile(p)).toEqual([])
    expect(toProfile(fromProfile(p))).toEqual(p)
    expect(p).toMatchObject({
      ble_pin: 123456,
      autoadd: { config: 2, max_hops: 3 },
      identity: { mode: 'import' },
    })
  })

  it('omits sections that are switched off or empty', () => {
    const f = emptyForm('companion')
    f.radio.enabled = false
    f.channels = [{ name: '', secret: '' }]
    f.identity = 'none'
    f.name_template = ''
    const p = toProfile(f)
    expect(p).toEqual({ kind: 'companion', firmware_variant: f.firmware_variant, wipe_first: true })
    expect(fromProfile(p).radio.enabled).toBe(false)
    expect(fromProfile(p).identity).toBe('none')
  })

  it('tracker round trips and keeps text fields as text', () => {
    const f = emptyForm('tracker')
    f.tracker.channel_name = 'race'
    f.tracker.channel_psk = 'dHJhY2tlci10ZXN0LWtleQ=='
    f.tracker.interval_sec = '600'
    const p = toProfile(f)
    expect(p).toMatchObject({
      kind: 'tracker',
      name_template: 'Sweep{n}',
      config: { channel_name: 'race', interval_sec: 600, nofix_mode: 'notify' },
    })
    expect(toProfile(fromProfile(p))).toEqual(p)
    f.name_template = ''
    expect('name_template' in toProfile(f)).toBe(false)
  })

  it('bad numbers surface as validation errors rather than being dropped', () => {
    const f = emptyForm('companion')
    f.radio.sf = 'abc'
    expect(validateProfile(toProfile(f))).toContain('radio.sf must be an integer between 5 and 12')
    const t = emptyForm('tracker')
    t.tracker.sf = '99'
    expect(validateProfile(toProfile(t)).some((m) => m.includes('sf'))).toBe(true)
  })

  it('redacts secrets for display', () => {
    const f = emptyForm('companion')
    f.channels = [
      { name: 'Public', secret: 'public' },
      { name: 'aid', secret: '00112233445566778899aabbccddeeff' },
    ]
    f.identity = 'import'
    f.private_key = 'ab'.repeat(64)
    f.flood_name = 'ga'
    f.flood_key = '00112233445566778899aabbccddeeff'
    const shown = JSON.stringify(redactProfile(toProfile(f)))
    expect(shown).not.toContain('0011223344')
    expect(shown).toContain('"secret":"public"') // the public channel key is not a secret
    expect(shown).not.toContain('abababab')
    const t = emptyForm('tracker')
    t.tracker.channel_name = 'r'
    t.tracker.channel_psk = 'SECRET=='
    expect(JSON.stringify(redactProfile(toProfile(t)))).not.toContain('SECRET')
    expect(redactProfile(toProfile(emptyForm('tracker')))).toBeDefined()
  })

  it('serialises to a file that parses back', () => {
    const p = toProfile(emptyForm('companion'))
    expect(parseProfile(profileJson(p))).toEqual(p)
    expect(profileFileName(p)).toBe('companion-profile.json')
  })
})

describe('gps in the form', () => {
  it('is left out by default, and round trips on and off', () => {
    const f = emptyForm('companion')
    expect(toProfile(f)).not.toHaveProperty('gps')
    f.gps = 'on'
    f.gps_interval = '900'
    const on = toProfile(f)
    expect(on).toMatchObject({ gps: { enabled: true, interval_sec: 900 } })
    expect(toProfile(fromProfile(on))).toEqual(on)
    f.gps = 'off'
    const off = toProfile(f)
    expect(off).toMatchObject({ gps: { enabled: false } }) // an interval makes no sense when disabling
    expect(off).not.toHaveProperty('gps.interval_sec')
    expect(fromProfile(off).gps).toBe('off')
    f.gps = 'on'
    f.gps_interval = ''
    expect(toProfile(f)).toMatchObject({ gps: { enabled: true } })
    expect(toProfile(f)).not.toHaveProperty('gps.interval_sec')
  })
})
