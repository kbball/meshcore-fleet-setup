import { zipSync, strToU8 } from 'fflate'
import { DownloadSink, mailtoUrl } from './download'
import { HttpFirmwareSource, sha256Hex, unpackDfuZip } from './firmwareSource'
import { RingLogger } from './logger'
import { LocalBatchStore } from './resultsStore'

const manifestJson = (app: unknown) => strToU8(JSON.stringify({ manifest: { application: app } }))
const goodZip = () =>
  zipSync({
    'manifest.json': manifestJson({ bin_file: 'firmware.bin', dat_file: 'firmware.dat' }),
    'firmware.bin': Uint8Array.of(1, 2, 3),
    'firmware.dat': Uint8Array.of(9),
  })

describe('unpackDfuZip', () => {
  it('extracts bin and dat', () => {
    expect(unpackDfuZip(goodZip())).toEqual({ bin: Uint8Array.of(1, 2, 3), dat: Uint8Array.of(9) })
  })
  it('rejects bad packages', () => {
    expect(() => unpackDfuZip(zipSync({ 'a.txt': Uint8Array.of(1) }))).toThrow(/no manifest/)
    expect(() => unpackDfuZip(zipSync({ 'manifest.json': manifestJson({}) }))).toThrow(/application-only/)
    expect(() =>
      unpackDfuZip(zipSync({ 'manifest.json': manifestJson({ bin_file: 'a', dat_file: 'b' }) })),
    ).toThrow(/missing/)
  })
})

describe('HttpFirmwareSource', () => {
  const zip = goodZip()
  const make = async (sha?: string, zipStatus = 200) => {
    const entry = {
      board: 'b',
      env: 'e',
      kind: 'companion',
      version: '1.0.0',
      file: 'fw/e.zip',
      sha256: sha ?? (await sha256Hex(zip)),
    }
    const calls: string[] = []
    const fetchFn = (async (url: string) => {
      calls.push(String(url))
      if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify({ entries: [entry] }))
      return new Response(zip, { status: zipStatus })
    }) as typeof fetch
    return { src: new HttpFirmwareSource('http://x.test/firmware/manifest.json', fetchFn), calls }
  }

  it('fetches relative to the manifest, verifies the checksum and unpacks', async () => {
    const { src, calls } = await make()
    const r = await src.load('e')
    expect(r.entry.version).toBe('1.0.0')
    expect(r.pkg.bin).toEqual(Uint8Array.of(1, 2, 3))
    expect(calls[1]).toBe('http://x.test/firmware/fw/e.zip')
  })
  it('refuses a checksum mismatch', async () => {
    const { src } = await make('f'.repeat(64))
    await expect(src.load('e')).rejects.toThrow(/checksum mismatch/)
  })
  it('explains missing firmware and http errors', async () => {
    const { src } = await make()
    await expect(src.load('nope')).rejects.toThrow(/no firmware for 'nope'/)
    await expect(src.load('e', '9.9.9')).rejects.toThrow(/version 9.9.9/)
    const bad = await make(undefined, 404)
    await expect(bad.src.load('e')).rejects.toThrow(/\(404\)/)
    const noManifest = new HttpFirmwareSource(
      '/m.json',
      (async () => new Response('', { status: 500 })) as typeof fetch,
    )
    await expect(noManifest.load('e')).rejects.toThrow(/manifest \(500\)/)
  })
})

describe('DownloadSink / mailto', () => {
  it('clicks a temporary link with the filename', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('f.json')
    })
    await new DownloadSink().save('f.json', '{}')
    expect(click).toHaveBeenCalled()
  })
  it('builds a mailto link', () => {
    const u = mailtoUrl('a@b.c', 'Bob', 'backup.json')
    expect(u.startsWith('mailto:a%40b.c?subject=')).toBe(true)
    expect(decodeURIComponent(u)).toContain('backup.json')
  })
})

describe('RingLogger', () => {
  it('keeps the most recent entries, mirrors to the sink and notifies', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const log = new RingLogger(2, sink)
    const seen = vi.fn()
    const off = log.subscribe(seen)
    log.info('a')
    log.warn('b', { x: 1 })
    log.error('c')
    expect(log.entries.map((e) => e.msg)).toEqual(['b', 'c'])
    expect(sink.warn).toHaveBeenCalledWith('b', { x: 1 })
    expect(seen).toHaveBeenCalledTimes(3)
    off()
    log.info('d')
    expect(seen).toHaveBeenCalledTimes(3)
  })
})

describe('LocalBatchStore', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    } as Storage
  }
  it('round trips and starts fresh when empty or corrupt', () => {
    const s = mem()
    const store = new LocalBatchStore(s)
    expect(store.load()).toEqual({ counter: 1, results: [] })
    store.save({ counter: 4, results: [] })
    expect(new LocalBatchStore(s).load().counter).toBe(4)
    s.setItem('fleet-setup/batch', '{bad')
    expect(store.load().counter).toBe(1)
    s.setItem('fleet-setup/batch', '{"counter":"x"}')
    expect(store.load().counter).toBe(1)
  })
  it('survives missing or throwing storage', () => {
    expect(new LocalBatchStore(undefined).load().counter).toBe(1)
    new LocalBatchStore(undefined).save({ counter: 2, results: [] })
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    } as unknown as Storage
    const store = new LocalBatchStore(throwing)
    expect(store.load().counter).toBe(1)
    expect(() => store.save({ counter: 2, results: [] })).not.toThrow()
  })
})
