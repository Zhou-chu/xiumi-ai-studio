import { expect, it, vi } from 'vitest'
import { createVariantSaver } from '../../src/editor/variantPersistence'
import { emptyDoc } from '../../src/editor/store'

it('retries a partial batch without blind-saving successful variants', async () => {
  const docs = [emptyDoc(), emptyDoc(), emptyDoc()]
  const revisions = new Map<string, string>()
  let offline = true
  const save = vi.fn(async (doc: typeof docs[number]) => {
    if (doc.id === docs[1].id && offline) throw new Error('offline')
    if (revisions.has(doc.id) && doc.revision !== revisions.get(doc.id)) throw new Error('409 stale')
    const revision = 'r' + save.mock.calls.length
    revisions.set(doc.id, revision)
    return { revision, updatedAt: 1 }
  })
  const read = vi.fn(async (id: string) => ({...docs.find(d => d.id === id)!,revision:revisions.get(id)}))
  const saver = createVariantSaver(save, read)
  await expect(saver.saveAll(docs, () => true)).rejects.toThrow('offline')
  offline = false
  const result = await saver.saveAll(docs, () => true)
  expect(result?.map(d => d.revision)).toEqual(docs.map(d => revisions.get(d.id)))
  expect(save.mock.calls.filter(([d]) => d.id === docs[0].id)).toHaveLength(1)
})

it('carries the last successful revision when a saved variant changes', async () => {
  const doc = emptyDoc()
  const save = vi.fn().mockResolvedValueOnce({revision:'r1'}).mockResolvedValueOnce({revision:'r2'})
  const saver = createVariantSaver(save, vi.fn())
  await saver.saveAll([doc], () => true)
  const changed = {...doc,title:'edited variant'}
  await saver.saveAll([changed], () => true)
  expect(save.mock.calls[1][0]).toMatchObject({title:'edited variant',revision:'r1'})
})

it('does not continue or apply a batch after its wizard becomes stale', async () => {
  let finish!: (result: {revision:string}) => void
  let active = true
  const save = vi.fn(() => new Promise<{revision:string}>(resolve => { finish = resolve }))
  const saver = createVariantSaver(save, vi.fn())
  const docs = [emptyDoc(),emptyDoc()]
  const result = saver.saveAll(docs, () => active)
  active = false
  finish({revision:'r1'})
  expect(await result).toBeNull()
  expect(save).toHaveBeenCalledTimes(1)
})

for (const removed of [false,true]) it(`rejects a cached receipt when remotely ${removed?'deleted':'modified'}`, async () => {
  const doc=emptyDoc()
  const save=vi.fn().mockResolvedValue({revision:'r1',updatedAt:1})
  const read=removed ? vi.fn().mockRejectedValue(Object.assign(new Error('not found'),{status:404})) : vi.fn().mockResolvedValue({...doc,revision:'r2',title:'remote winner'})
  const saver=createVariantSaver(save,read)
  await saver.saveAll([doc],()=>true)
  await expect(saver.saveAll([doc],()=>true)).rejects.toThrow(/方案/)
  expect(save).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith(doc.id)
})

it('validates unchanged receipts and returns the freshly read server document',async()=>{
  const doc=emptyDoc()
  const remote={...doc,revision:'r1',updatedAt:9}
  const save=vi.fn().mockResolvedValue({revision:'r1',updatedAt:1})
  const read=vi.fn().mockResolvedValue(remote)
  const saver=createVariantSaver(save,read)
  await saver.saveAll([doc],()=>true)
  expect(await saver.saveAll([doc],()=>true)).toEqual([remote])
  expect(save).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
})

it('does not apply receipts or continue when the validation read becomes stale',async()=>{
  const doc=emptyDoc()
  let finish!:(result:typeof doc)=>void
  let active=true
  const save=vi.fn().mockResolvedValue({revision:'r1'})
  const read=vi.fn(()=>new Promise<typeof doc>(resolve=>{finish=resolve}))
  const saver=createVariantSaver(save,read)
  await saver.saveAll([doc],()=>true)
  const pending=saver.saveAll([doc,emptyDoc()],()=>active)
  active=false
  if(finish) finish({...doc,revision:'r1'})
  expect(await pending).toBeNull()
  expect(save).toHaveBeenCalledTimes(1)
})

it('never falls back to cached content after a validation network failure',async()=>{
  const doc=emptyDoc()
  const saver=createVariantSaver(vi.fn().mockResolvedValue({revision:'r1'}),vi.fn().mockRejectedValue(new Error('offline')))
  await saver.saveAll([doc],()=>true)
  await expect(saver.saveAll([doc],()=>true)).rejects.toThrow('offline')
})
