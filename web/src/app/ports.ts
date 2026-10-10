import type { NodeBackup } from '../domain/backup'
import type { DfuPackage } from '../domain/dfu'
import type { InstalledFirmware } from '../domain/firmwareRelease'
import type { ManifestEntry } from '../domain/manifest'

/** Line-oriented text link to a node's USB serial CLI (sweep trackers). */
export interface LineLink {
  /** Send one command line (newline is added by the adapter). */
  writeLine(line: string): Promise<void>
  /** Next received line, or null if none arrived within timeoutMs. */
  readLine(timeoutMs: number): Promise<string | null>
  /** Discard anything buffered. */
  flush(): Promise<void>
  close(): Promise<void>
}

/** Framed binary link to a companion node. Payloads exclude the '<' / '>' + length framing. */
export interface FrameLink {
  send(payload: Uint8Array): Promise<void>
  /** Next frame from the device, or null on timeout. */
  receive(timeoutMs: number): Promise<Uint8Array | null>
  /** Discard anything buffered. */
  drain(): Promise<void>
  close(): Promise<void>
}

/** Link to the nRF52 serial DFU bootloader. */
export interface DfuLink {
  write(bytes: Uint8Array): Promise<void>
  /** Read until two 0xC0 delimiters were seen (one ACK packet); null on timeout. */
  readAck(timeoutMs: number): Promise<Uint8Array | null>
  close(): Promise<void>
}

/** Ask the operator to do something physical; resolves when they say it is done (a click, so the browser grants a gesture). */
export type Prompt = (msg: string) => Promise<void>

/**
 * Gets us connected to whichever node is plugged in. Stateful: remembers the port the operator chose so the
 * rest of a node's run (and the reconnects after reboot/reflash) reuse it.
 */
export interface NodeConnector {
  /** Prompt for / reuse a port and open it for companion frames. */
  openFrames(): Promise<FrameLink>
  /** Prompt for / reuse a port and open it for the tracker text CLI. */
  openLines(): Promise<LineLink>
  /** Put the current node into its DFU bootloader (1200 baud touch, or ask the operator) and open it. */
  openBootloader(prompt: Prompt): Promise<DfuLink>
  /** Wait for the node to come back after a reboot or reflash, then open it as frames or lines. */
  reopenFrames(timeoutMs: number): Promise<FrameLink>
  reopenLines(timeoutMs: number): Promise<LineLink>
  /** Forget the current port (next node). */
  release(): Promise<void>
}

export interface FirmwareSource {
  /** Download the firmware zip for an env, verify its sha256, and unpack it. */
  load(env: string, version?: string): Promise<{ entry: ManifestEntry; pkg: DfuPackage }>
}

/** What firmware release the firmware directory holds (shown to the operator, compared with the event). */
export interface FirmwareInfoSource {
  installed(): Promise<InstalledFirmware>
}

export interface BackupCipher {
  encrypt(backup: NodeBackup, passphrase: string): Promise<string>
  decrypt(text: string, passphrase: string): Promise<NodeBackup>
}

/** Hands a finished backup file to the operator (browser download). Resolves once it is saved. */
export interface BackupSink {
  save(filename: string, contents: string): Promise<void>
}

export interface Clock {
  now(): Date
  sleep(ms: number): Promise<void>
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export type BatchState = { counter: number; results: import('./nodeRunner').NodeResult[] }

export interface BatchStore {
  load(): BatchState
  save(s: BatchState): void
}
