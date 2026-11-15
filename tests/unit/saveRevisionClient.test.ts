// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import * as store from '../../src/editor/store'
const h = vi.hoisted(() => ({ saveProject: vi.fn(), themes: vi.fn(), fetch: vi.fn() }))
vi.mock('../../src/editor/api', () => ({ api: { saveProject: h.saveProject, themes: h.themes } }))
const unexpected = () => { throw Error('Unexpected save revision boundary call') }
beforeEach(() => {
 vi.useFakeTimers()
 for (const mock of Object.values(h)) mock.mockReset().mockImplementation(unexpected)
 vi.stubGlobal('fetch', h.fetch)
 store.useStore.getState().load({...store.emptyDoc(),revision:'r1'})
})
afterEach(() => {
 vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
 expect(h.fetch).not.toHaveBeenCalled()
 expect(h.themes).not.toHaveBeenCalled()
})
it('keeps server revision independent of undo snapshots',async()=>{
 const save=vi.spyOn(api,'saveProject').mockResolvedValue({updatedAt:1,revision:'r2'} as any)
 store.useStore.getState().setDocFields({title:'edit'}); await store.saveNow(); store.useStore.getState().undo(); await store.saveNow()
 expect((save.mock.calls[1][0] as any).revision).toBe('r2')
})
it('retains conflict edits and writes an explicit new-ID copy rather than forcing overwrite',async()=>{
 const original=store.useStore.getState().doc
 const save=vi.spyOn(api,'saveProject').mockRejectedValue(Object.assign(new Error('conflict'),{status:409}))
 await store.saveNow(); expect((store.useStore.getState() as any).saveConflict).toBe(true)
 store.useStore.getState().setDocFields({title:'keep local'})
 await store.saveNow(); expect(save).toHaveBeenCalledTimes(1)
 save.mockResolvedValue({updatedAt:2,revision:'copy-r1'} as any)
 expect(await (store as any).saveConflictCopy()).toBe(true)
 expect(store.useStore.getState().doc.id).not.toBe(original.id)
 expect(store.useStore.getState().doc.title).toContain('keep local')
 expect((store.useStore.getState() as any).savedRevision).toBe('copy-r1')
})
