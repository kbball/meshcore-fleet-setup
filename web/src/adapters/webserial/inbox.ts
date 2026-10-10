/** Async queue with timed take(). */
export class Inbox<T> {
  private items: T[] = []
  private waiters: ((v: T | null) => void)[] = []

  push(v: T) {
    const w = this.waiters.shift()
    if (w) w(v)
    else this.items.push(v)
  }

  clear() {
    this.items = []
  }

  take(timeoutMs: number): Promise<T | null> {
    const v = this.items.shift()
    if (v !== undefined) return Promise.resolve(v)
    return new Promise((resolve) => {
      const w = (x: T | null) => {
        clearTimeout(timer)
        resolve(x)
      }
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(w)
        if (i >= 0) this.waiters.splice(i, 1)
        resolve(null)
      }, timeoutMs)
      this.waiters.push(w)
    })
  }
}
