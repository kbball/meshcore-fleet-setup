import type { Logger } from '../../app/ports'

export type LogEntry = {
  time: string
  level: 'info' | 'warn' | 'error'
  msg: string
  fields?: Record<string, unknown>
}

/** Keeps the last entries for the on-screen log and mirrors them to the browser console. */
export class RingLogger implements Logger {
  readonly entries: LogEntry[] = []
  private listeners = new Set<() => void>()

  constructor(
    private max = 500,
    private sink: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private add(level: LogEntry['level'], msg: string, fields?: Record<string, unknown>) {
    this.entries.push({ time: new Date().toISOString(), level, msg, fields })
    if (this.entries.length > this.max) this.entries.shift()
    this.sink[level](msg, fields ?? '')
    this.listeners.forEach((l) => l())
  }

  info(msg: string, fields?: Record<string, unknown>) {
    this.add('info', msg, fields)
  }
  warn(msg: string, fields?: Record<string, unknown>) {
    this.add('warn', msg, fields)
  }
  error(msg: string, fields?: Record<string, unknown>) {
    this.add('error', msg, fields)
  }
}
