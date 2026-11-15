import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { projectCollection, restoreProjectFile, withProjectFile } from '../../server/projectStore'

const h = vi.hoisted(() => ({
  read: vi.fn(), stat: vi.fn(), write: vi.fn(), copy: vi.fn(), remove: vi.fn(),
  put: vi.fn(), removeProject: vi.fn(), id: vi.fn(), safe: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ readFile: h.read, stat: h.stat, writeFile: h.write, copyFile: h.copy, rm: h.remove }))
vi.mock('node:crypto', async original => ({ ...await original<typeof import('node:crypto')>(), randomUUID: h.id }))
vi.mock('../../server/store', () => ({
  collection: () => ({ put: h.put, remove: h.removeProject }),
  safeId: h.safe,
}))
const dir = resolve('/virtual-projects')
const target = resolve(dir,'document.json')
const source = resolve('/virtual-archive/document.json')
type Draft = { id: string; revision?: string | null; title: string; updatedAt?: number }
const original = { id:'document', title:'原稿' }
const virtual = new Map<string,string>()
const ENOENT = () => Object.assign(Error('Virtual file missing'),{code:'ENOENT'})
const exists = (path: string) => {
  const value = virtual.get(path)
  if (value===undefined) throw ENOENT()
  return value
}
const stored = () => JSON.parse(exists(target)) as Draft
const queue = () => projectCollection<{id:string;revision?:string;title:string;updatedAt?:number}>(dir)
beforeEach(() => {
  virtual.clear()
  for (const mock of Object.values(h)) mock.mockReset().mockImplementation(() => { throw Error('Unexpected virtual project boundary') })
  let serial = 0
  h.id.mockImplementation(() => 'synthetic-revision-'+(++serial))
  h.safe.mockImplementation((s:string) => s)
  h.read.mockImplementation(async (path:string) => exists(path))
  h.stat.mockImplementation(async (path:string) => { exists(path); return {} })
  h.write.mockImplementation(async (path:string, data:string) => { virtual.set(path,data) })
  h.copy.mockImplementation(async (from:string,to:string) => {
    if(virtual.has(to)) throw Object.assign(Error('Virtual target exists'),{code:'EEXIST'})
    virtual.set(to,exists(from))
  })
  h.remove.mockImplementation(async (path:string) => { virtual.delete(path) })
  h.put.mockImplementation(async (doc:Draft) => { virtual.set(resolve(dir,doc.id+'.json'),JSON.stringify(doc)) })
  h.removeProject.mockImplementation(async (id:string) => { virtual.delete(resolve(dir,id+'.json')) })
  vi.spyOn(Date,'now').mockReturnValue(123)
})
afterEach(() => vi.restoreAllMocks())
it('returns null for a missing project and gives unversioned bytes a stable legacy digest without writing', async () => {
  const projects = queue()
  expect(await projects.get(original.id)).toBeNull()
  virtual.set(target,JSON.stringify(original))
  const first = await projects.get(original.id)
  expect(first).toMatchObject({...original,revision:expect.stringMatching(/^legacy-[a-f0-9]{64}$/)})
  expect(await projects.get(original.id)).toEqual(first)
  expect(stored().revision).toBeUndefined()
  expect(h.put).not.toHaveBeenCalled()
})
it('snapshots the exact draft before queued publication, rejects stale writes and preserves the new revision', async () => {
  const projects = queue()
  const input = {...original}
  const pending = projects.put(input)
  input.title='not submitted'
  const saved = await pending
  expect(saved).toEqual({...original,revision:'synthetic-revision-1',updatedAt:123})
  expect(stored()).toEqual(saved)
  await expect(projects.put({...original,title:'旧页',revision:'not-current'})).rejects.toMatchObject({status:409})
  expect(h.put).toHaveBeenCalledTimes(1)
  const edited = await projects.put({...saved,title:'新编辑'})
  expect(edited.revision).toBe('synthetic-revision-2')
  expect(stored()).toEqual(edited)
})
it.each(['not-json','{"id":"other"}','[{"id":"document"}]','null'])('rejects malformed or mismatched existing content %s without overwriting it', async raw => {
  virtual.set(target,raw)
  const projects = queue()
  await expect(projects.put(original)).rejects.toMatchObject({status:409,message:expect.stringContaining('保留原文件')})
  expect(h.put).not.toHaveBeenCalled()
  expect(virtual.get(target)).toBe(raw)
})
it('does not resurrect a deleted document with a stale write token', async () => {
  const projects = queue()
  const doc = await projects.put(original)
  await projects.remove(doc.id)
  expect(await projects.get(doc.id)).toBeNull()
  await expect(projects.put(doc)).rejects.toMatchObject({status:409})
  expect(h.put).toHaveBeenCalledTimes(1)
  expect(h.removeProject).toHaveBeenCalledExactlyOnceWith('document')
})
it('restores only a missing target under a new revision and keeps the source bytes', async () => {
  const archived = {...original,revision:'deleted-revision',updatedAt:5}
  virtual.set(source,JSON.stringify(archived))
  await restoreProjectFile(source,target)
  const expected = {...archived,revision:'synthetic-revision-1'}
  const temporary = target + '.synthetic-revision-2.restore.tmp'
  expect(stored()).toEqual(expected)
  expect(JSON.parse(exists(source))).toEqual(archived)
  expect(h.write).toHaveBeenCalledExactlyOnceWith(temporary,JSON.stringify(expected),{encoding:'utf8',flag:'wx'})
  expect(h.copy).toHaveBeenCalledExactlyOnceWith(temporary,target,constants.COPYFILE_EXCL)
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(temporary,{force:true})
  expect(virtual.has(temporary)).toBe(false)
  await expect(restoreProjectFile(source,target)).rejects.toMatchObject({code:'EEXIST'})
  expect(h.copy).toHaveBeenCalledTimes(1)
  expect(stored()).toEqual(expected)
})
it('cleans a failed exclusive publication and refuses invalid restore IDs without writing', async () => {
  virtual.set(source, JSON.stringify({...original,id:'mismatched'}))
  await expect(restoreProjectFile(source,target)).rejects.toMatchObject({status:409})
  expect(h.write).not.toHaveBeenCalled()
  virtual.set(source,JSON.stringify(original))
  const failure = Error('Intervening exclusive copy refusal')
  h.copy.mockRejectedValueOnce(failure)
  await expect(restoreProjectFile(source,target)).rejects.toBe(failure)
  expect([...virtual.keys()]).toEqual([source])
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(target+'.synthetic-revision-2.restore.tmp',{force:true})
})
it('serializes the same synthetic path across an error and permits unrelated operations', async () => {
  let unblock!: () => void
  const hold = new Promise<void>(resolve => { unblock=resolve })
  const marks: string[] = []
  const error = Error('virtual failure')
  const one = withProjectFile(target,async() => { marks.push('first'); await hold; throw error })
  const two = withProjectFile(target,async() => { marks.push('second'); return 'done' })
  const other = withProjectFile(source,async() => { marks.push('other') })
  try {
    await other
    expect(marks).toEqual(['first','other'])
  } finally { unblock() }
  await expect(one).rejects.toBe(error)
  await expect(two).resolves.toBe('done')
  expect(marks).toEqual(['first','other','second'])
})
