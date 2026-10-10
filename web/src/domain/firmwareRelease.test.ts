import { describeFirmware, installedFrom, parseReleaseFile, versionOfTag } from './firmwareRelease'

const entry = (version: string, env = 'e') => ({
  board: 'b',
  env,
  kind: 'companion' as const,
  version,
  file: 'f',
  sha256: 'a'.repeat(64),
})

describe('parseReleaseFile', () => {
  it('accepts a tag on its first line', () => {
    expect(parseReleaseFile('ares-v1.0.0\n')).toBe('ares-v1.0.0')
    expect(parseReleaseFile('  ares-v12.3.45 \nextra')).toBe('ares-v12.3.45')
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'v1.0.0', 'ares-v1.0', '<b>ares-v1.0.0</b>', 'latest\nares-v1.0.0'])
      expect(parseReleaseFile(bad)).toBeNull()
  })
})

describe('installedFrom', () => {
  it('collects distinct versions and envs', () => {
    const m = { entries: [entry('v1.0.0-a'), entry('v1.0.0-a', 'f'), entry('v0.9.0-b')] }
    expect(installedFrom(m, 'ares-v1.0.0')).toEqual({
      release: 'ares-v1.0.0',
      versions: ['v1.0.0-a', 'v0.9.0-b'],
      envs: ['e', 'f'],
    })
  })
  it('has nothing without a manifest', () => {
    expect(installedFrom(null, null)).toEqual({ release: null, versions: [], envs: [] })
  })
})

describe('describeFirmware', () => {
  const inst = { release: 'ares-v1.0.0', versions: ['v1.0.0-abc'], envs: ['e'] }
  it('says when nothing is loaded', () => {
    expect(describeFirmware({ release: null, versions: [], envs: [] }, 'ares-v1.0.0').level).toBe('none')
  })
  it('shows the release and versions', () => {
    expect(describeFirmware(inst)).toEqual({
      level: 'ok',
      text: 'Firmware installed: ares-v1.0.0 (v1.0.0-abc).',
    })
  })
  it('accepts a matching event tag and warns on another', () => {
    expect(describeFirmware(inst, 'ares-v1.0.0').text).toMatch(/as the event expects/)
    const w = describeFirmware(inst, 'ares-v1.1.0')
    expect(w.level).toBe('warn')
    expect(w.text).toMatch(/expects ares-v1.1.0/)
  })
  it('falls back to manifest versions when there is no .release', () => {
    const noRel = { ...inst, release: null }
    expect(describeFirmware(noRel).text).toMatch(/no \.release file/)
    expect(describeFirmware(noRel, 'ares-v1.0.0').level).toBe('ok')
    expect(describeFirmware(noRel, 'ares-v1.0.1').level).toBe('warn')
    expect(describeFirmware({ ...noRel, versions: ['v1.0.01'] }, 'ares-v1.0.0').level).toBe('warn')
    expect(describeFirmware({ ...noRel, versions: ['v1.0.0'] }, 'ares-v1.0.0').level).toBe('ok')
  })
  it('maps tags to manifest versions', () => {
    expect(versionOfTag('ares-v1.0.0')).toBe('v1.0.0')
  })
})
