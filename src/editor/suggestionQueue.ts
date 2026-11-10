/** Memory-only cache: no article text is persisted or sent to another service. */
export class SuggestionQueue {
  private cache = new Map<string, string>()
  private pending: Promise<unknown> | null = null
  private lastStart = 0
  constructor(private interval = 30_000) {}
  async get(key: string, fetch: () => Promise<{ suggestion: string }>, signal: AbortSignal): Promise<string> {
    while (this.pending) await this.pending.catch(() => undefined)
    if (signal.aborted) return ''
    if (this.cache.has(key)) return this.cache.get(key)!
    const delay = Math.max(0, this.lastStart + this.interval - Date.now())
    if (delay) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, delay)
        signal.addEventListener('abort', done, { once: true })
      })
      return this.get(key, fetch, signal)
    }
    this.lastStart = Date.now()
    const request = fetch()
    this.pending = request
    try {
      const result = await request
      this.cache.set(key, result.suggestion)
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!)
      return result.suggestion
    } catch (error) {
      // No automatic retry loops for a failed context (including bad credentials).
      this.cache.set(key, '')
      throw error
    } finally { this.pending = null }
  }
}
export const instructionSuggestions = new SuggestionQueue()
