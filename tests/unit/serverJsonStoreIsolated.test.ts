import { join, resolve } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { DIRS, collection, mutateJson, readJson, safeId, writeJson } from '../../server/store'

const h = vi.hoisted(() => ({
  exists: vi.fn(), syncDir: vi.fn(), mkdir: vi.fn(), list: vi.fn(),
  read: vi.fn(), rename: vi.fn(), remove: vi.fn(), write: vi.fn(), id: vi.fn(),
}))
vi.mock('../../server/paths', () => ({ DATA: '/isolated-fixture/data', ROOT: '/isolated-fixture/root' }))
vi.mock('node:fs', () => ({ existsSync: h.exists, mkdirSync: h.syncDir }))
vi.mock('node:fs/promises', () => ({ mkdir: h.mkdir, readdir: h.list, readFile: h.read, rename: h.rename, rm: h.remove, writeFile: h.write }))
vi.mock('node:crypto', () => ({ randomUUID: h.id }))

const initialized = h.syncDir.mock.calls.slice()
const virtual = new Map<string, string>()
const dir = resolve('/isolated-fixture/test')
const target = join(dir, 'project.json')
const paths = () => [...virtual.keys()].sort()
const store = (value: unknown) => virtual.set(target, JSON.stringify(value))
const find = (file: string) => {
  const text = virtual.get(file)
  if (text === undefined) throw Object.assign(new Error('Synthetic file missing'), { code: 'ENOENT' })
  return text
}
beforeEach(() => {
  let serial = 0
  virtual.clear()
  h.id.mockReset().mockImplementation(() => 'fake-'+(++serial))
  for (const mock of [h.exists, h.mkdir, h.list, h.read, h.rename, h.remove, h.write]) mock.mockReset().mockImplementation(() => { throw Error('Unexpected virtual boundary') })
  h.exists.mockImplementation((file: string) => virtual.has(file))
  h.mkdir.mockResolvedValue(undefined)
  h.read.mockImplementation(async (file: string) => find(file))
  h.write.mockImplementation(async (file: string, value: string) => { virtual.set(file, value) })
  h.rename.mockImplementation(async (source: string, dest: string) => { virtual.set(dest, find(source)); virtual.delete(source) })
  h.remove.mockImplementation(async (file: string) => { virtual.delete(file) })
})
it('only initializes the seven configured virtual storage directories', () => {
  expect(initialized).toEqual(Object.values(DIRS).map(path => [path, { recursive: true }]))
  expect(Object.keys(DIRS)).toEqual(['projects','versions','templates','components','themes','assets','cache'])
})
it('returns only safe opaque IDs and rejects unusable names before a storage action', () => {
  expect(safeId('draft_ABC-09')).toBe('draft_ABC-09')
  const c = collection<{ id: string }>(dir)
  for (const invalid of ['', ' ', 'contains slash/', 'contains dot.', 'a'.repeat(65)]) {
    expect(() => c.get(invalid)).toThrow('非法 id')
    expect(() => c.remove(invalid)).toThrow('非法 id')
    expect(() => c.exists(invalid)).toThrow('非法 id')
  }
  expect(h.read).not.toHaveBeenCalled()
  expect(h.remove).not.toHaveBeenCalled()
})
it('returns the untouched caller fallback for unreadable or malformed JSON', async () => {
  const fallback = { id: 'untouched' }
  await expect(readJson(target, fallback)).resolves.toBe(fallback)
  virtual.set(target, '{ not json')
  await expect(readJson(target, fallback)).resolves.toBe(fallback)
  store({ id: 'parsed' })
  await expect(readJson(target, fallback)).resolves.toEqual({ id: 'parsed' })
  expect(h.read.mock.calls).toEqual([[target,'utf8'],[target,'utf8'],[target,'utf8']])
})
it('captures the JSON snapshot before queueing and atomically publishes only the complete temporary file', async () => {
  const value = { name: 'original' }
  store({ name: 'previous' })
  const persisted = writeJson(target, value)
  value.name = 'edited later'
  expect(find(target)).toBe('{"name":"previous"}')
  await persisted
  const tmp = `${target}.${process.pid}.fake-1.tmp`
  expect(h.write).toHaveBeenCalledExactlyOnceWith(tmp,'{"name":"original"}','utf8')
  expect(h.rename).toHaveBeenCalledExactlyOnceWith(tmp,target)
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(tmp,{ force:true })
  expect(find(target)).toBe('{"name":"original"}')
  expect(paths()).toEqual([target])
})
it('removes only the failed temporary path and allows an already queued replacement', async () => {
  const original = Object.assign(new Error('Synthetic rename refused'), { code: 'EIO' })
  store({ name: 'previous' })
  h.rename.mockRejectedValueOnce(original)
  const first = writeJson(target, { name:'failed' })
  const second = writeJson(target, { name:'next' })
  await expect(first).rejects.toBe(original)
  await expect(second).resolves.toBeUndefined()
  expect(find(target)).toBe('{"name":"next"}')
  expect(paths()).toEqual([target])
  expect(h.remove.mock.calls.map(c=>c[0])).toEqual([
    `${target}.${process.pid}.fake-1.tmp`,
    `${target}.${process.pid}.fake-2.tmp`,
  ])
})
it('serializes read-modify-write, skips false updates and releases the queue on failure', async () => {
  store({ sum: 1 })
  const failure = Error('Synthetic update failed')
  const one = mutateJson(target, { sum: 0 }, value => { value.sum = 4 })
  const two = mutateJson(target, { sum: 0 }, value => { value.sum = 999; return false })
  const three = mutateJson(target, { sum: 0 }, () => { throw failure })
  const four = mutateJson(target, { sum: 0 }, async value => { value.sum += 2 })
  await Promise.all([one, two, expect(three).rejects.toBe(failure), four])
  expect(find(target)).toBe('{"sum":6}')
  expect(h.rename).toHaveBeenCalledTimes(2)
  expect(paths()).toEqual([target])
})
it('lists only parseable JSON records and keeps operations within the collection', async () => {
  const records = collection<{ id: string; text: string }>(dir)
  expect(await records.list()).toEqual([])
  expect(h.list).not.toHaveBeenCalled()
  h.exists.mockImplementation((file: string) => file === dir || virtual.has(file))
  h.list.mockResolvedValue(['a.json','stale.json','notes.txt'])
  virtual.set(join(dir,'a.json'),'{"id":"a","text":"alive"}')
  virtual.set(join(dir,'stale.json'),'invalid')
  expect(await records.list()).toEqual([{ id:'a', text:'alive' }])
  expect(h.read.mock.calls).not.toContainEqual([join(dir,'notes.txt'),'utf8'])
  await records.put({ id: 'b', text: 'new' })
  expect(h.mkdir).toHaveBeenCalledExactlyOnceWith(dir,{recursive:true})
  expect(records.exists('b')).toBe(true)
  expect(await records.get('b')).toEqual({ id: 'b', text: 'new' })
  await records.remove('b')
  expect(await records.get('b')).toBeNull()
  expect(virtual.has(join(dir,'a.json'))).toBe(true)
})
