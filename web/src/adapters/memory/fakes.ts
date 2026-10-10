import type { NodeBackup } from '../../domain/backup'
import { crc16, type DfuPackage } from '../../domain/dfu'
import type { ManifestEntry } from '../../domain/manifest'
import type {
  BackupCipher,
  BackupSink,
  BatchState,
  BatchStore,
  Clock,
  DfuLink,
  FirmwareSource,
  FrameLink,
  LineLink,
  Logger,
  NodeConnector,
  Prompt,
} from '../../app/ports'

export const silentLogger: Logger = { info() {}, warn() {}, error() {} }

export class FakeClock implements Clock {
  slept: number[] = []
  constructor(private t = new Date('2026-10-10T12:00:00Z')) {}
  now() {
    return this.t
  }
  async sleep(ms: number) {
    this.slept.push(ms)
  }
}

/** Acks every packet written; keeps what it was sent. */
export class FakeDfuLink implements DfuLink {
  writes: Uint8Array[] = []
  closed = false
  silent = false
  async write(b: Uint8Array) {
    this.writes.push(b)
  }
  async readAck(): Promise<Uint8Array | null> {
    return this.silent ? null : Uint8Array.of(0xc0, 0x08, 0, 0, 0, 0xc0)
  }
  async close() {
    this.closed = true
  }
}

export class MemorySink implements BackupSink {
  files = new Map<string, string>()
  fail = false
  async save(filename: string, contents: string) {
    if (this.fail) throw new Error('download blocked')
    this.files.set(filename, contents)
  }
}

export class MemoryFirmware implements FirmwareSource {
  loads: string[] = []
  fail = false
  readonly pkg: DfuPackage = {
    bin: new Uint8Array(1500).map((_, i) => i & 0xff),
    dat: Uint8Array.of(1, 2, 3),
  }
  async load(env: string, version?: string): Promise<{ entry: ManifestEntry; pkg: DfuPackage }> {
    if (this.fail) throw new Error('no firmware')
    this.loads.push(`${env}@${version ?? 'latest'}`)
    return {
      entry: {
        board: 'b',
        env,
        kind: 'companion',
        version: version ?? '1.0.0',
        file: 'x.zip',
        sha256: String(crc16(this.pkg.bin)),
      },
      pkg: this.pkg,
    }
  }
}

/** Cipher that just tags the JSON; the real one is tested separately. */
export class PlainCipher implements BackupCipher {
  async encrypt(b: NodeBackup, pass: string) {
    return `enc:${pass}:${JSON.stringify(b)}`
  }
  async decrypt(text: string, pass: string): Promise<NodeBackup> {
    const [tag, p, ...rest] = text.split(':')
    if (tag !== 'enc' || p !== pass) throw new Error('wrong passphrase, or the file was changed')
    return JSON.parse(rest.join(':'))
  }
}

export class MemoryBatchStore implements BatchStore {
  state: BatchState = { counter: 1, results: [] }
  load() {
    return JSON.parse(JSON.stringify(this.state))
  }
  save(s: BatchState) {
    this.state = JSON.parse(JSON.stringify(s))
  }
}

export class FakeConnector implements NodeConnector {
  prompts: string[] = []
  bootloaders: FakeDfuLink[] = []
  released = 0
  reopens = 0
  failBootloader = false
  constructor(
    public frames?: FrameLink,
    public lines?: LineLink,
  ) {}
  async openFrames() {
    if (!this.frames) throw new Error('no companion node connected')
    return this.frames
  }
  async openLines() {
    if (!this.lines) throw new Error('no tracker connected')
    return this.lines
  }
  async openBootloader(prompt: Prompt) {
    if (this.failBootloader) throw new Error('no bootloader port')
    await prompt('press the button')
    const l = new FakeDfuLink()
    this.bootloaders.push(l)
    return l
  }
  async reopenFrames() {
    this.reopens++
    return this.openFrames()
  }
  async reopenLines() {
    this.reopens++
    return this.openLines()
  }
  async release() {
    this.released++
  }
}
