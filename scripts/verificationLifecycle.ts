/** Resources are registered by their creator; no process-name or directory discovery. */
export class VerificationLifecycle {
  readonly cleanupErrors: unknown[] = []
  private readonly closers: (() => void | Promise<void>)[] = []
  constructor(private readonly removeEvidence: () => void | Promise<void>) {}
  track(close: () => void | Promise<void>) { this.closers.push(close) }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T
    let failed = false
    let original: unknown
    try {
      result = await operation()
    } catch (error) {
      failed = true
      original = error
    } finally {
      for (const close of this.closers.reverse()) {
        try { await close() } catch (error) { this.cleanupErrors.push(error) }
      }
    }
    if (failed) throw original
    if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, 'verification cleanup failed; evidence retained')
    await this.removeEvidence()
    return result
  }
}

export async function closeOwnedChild(
  child: { pid?: number; exitCode: number | null; signalCode: string | null },
  terminate: (pid: number) => void,
  wait: () => Promise<void>,
) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  terminate(child.pid)
  await wait()
}
