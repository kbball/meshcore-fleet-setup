import { FakeTrackerLink } from '../adapters/memory/fakeTracker'
import { provisionTracker } from './provisionTracker'
import { TrackerCli, TrackerError } from './trackerCli'
import type { Logger } from './ports'

const logs: string[] = []
const log: Logger = {
  info: (m, f) => void logs.push(m + JSON.stringify(f ?? {})),
  warn: () => {},
  error: () => {},
}
const cfg = { channel_name: 'race', channel_psk: 'SECRETKEY==', sf: 7, interval_sec: 600 }

beforeEach(() => void (logs.length = 0))

describe('provisionTracker', () => {
  it('applies, verifies and reboots, without leaking the psk to logs', async () => {
    const link = new FakeTrackerLink()
    const res = await provisionTracker(new TrackerCli(link, 200), cfg, 'Sweep1', log)
    expect(link.settings).toMatchObject({
      name: 'Sweep1',
      sf: '7',
      interval: '600',
      channel: 'race',
      psk: 'SECRETKEY==',
    })
    expect(link.rebooted).toBe(true)
    expect(res.verified).toEqual(expect.arrayContaining(['name', 'channel', 'psk', 'sf', 'interval']))
    expect(logs.join('\n')).not.toContain('SECRETKEY')
    expect(logs.join('\n')).toContain('set channel <psk> race')
  })

  it('can skip the reboot and the name', async () => {
    const link = new FakeTrackerLink()
    await provisionTracker(new TrackerCli(link, 200), { sf: 8 }, undefined, log, { reboot: false })
    expect(link.rebooted).toBe(false)
    expect(link.settings.name).toBe('unnamed')
  })

  it('rejects firmware that does not look like a tracker', async () => {
    const link = new FakeTrackerLink()
    delete link.settings.interval
    await expect(provisionTracker(new TrackerCli(link, 200), cfg, 'S', log)).rejects.toThrow(
      /tracker firmware/,
    )
  })

  it('rejects an invalid config before sending anything', async () => {
    const link = new FakeTrackerLink()
    await expect(provisionTracker(new TrackerCli(link, 200), { sf: 99 }, 'S', log)).rejects.toThrow(
      /invalid config/,
    )
    expect(link.sent).toEqual(['get'])
  })

  it('uses the device interval floor', async () => {
    const link = new FakeTrackerLink({ min_interval: '600' })
    await expect(
      provisionTracker(new TrackerCli(link, 200), { interval_sec: 300 }, 'S', log),
    ).rejects.toThrow(/between 600/)
  })

  it('surfaces ERR replies', async () => {
    const link = new FakeTrackerLink({}, { rejectSet: 'sf' })
    await expect(provisionTracker(new TrackerCli(link, 200), { sf: 7 }, undefined, log)).rejects.toThrow(
      /failed: ERR bad value/,
    )
  })

  it('reports a readback mismatch without printing the psk', async () => {
    const link = new FakeTrackerLink()
    const origWrite = link.writeLine.bind(link)
    link.writeLine = async (l) => {
      await origWrite(l)
      if (l.startsWith('set channel')) link.settings.psk = 'DIFFERENT'
      if (l === 'set sf 7') link.settings.sf = '9'
    }
    const err = await provisionTracker(new TrackerCli(link, 200), cfg, undefined, log).catch((e) => e)
    expect(err).toBeInstanceOf(TrackerError)
    expect(err.message).toContain('psk: does not match')
    expect(err.message).toContain('sf: expected 7, device has "9"')
    expect(err.message).not.toContain('SECRETKEY')
  })

  it('tolerates the port dropping on reboot', async () => {
    const link = new FakeTrackerLink()
    const origWrite = link.writeLine.bind(link)
    link.writeLine = async (l) => {
      if (l === 'reboot') return // device goes away without answering
      await origWrite(l)
    }
    await expect(provisionTracker(new TrackerCli(link, 50), { sf: 7 }, undefined, log)).resolves.toBeDefined()
  })

  it('times out when the device is silent', async () => {
    const link = new FakeTrackerLink({}, { noAnswer: true })
    await expect(new TrackerCli(link, 30).get()).rejects.toThrow(/timeout/)
  })
})
