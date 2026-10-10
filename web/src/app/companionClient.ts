import { ERR_CODES, PUSH_MIN, RESP } from '../domain/companion'
import type { FrameLink } from './ports'

export class CompanionError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

/** Raised for RESP_CODE_DISABLED, e.g. private key export compiled out of the firmware. */
export class CompanionDisabledError extends CompanionError {}

/** One command at a time; unsolicited push frames (>= 0x80) are skipped while waiting for the reply. */
export class CompanionClient {
  constructor(
    private link: FrameLink,
    private timeoutMs = 5000,
  ) {}

  async request(payload: Uint8Array, what: string): Promise<Uint8Array> {
    await this.link.drain()
    await this.link.send(payload)
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const f = await this.link.receive(Math.max(1, deadline - Date.now()))
      if (f === null || f.length === 0) continue
      if (f[0] >= PUSH_MIN) continue
      if (f[0] === RESP.ERR) {
        const code = f[1]
        throw new CompanionError(`${what} failed: ${ERR_CODES[code] ?? `error ${code}`}`, code)
      }
      if (f[0] === RESP.DISABLED) throw new CompanionDisabledError(`${what} is disabled in this firmware`)
      return f
    }
    throw new CompanionError(`timeout waiting for reply to ${what}`)
  }

  /** Request that must be answered with OK. */
  async ok(payload: Uint8Array, what: string): Promise<void> {
    const f = await this.request(payload, what)
    if (f[0] !== RESP.OK) throw new CompanionError(`${what}: unexpected reply code ${f[0]}`)
  }

  /** Send a command whose device reboots instead of replying. Swallows a missing reply. */
  async fireAndForget(payload: Uint8Array): Promise<void> {
    await this.link.send(payload)
  }

  close() {
    return this.link.close()
  }
}
