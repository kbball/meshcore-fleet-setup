import type { BatchState, BatchStore } from '../../app/ports'

const KEY = 'fleet-setup/batch'

/** Persists the batch counter and results log (no secrets) so a page reload does not lose a batch. */
export class LocalBatchStore implements BatchStore {
  constructor(private storage: Storage | undefined = safeStorage()) {}

  load(): BatchState {
    try {
      const raw = this.storage?.getItem(KEY)
      if (raw) {
        const s = JSON.parse(raw)
        if (Number.isInteger(s.counter) && Array.isArray(s.results)) return s
      }
    } catch {
      // unreadable: start fresh
    }
    return { counter: 1, results: [] }
  }

  save(s: BatchState): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(s))
    } catch {
      // storage blocked or full; the on-screen log still works
    }
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
