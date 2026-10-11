import { concat, utf8 } from '../../domain/bytes'
import { encodeFrame } from '../../domain/companion'
import { WebSerialConnector } from './connector'
import { Inbox } from './inbox'
import { openDfuLink, openFrameLink, openLineLink, touch1200 } from './links'

/** Minimal SerialPort stand-in: the test pushes bytes "from the device" and inspects what was written. */
class FakePort {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  written: Uint8Array[] = []
  opened: number[] = []
  closes = 0
  private ctrl!: ReadableStreamDefaultController<Uint8Array>
  constructor(
    private info: { usbVendorId?: number; usbProductId?: number } = { usbVendorId: 1, usbProductId: 1 },
  ) {}
  getInfo() {
    return this.info
  }
  async open({ baudRate }: { baudRate: number }) {
    this.opened.push(baudRate)
    this.readable = new ReadableStream({ start: (c) => void (this.ctrl = c) })
    this.writable = new WritableStream({ write: (b) => void this.written.push(b) })
  }
  async close() {
    this.closes++
    this.readable = null
    this.writable = null
  }
  device(b: Uint8Array) {
    this.ctrl.enqueue(b)
  }
}
const asPort = (p: FakePort) => p as unknown as SerialPort

describe('Inbox', () => {
  it('delivers queued and later items, and times out', async () => {
    const i = new Inbox<number>()
    i.push(1)
    expect(await i.take(10)).toBe(1)
    const later = i.take(500)
    i.push(2)
    expect(await later).toBe(2)
    expect(await i.take(5)).toBeNull()
    i.push(3)
    i.clear()
    expect(await i.take(5)).toBeNull()
  })
})

describe('frame link', () => {
  it('wraps outgoing payloads and decodes incoming frames', async () => {
    const port = new FakePort()
    const link = await openFrameLink(asPort(port))
    expect(port.opened).toEqual([115200])
    await link.send(Uint8Array.of(22, 3))
    expect(Array.from(port.written[0])).toEqual([0x3c, 2, 0, 22, 3])
    port.device(
      concat(
        utf8('boot noise'),
        encodeFrame(Uint8Array.of(0, 7)).map((b, i) => (i === 0 ? 0x3e : b)),
      ),
    )
    expect(Array.from((await link.receive(500))!)).toEqual([0, 7])
    await link.drain()
    expect(await link.receive(5)).toBeNull()
    await link.close()
    expect(port.closes).toBe(1)
  })
})

describe('line link', () => {
  it('splits lines across chunks and flushes', async () => {
    const port = new FakePort()
    const link = await openLineLink(asPort(port))
    await link.writeLine('get')
    expect(new TextDecoder().decode(port.written[0])).toBe('get\n')
    port.device(utf8('interval=3'))
    port.device(utf8('00\r\nOK\n\n'))
    expect(await link.readLine(500)).toBe('interval=300')
    expect(await link.readLine(500)).toBe('OK')
    port.device(utf8('partial'))
    await new Promise((r) => setTimeout(r, 10))
    await link.flush()
    port.device(utf8(' rest\n'))
    expect(await link.readLine(500)).toBe(' rest')
    await link.close()
  })
})

describe('dfu link', () => {
  it('returns one ack packet at a time', async () => {
    const port = new FakePort()
    const link = await openDfuLink(asPort(port))
    await link.write(Uint8Array.of(1, 2))
    expect(Array.from(port.written[0])).toEqual([1, 2])
    port.device(Uint8Array.of(0xc0, 0x10, 0, 0))
    expect(await link.readAck(20)).toBeNull()
    port.device(Uint8Array.of(0, 0xc0, 0xc0, 0xc0, 0x20, 0xc0))
    expect(Array.from((await link.readAck(500))!)).toEqual([0xc0, 0x10, 0, 0, 0, 0xc0])
    expect(Array.from((await link.readAck(500))!)).toEqual([0xc0, 0x20, 0xc0])
    port.device(Uint8Array.of(1, 2, 3)) // no delimiter: ignored
    expect(await link.readAck(10)).toBeNull()
    await link.close()
  })
})

describe('touch1200', () => {
  it('opens and closes at 1200 baud', async () => {
    const port = new FakePort()
    await touch1200(asPort(port))
    expect(port.opened).toEqual([1200])
    expect(port.closes).toBe(1)
  })
})

describe('WebSerialConnector', () => {
  const makeSerial = (ports: FakePort[], requested: FakePort[]) =>
    ({
      getPorts: async () => ports.map(asPort),
      requestPort: async () => asPort(requested.shift()!),
    }) as unknown as Serial

  it('asks for a port once and reuses it', async () => {
    const app = new FakePort()
    const serial = makeSerial([], [app])
    const c = new WebSerialConnector(serial)
    const l1 = await c.openFrames()
    await l1.close()
    const l2 = await c.openLines() // no second prompt: the requested queue is empty
    await l2.close()
    expect(app.opened).toEqual([115200, 115200])
    await c.release()
  })

  it('touches the port, finds the bootloader port by itself, and the app port again after', async () => {
    const app = new FakePort({ usbVendorId: 1, usbProductId: 1 })
    const boot = new FakePort({ usbVendorId: 1, usbProductId: 2 })
    const granted = [app]
    const c = new WebSerialConnector(makeSerial(granted, [app]), 300)
    const prompts: string[] = []
    const dfu = await c.openBootloader(async (m) => void prompts.push(m)).catch(() => null)
    // the touch needed the app port; before the bootloader appears there is nothing else granted
    expect(app.opened).toContain(1200)
    expect(dfu).toBeNull() // prompt path: requestPort queue was empty, so it threw
    expect(prompts).toHaveLength(1)

    const app2 = new FakePort({ usbVendorId: 1, usbProductId: 1 })
    const granted2: FakePort[] = [app2]
    const c2 = new WebSerialConnector(makeSerial(granted2, [app2]), 3000)
    const p = c2.openBootloader(async () => {})
    granted2.push(boot) // the bootloader enumerates shortly after the touch
    const link = await p
    expect(boot.opened).toEqual([115200])
    await link.close()
    granted2.push(new FakePort({ usbVendorId: 1, usbProductId: 1 }))
    const back = await c2.reopenFrames(3000)
    await back.close()
  }, 15000)

  it('prompts and requests a port when the bootloader does not show up', async () => {
    const app = new FakePort()
    const boot = new FakePort({ usbVendorId: 1, usbProductId: 2 })
    const c = new WebSerialConnector(makeSerial([app], [app, boot]), 300)
    const prompts: string[] = []
    const link = await c.openBootloader(async (m) => void prompts.push(m))
    expect(prompts[0]).toMatch(/bootloader mode/)
    expect(boot.opened).toEqual([115200])
    await link.close()
  }, 15000)

  it('touches the app port, prompts, then returns the drive the operator picked', async () => {
    const app = new FakePort()
    const drive = { write: async () => {} }
    const c = new WebSerialConnector(makeSerial([], [app]), 300, async () => drive)
    await (await c.openFrames()).close() // the operator already chose the app port
    const prompts: string[] = []
    expect(await c.openUf2Drive(async (m) => void prompts.push(m))).toBe(drive)
    expect(app.opened).toContain(1200)
    expect(prompts[0]).toMatch(/double-click/)
  })

  it('still asks for the drive when there is no app port yet or the touch fails', async () => {
    const drive = { write: async () => {} }
    const c = new WebSerialConnector(makeSerial([], []), 300, async () => drive)
    expect(await c.openUf2Drive(async () => {})).toBe(drive)
    const app = new FakePort()
    app.open = async () => {
      throw new Error('port busy')
    }
    const c2 = new WebSerialConnector(makeSerial([], [app]), 300, async () => drive)
    await c2.openFrames().catch(() => {}) // remembers the port, then the open fails
    expect(await c2.openUf2Drive(async () => {})).toBe(drive)
  })

  it('times out when the node never comes back', async () => {
    const app = new FakePort()
    const c = new WebSerialConnector(makeSerial([], [app]))
    await (await c.openLines()).close()
    app.readable = null
    await expect(c.reopenLines(50)).rejects.toThrow(/did not come back/)
  })
})
