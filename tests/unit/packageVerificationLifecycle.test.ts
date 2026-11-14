import { expect, it, vi } from 'vitest'
import { VerificationLifecycle } from '../../scripts/verificationLifecycle'
it('cleans registered launch resources when startup fails and retains evidence', async () => {
  const remove = vi.fn(), close = vi.fn(); const life = new VerificationLifecycle(remove)
  const failure = new Error('startup timeout')
  await expect(life.run(async () => { life.track(close); throw failure })).rejects.toBe(failure)
  expect(close).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled()
})
it('cleans all resources in reverse order after a mid-run failure', async () => {
  const order: number[] = []; const life = new VerificationLifecycle(() => {})
  await expect(life.run(async () => { life.track(() => { order.push(1) }); life.track(() => { order.push(2) }); throw new Error('assertion') })).rejects.toThrow('assertion')
  expect(order).toEqual([2, 1])
})
it('cleanup errors never mask original errors or prevent remaining cleanup', async () => {
  const remove = vi.fn(), close = vi.fn(); const life = new VerificationLifecycle(remove)
  const original = new Error('original')
  await expect(life.run(async () => { life.track(close); life.track(() => { throw new Error('cleanup') }); throw original })).rejects.toBe(original)
  expect(close).toHaveBeenCalledOnce(); expect(life.cleanupErrors).toHaveLength(1); expect(remove).not.toHaveBeenCalled()
})
it('only closes explicitly registered resources, not unrelated identities', async () => {
  const own = vi.fn(), unrelated = vi.fn(); const remove = vi.fn(); const life = new VerificationLifecycle(remove)
  await life.run(async () => { life.track(own) })
  expect(own).toHaveBeenCalledOnce(); expect(unrelated).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledOnce()
})
it('cleanup failure converts success to failure and preserves evidence', async () => {
  const remove = vi.fn(); const life = new VerificationLifecycle(remove)
  await expect(life.run(async () => { life.track(() => { throw new Error('cleanup') }) })).rejects.toThrow('verification cleanup failed')
  expect(remove).not.toHaveBeenCalled()
})

import { closeOwnedChild } from '../../scripts/verificationLifecycle'
it('terminates only the exact registered live child PID and waits for it', async () => {
  const terminate = vi.fn(), wait = vi.fn(async () => {})
  const own = { pid: 123, exitCode: null, signalCode: null }
  await closeOwnedChild(own, terminate, wait)
  expect(terminate.mock.calls).toEqual([[123]])
  expect(wait).toHaveBeenCalledOnce()
})
it.each([{ pid: 456, exitCode: 0, signalCode: null }, { pid: 456, exitCode: null, signalCode: 'SIGTERM' }, { pid: undefined, exitCode: null, signalCode: null }])('never kills an exited or unspawned child %j', async child => {
  const terminate = vi.fn(), wait = vi.fn(async () => {})
  await closeOwnedChild(child, terminate, wait)
  expect(terminate).not.toHaveBeenCalled(); expect(wait).not.toHaveBeenCalled()
})
