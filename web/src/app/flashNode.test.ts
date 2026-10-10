import { FakeClock, FakeDfuLink, silentLogger } from '../adapters/memory/fakes'
import { DfuError, flashPackage } from './flashNode'

describe('flashPackage', () => {
  const pkg = { bin: new Uint8Array(1300).fill(7), dat: Uint8Array.of(1, 2, 3, 4) }

  it('sends start, init, data chunks and stop, waiting for flash erases', async () => {
    const link = new FakeDfuLink()
    const clock = new FakeClock()
    const pct: number[] = []
    await flashPackage(link, pkg, clock, silentLogger, (p) => pct.push(p))
    // start + init + ceil(1300/512)=3 data + stop
    expect(link.writes).toHaveLength(6)
    expect(pct).toEqual([33, 66, 100])
    expect(clock.slept.length).toBeGreaterThanOrEqual(4)
    expect(link.closed).toBe(true)
    expect(link.writes.every((w) => w[0] === 0xc0 && w.at(-1) === 0xc0)).toBe(true)
  })

  it('fails when the bootloader stops answering', async () => {
    const link = new FakeDfuLink()
    link.silent = true
    await expect(flashPackage(link, pkg, new FakeClock(), silentLogger)).rejects.toThrow(DfuError)
  })
})
