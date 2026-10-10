/** An open serial port with a background read loop delivering chunks to a callback. */
export class SerialPump {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private done: Promise<void> = Promise.resolve()

  constructor(
    readonly port: SerialPort,
    private onChunk: (b: Uint8Array) => void,
  ) {}

  async open(baudRate: number): Promise<void> {
    await this.port.open({ baudRate })
    this.writer = this.port.writable!.getWriter()
    this.reader = this.port.readable!.getReader()
    const reader = this.reader
    this.done = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) this.onChunk(value)
        }
      } catch {
        // port unplugged or closed mid-read: the node rebooting is expected, nothing to report here
      } finally {
        reader.releaseLock()
      }
    })()
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('serial port is not open')
    await this.writer.write(bytes)
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel()
    } catch {
      // already gone
    }
    await this.done
    try {
      this.writer?.releaseLock()
      await this.port.close()
    } catch {
      // the port may already have disappeared (reboot/reflash)
    }
    this.reader = this.writer = null
  }
}
