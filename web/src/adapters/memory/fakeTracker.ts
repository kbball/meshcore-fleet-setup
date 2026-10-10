import type { LineLink } from '../../app/ports'

/** In-memory fake of a tracker's serial CLI (get/set/reboot) for tests and development without hardware. */
export class FakeTrackerLink implements LineLink {
  settings: Record<string, string>
  rebooted = false
  sent: string[] = []
  private out: string[] = []

  constructor(
    initial: Record<string, string> = {},
    private opts: { rejectSet?: string; noAnswer?: boolean } = {},
  ) {
    this.settings = { interval: '300', min_interval: '300', name: 'unnamed', ...initial }
  }

  async writeLine(line: string): Promise<void> {
    this.sent.push(line)
    if (this.opts.noAnswer) return
    const [cmd, ...rest] = line.split(' ')
    if (cmd === 'get') {
      for (const [k, v] of Object.entries(this.settings)) this.out.push(`${k}=${v}`)
      this.out.push('OK')
    } else if (cmd === 'reboot') {
      this.rebooted = true
      this.out.push('OK')
    } else if (cmd === 'set') {
      const [key, ...vals] = rest
      if (key === this.opts.rejectSet) return void this.out.push('ERR bad value')
      if (key === 'channel') {
        this.settings.psk = vals[0]
        this.settings.channel = vals.slice(1).join(' ')
      } else {
        this.settings[key] = vals.join(' ')
      }
      this.out.push('sent: noise', 'OK')
    } else {
      this.out.push('ERR unknown command')
    }
  }

  async readLine(): Promise<string | null> {
    return this.out.shift() ?? null
  }
  async flush(): Promise<void> {
    this.out = []
  }
  async close(): Promise<void> {}
}
