import {
  buildTrackerCommands,
  expandName,
  normalizePsk,
  redactCommand,
  validateTrackerConfig,
  valuesMatch,
} from './tracker'

const good = {
  channel_name: 'race',
  channel_psk: 'dHJhY2tlci10ZXN0LWtleQ==',
  interval_sec: 300,
  nofix_mode: 'notify',
  freq: 910.525,
  bw: 62.5,
  sf: 7,
  cr: 5,
  tx_power: 22,
}

describe('validateTrackerConfig', () => {
  it('accepts a good config', () => expect(validateTrackerConfig(good)).toEqual([]))
  it('rejects non-objects', () => {
    expect(validateTrackerConfig([])).toEqual(['config must be a JSON object'])
    expect(validateTrackerConfig(null)).toEqual(['config must be a JSON object'])
  })
  it('flags unknown keys, with a hint for name', () => {
    const p = validateTrackerConfig({ name: 'x', bogus: 1 })
    expect(p.some((m) => m.includes("'name'") && m.includes('template'))).toBe(true)
    expect(p).toContain("unknown key 'bogus'")
  })
  it('needs channel name and psk together', () => {
    expect(validateTrackerConfig({ channel_name: 'a' })).toContain(
      'channel_name and channel_psk must be given together',
    )
  })
  it('checks channel strings', () => {
    expect(validateTrackerConfig({ channel_name: '', channel_psk: 'a b' })).toHaveLength(2)
    expect(validateTrackerConfig({ channel_name: 'x'.repeat(32), channel_psk: 'k' })).toContain(
      'channel_name must be at most 31 characters',
    )
  })
  it('enforces the interval floor from the device', () => {
    expect(validateTrackerConfig({ interval_sec: 299 })).toEqual([
      'interval_sec must be between 300 and 86400',
    ])
    expect(validateTrackerConfig({ interval_sec: 60 }, 60)).toEqual([])
  })
  it('checks number types and ranges', () => {
    expect(validateTrackerConfig({ sf: 7.5 })).toContain('sf must be an integer')
    expect(validateTrackerConfig({ freq: 'x' })).toContain('freq must be a number')
    expect(validateTrackerConfig({ sf: 13 })).toContain('sf must be between 5 and 12')
    expect(validateTrackerConfig({ tx_power: -10 })).toContain('tx_power must be between -9 and 22')
  })
  it('checks bandwidth and nofix_mode', () => {
    expect(validateTrackerConfig({ bw: 100 })[0]).toMatch(/^bw must be one of/)
    expect(validateTrackerConfig({ bw: '62.5' })[0]).toMatch(/^bw must be one of/)
    expect(validateTrackerConfig({ nofix_mode: 'loud' })).toContain("nofix_mode must be 'silent' or 'notify'")
  })
})

describe('commands', () => {
  it('orders name, channel, then simple keys, with a verify-only psk', () => {
    const cmds = buildTrackerCommands({ ...good, nofix_mode: 'notify' }, 'Sweep1')
    expect(cmds[0]).toEqual({ command: 'set name Sweep1', readbackKey: 'name', expected: 'Sweep1' })
    expect(cmds[1].command).toBe('set channel dHJhY2tlci10ZXN0LWtleQ== race')
    expect(cmds[2]).toMatchObject({ command: null, readbackKey: 'psk' })
    expect(cmds.map((c) => c.command)).toContain('set tx 22')
  })
  it('omits the name when not given', () => {
    expect(buildTrackerCommands({ sf: 7 })[0].command).toBe('set sf 7')
  })
})

describe('helpers', () => {
  it('converts hex psk to base64 and leaves base64 alone', () => {
    expect(normalizePsk('00'.repeat(16))).toBe(btoa('\0'.repeat(16)))
    expect(normalizePsk('abc=')).toBe('abc=')
  })
  it('matches numbers loosely and strings exactly', () => {
    expect(valuesMatch(910.525, '910.5250')).toBe(true)
    expect(valuesMatch(7, '8')).toBe(false)
    expect(valuesMatch('notify', 'notify')).toBe(true)
    expect(valuesMatch('Sweep1', 'Sweep2')).toBe(false)
    expect(valuesMatch('x', undefined)).toBe(false)
  })
  it('redacts the psk', () => {
    expect(redactCommand('set channel SECRET my chan')).toBe('set channel <psk> my chan')
    expect(redactCommand('set sf 7')).toBe('set sf 7')
  })
  it('expands name templates', () => {
    expect(expandName('Sweep{n}', 3)).toBe('Sweep3')
    expect(() => expandName('x'.repeat(40), 1)).toThrow(/1-31/)
    expect(() => expandName('', 1)).toThrow(/1-31/)
  })
})
