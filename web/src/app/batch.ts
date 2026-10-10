import { expandName } from '../domain/tracker'
import type { Profile } from '../domain/profile'
import type { NodeResult, NodeRunner, RunOptions } from './nodeRunner'
import type { BatchState, BatchStore } from './ports'

export type BatchRunOptions = Omit<RunOptions, 'nodeName'>

/** Name template of a profile, if it has one. */
export function nameTemplate(p: Profile): string | undefined {
  return p.kind === 'tracker' ? p.name_template : p.advert?.name_template
}

/** Next-node loop: names come from the profile template and a counter that only advances on success. */
export class Batch {
  private state: BatchState

  constructor(
    private runner: NodeRunner,
    private store: BatchStore,
  ) {
    this.state = store.load()
  }

  get counter() {
    return this.state.counter
  }

  get results(): readonly NodeResult[] {
    return this.state.results
  }

  /** The name the next node will get, or undefined when the profile does not name nodes. */
  nextName(p: Profile): string | undefined {
    const t = nameTemplate(p)
    return t === undefined ? undefined : expandName(t, this.state.counter)
  }

  setCounter(n: number) {
    if (!Number.isInteger(n) || n < 1) throw new Error('counter must be a positive integer')
    this.state = { ...this.state, counter: n }
    this.store.save(this.state)
  }

  async runNext(p: Profile, o: BatchRunOptions): Promise<NodeResult> {
    const nodeName = this.nextName(p)
    const opts = { ...o, nodeName }
    const result =
      p.kind === 'tracker' ? await this.runner.runTracker(p, opts) : await this.runner.runCompanion(p, opts)
    this.state = {
      counter: result.ok && nodeName !== undefined ? this.state.counter + 1 : this.state.counter,
      results: [...this.state.results, result],
    }
    this.store.save(this.state)
    return result
  }

  clear() {
    this.state = { counter: 1, results: [] }
    this.store.save(this.state)
  }
}

/** Results log as CSV for the operator's records. Contains no secrets. */
export function resultsCsv(results: readonly NodeResult[]): string {
  const esc = (s: string) => `"${s.replaceAll('"', '""')}"`
  const rows = results.map((r) =>
    [
      r.startedAt,
      r.name,
      r.kind,
      r.publicKey ?? '',
      r.ok ? 'ok' : 'FAILED',
      r.steps.map((s) => `${s.step}:${s.status}`).join(' '),
      r.backupFile ?? '',
      r.steps.find((s) => s.status === 'failed')?.detail ?? '',
    ]
      .map(String)
      .map(esc)
      .join(','),
  )
  return ['time,name,kind,public_key,result,steps,backup_file,error', ...rows].join('\n')
}
