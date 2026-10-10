import type { LineLink } from './ports'

export class TrackerError extends Error {}

/** Client for the tracker firmware's text CLI: commands end with an `OK` or `ERR ...` line. */
export class TrackerCli {
  constructor(
    private link: LineLink,
    private timeoutMs = 5000,
  ) {}

  /** Returns the output lines before the final OK. Throws TrackerError on ERR or timeout. */
  async command(cmd: string, shown = cmd): Promise<string[]> {
    await this.link.flush()
    await this.link.writeLine(cmd)
    const lines: string[] = []
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const raw = await this.link.readLine(Math.max(1, deadline - Date.now()))
      if (raw === null) continue
      const line = raw.trim()
      if (line.startsWith('OK')) return lines
      if (line.startsWith('ERR')) throw new TrackerError(`'${shown}' failed: ${line}`)
      lines.push(line) // includes unrelated log lines such as "sent: ..."
    }
    throw new TrackerError(`timeout waiting for reply to '${shown}'`)
  }

  async get(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const line of await this.command('get')) {
      const i = line.indexOf('=')
      if (i >= 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    return out
  }
}
