import { expect, it, vi } from 'vitest'
import { withImageBudget } from '../../server/imageBudget'

it('bounds the image queue and recovers after completion and synchronous/asynchronous failure',async()=>{
 let finish!:()=>void;const held=withImageBudget(()=>new Promise<void>(resolve=>{finish=resolve}));await Promise.resolve();
 const waiting=Array.from({length:64},()=>withImageBudget(async()=>42));await expect(withImageBudget(async()=>99)).rejects.toMatchObject({status:429});finish();await held;expect(await Promise.all(waiting)).toHaveLength(64)
 await expect(withImageBudget(()=>{throw Error('sync')})).rejects.toThrow('sync')
 await expect(withImageBudget(async()=>{throw Error('async')})).rejects.toThrow('async')
 expect(await withImageBudget(async()=>1)).toBe(1)
})

it('runs only one image callback at a time and keeps FIFO order across failed tasks', async () => {
  let release!: (value: string) => void
  const pending = new Promise<string>(resolve => { release = resolve })
  const first = vi.fn(() => pending)
  const second = vi.fn(async () => { throw Error('fixture failure') })
  const third = vi.fn(async () => 'last')
  const one = withImageBudget(first)
  const two = withImageBudget(second)
  const three = withImageBudget(third)
  await Promise.resolve()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
  expect(third).not.toHaveBeenCalled()
  release('first')
  await expect(one).resolves.toBe('first')
  await expect(two).rejects.toThrow('fixture failure')
  await expect(three).resolves.toBe('last')
  expect(second.mock.invocationCallOrder[0]).toBeLessThan(third.mock.invocationCallOrder[0])
})
it('type-narrows only the expected native pixel-limit error and preserves an unrelated value', async () => {
  const unrelated = { message: 'Input image exceeds pixel limit', origin: 'not an Error' }
  await expect(withImageBudget(async () => { throw unrelated })).rejects.toBe(unrelated)
  await expect(withImageBudget(async () => { throw Error('Input image exceeds pixel limit') })).rejects.toMatchObject({
    status: 413, message: 'Image exceeds the 64-megapixel input limit. Reduce its dimensions and retry.',
  })
  await expect(withImageBudget(async () => 1)).resolves.toBe(1)
})
