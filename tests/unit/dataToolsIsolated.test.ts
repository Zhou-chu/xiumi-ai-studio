import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMerge, extractBackup, planMerge, resolveLegacy, writeBackup, type MergePlan } from '../../server/dataTools'

const h = vi.hoisted(() => ({
  exists: vi.fn(), readdir: vi.fn(), read: vi.fn(), mkdir: vi.fn(), copy: vi.fn(),
  rm: vi.fn(), mkdirSync: vi.fn(), open: vi.fn(), write: vi.fn(), close: vi.fn(), stream: vi.fn(),
  readJson: vi.fn(), writeJson: vi.fn(), mutateJson: vi.fn(), restore: vi.fn(),
  zip: vi.fn(), unzip: vi.fn(),
}))
vi.mock('node:fs', () => ({
  constants: { COPYFILE_EXCL: 1 }, existsSync: h.exists, mkdirSync: h.mkdirSync, openSync: h.open,
  writeSync: h.write, closeSync: h.close, createReadStream: h.stream,
}))
vi.mock('node:fs/promises', () => ({
  readdir: h.readdir, readFile: h.read, mkdir: h.mkdir, copyFile: h.copy, rm: h.rm,
}))
vi.mock('../../server/paths', () => ({ APP_ID: 'fixture-app', DATA: '/virtual/current', DATA_ENV: '/virtual/shared.env' }))
vi.mock('../../server/store', () => ({ readJson: h.readJson, writeJson: h.writeJson, mutateJson: h.mutateJson }))
vi.mock('../../server/projectStore', () => ({ restoreProjectFile: h.restore }))
type ZipCallback = (err: Error | null, chunk: Uint8Array, final: boolean) => void
type Entry = { name: string; ondata?: ZipCallback; start: () => void }
vi.mock('fflate', () => ({
  Zip: function (cb: ZipCallback) { return h.zip(cb) },
  ZipDeflate: function (name: string) { return { name, method: 'deflate', push: vi.fn() } },
  ZipPassThrough: function (name: string) { return { name, method: 'store', push: vi.fn() } },
  Unzip: function (entry: (file: Entry) => void) { return h.unzip(entry) },
  UnzipInflate: class {},
}))
const src = resolve('/virtual/old')
const dst = resolve('/virtual/current')
const settings = 'settings.json'
const index = 'assets/_index.json'
const manifest = 'xiumi-backup.json'
const allowExists = (...files: string[]) => h.exists.mockImplementation(path => files.includes(path))
const stores = (files: Record<string, unknown>) => h.readJson.mockImplementation((path, fallback) => files[path] ?? fallback)
const fail = (code: string) => Object.assign(new Error(code), { code })
type DirEntry = [name: string, kind: 'dir' | 'file' | 'link']
function directory(dir: string, entries: DirEntry[]) {
  const previous = h.readdir.getMockImplementation()!
  h.readdir.mockImplementation((p, opts) => p === dir && opts?.withFileTypes === true
    ? entries.map(([name, kind]) => ({ name, isDirectory: () => kind === 'dir', isFile: () => kind === 'file' }))
    : previous(p, opts))
}
function plan(overrides: Partial<MergePlan> = {}): MergePlan {
  return { source: src, target: dst, counts: {
    projects: { add: 0, skip: 0 }, versions: { add: 0, skip: 0 }, templates: { add: 0, skip: 0 },
    components: { add: 0, skip: 0 }, themes: { add: 0, skip: 0 }, assets: { add: 0, skip: 0 },
  }, ignored: 0, ai: { add: [], skip: [], withKeys: false }, env: null, files: [], ...overrides }
}
beforeEach(() => {
  for (const [name, fn] of Object.entries(h)) {
    fn.mockReset().mockImplementation(() => { throw Error('Unexpected external call: ' + name) })
  }
  allowExists()
  stores({})
})

describe('planMerge', () => {
  it('only plans whitelisted readable files, skips current files, and never writes', async () => {
    const projects = join(src, 'projects'), versions = join(src, 'versions'), assets = join(src, 'assets')
    allowExists(src, projects, versions, join(versions, 'p'), assets, join(dst, 'projects/current.json'))
    directory(src, [['projects','dir'], ['versions','dir'], ['assets','dir'], [settings,'file'], [manifest,'file'], ['.env','file'], ['symlink','link']])
    directory(projects, [['new.json','file'], ['current.json','file'], ['bad.json','file'], ['unreadable.json','file'], ['bad.name.json','file']])
    directory(versions, [['p','dir']]); directory(join(versions, 'p'), [['rev_1.json','file']])
    directory(assets, [['_index.json','file'], ['photo.jpg','file'], ['skip.webp','file']])
    h.read.mockImplementation((path, encoding) => {
      expect(encoding).toBe('utf8')
      if (path === join(projects, 'unreadable.json')) throw fail('EACCES')
      if (path === join(projects, 'bad.json')) return '{'
      expect([join(projects, 'new.json'), join(projects, 'current.json'), join(versions, 'p/rev_1.json')]).toContain(path)
      return '{}'
    })
    const preview = await planMerge(src, null, dst)
    expect(preview.files).toEqual([{ rel: 'projects/new.json', category: 'projects' }, { rel: 'versions/p/rev_1.json', category: 'versions' }, { rel: 'assets/photo.jpg', category: 'assets' }])
    expect(preview.counts.projects).toEqual({ add: 1, skip: 1 })
    expect(preview.counts.versions).toEqual({ add: 1, skip: 0 })
    expect(preview.ignored).toBe(5)
    expect(h.read.mock.calls.map(([path]) => path)).toEqual([
      ...['new.json', 'current.json', 'bad.json', 'unreadable.json'].map(name => join(projects, name)), join(versions, 'p/rev_1.json'),
    ])
    for (const fn of [h.copy, h.mkdir, h.writeJson, h.mutateJson, h.restore, h.rm]) expect(fn).not.toHaveBeenCalled()
  })

  it.each(['copy', 'exists', null] as const)('discloses add/skip AI profiles without exposing keys; env=%s', async action => {
    const env = join(src, '.env')
    allowExists(...(action ? [env] : []), ...(action === 'exists' ? [join(dst, '.env')] : []))
    stores({
      [join(src, settings)]: { ai: { profiles: [null, {}, { id: 'both', name: 'Existing', apiKey: 'fake-old' }, { id: 'new', apiKey: 'fake-new' }] } },
      [join(dst, settings)]: { ai: { profiles: [{ id: 'both' }] } },
    })
    const preview = await planMerge(src, env, dst)
    expect(preview.ai).toEqual({ add: ['new'], skip: ['Existing'], withKeys: true })
    expect(JSON.stringify(preview)).not.toContain('fake-')
    expect(preview.env).toEqual(action ? { source: env, target: join(dst, '.env'), action } : null)
    expect(h.readdir).not.toHaveBeenCalled()
  })
})

describe('applyMerge', () => {
  it('delegates project writes and preserves files that appear after planning', async () => {
    const p = plan({ files: [{ rel: 'projects/a.json', category: 'projects' }, { rel: 'templates/b.json', category: 'templates' }] })
    p.counts.projects.skip = 1
    h.mkdir.mockResolvedValue(undefined); h.restore.mockResolvedValue(undefined)
    h.copy.mockRejectedValueOnce(fail('EEXIST'))
    expect(await applyMerge(p)).toEqual({ copied: 1, skipped: 2, aiAdded: 0, envCopied: false })
    expect(h.restore).toHaveBeenCalledExactlyOnceWith(join(src, 'projects/a.json'), join(dst, 'projects/a.json'))
    expect(h.copy).toHaveBeenCalledExactlyOnceWith(join(src, 'templates/b.json'), join(dst, 'templates/b.json'), 1)
  })

  it('stops subsequent steps on a hard copy error; does not promise rollback of earlier writes', async () => {
    const p = plan({ files: ['a','b','c'].map(id => ({ rel: 'templates/' + id + '.json', category: 'templates' })) })
    h.mkdir.mockResolvedValue(undefined); const error = fail('EIO')
    h.copy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error)
    await expect(applyMerge(p)).rejects.toBe(error)
    expect(h.copy).toHaveBeenCalledTimes(2)
    expect(h.copy).toHaveBeenNthCalledWith(1, join(src, 'templates/a.json'), join(dst, 'templates/a.json'), 1)
    expect(h.readJson).not.toHaveBeenCalled(); expect(h.rm).not.toHaveBeenCalled()
  })

  it('adds only present/copied assets, rejecting unsafe names and retaining current index entries', async () => {
    const p = plan({ files: [{ rel: 'assets/new.jpg', category: 'assets' }] })
    const keep = { file: 'local.jpg' }
    const current = { keep }
    stores({ [join(src, index)]: { keep: { file: 'new.jpg' }, fresh: { file: 'new.jpg' }, present: { file: 'present.png' }, absent: { file: 'absent.jpg' }, unsafe: { file: '../bad.jpg' }, missing: {}, empty: null } })
    allowExists(join(dst, 'assets/present.png'))
    h.mkdir.mockResolvedValue(undefined); h.copy.mockResolvedValueOnce(undefined)
    h.mutateJson.mockImplementationOnce(async (path, initial, mutate) => {
      expect(path).toBe(join(dst, index)); expect(initial).toEqual({})
      expect(await mutate(current)).toBe(true)
    })
    expect((await applyMerge(p)).copied).toBe(1)
    expect(current).toEqual({ keep, fresh: { file: 'new.jpg' }, present: { file: 'present.png' } })
    expect(h.exists).not.toHaveBeenCalledWith(join(dst, 'bad.jpg'))
  })

  it('rereads profiles at application time and preserves current active model', async () => {
    const p = plan({ ai: { add: ['late', 'new'], skip: [], withKeys: true } })
    const late = { id: 'late', apiKey: 'fake-current' }, added = { id: 'new', apiKey: 'fake-migrated' }
    stores({ [join(src, settings)]: { ai: { activeId: 'new', profiles: [{ id: 'late' }, added, null] } }, [join(dst, settings)]: { mode: 'local', ai: { activeId: 'late', profiles: [late] } } })
    h.writeJson.mockResolvedValueOnce(undefined)
    expect((await applyMerge(p)).aiAdded).toBe(1)
    expect(h.writeJson).toHaveBeenCalledExactlyOnceWith(join(dst, settings), { mode: 'local', ai: { activeId: 'late', profiles: [late, added] } })
  })

  it.each(['copied','exists','error'] as const)('uses exclusive .env copy: %s', async result => {
    const env = { source: join(src, '.env'), target: join(dst, '.env'), action: 'copy' as const }
    if (result === 'copied') h.copy.mockResolvedValueOnce(undefined)
    else h.copy.mockRejectedValueOnce(fail(result === 'exists' ? 'EEXIST' : 'EPERM'))
    const work = applyMerge(plan({ env }))
    if (result === 'error') await expect(work).rejects.toMatchObject({ code: 'EPERM' })
    else await expect(work).resolves.toMatchObject({ envCopied: result === 'copied' })
    expect(h.copy).toHaveBeenCalledExactlyOnceWith(env.source, env.target, 1)
  })
})

describe('resolveLegacy', () => {
  it('prefers a valid child data directory and its project-root .env', () => {
    const data = join(src, 'data')
    allowExists(src, data, join(data, 'projects'), join(src, '.env'))
    expect(resolveLegacy('  "' + src + '"  ', dst)).toEqual({ dataDir: data, envFile: join(src, '.env') })
  })
  it('uses a direct data folder, with its parent .env as fallback only', () => {
    const data = join(src, 'data')
    allowExists(data, join(data, 'assets'), join(src, '.env'))
    expect(resolveLegacy(data, dst)).toEqual({ dataDir: data, envFile: join(src, '.env') })
    allowExists(data, join(data, 'assets'), join(data, '.env'), join(src, '.env'))
    expect(resolveLegacy(data, dst)).toEqual({ dataDir: data, envFile: join(data, '.env') })
  })
  it.each(['empty','absent','invalid','same','target-inside','source-inside'] as const)('rejects %s location', kind => {
    const source = kind === 'source-inside' ? join(dst,'old') : src
    const target = kind === 'same' ? source : kind === 'target-inside' ? join(source,'new') : dst
    if (kind === 'invalid') allowExists(source)
    else if (!['empty','absent'].includes(kind)) allowExists(source, join(source,'projects'))
    const expected = { empty: '请填写', absent: '找不到', invalid: '没有 XIUMI', same: '无需迁移', 'target-inside': '无需迁移', 'source-inside': '无需迁移' }[kind]
    expect(() => resolveLegacy(kind === 'empty' ? ' ' : source, target)).toThrow(expected)
  })
})

describe('writeBackup', () => {
  it('selects eligible entries and strips AI keys without reading .env or mutating settings', async () => {
    const root = '/virtual/current', assets = join(root,'assets')
    allowExists(root, assets)
    directory(root, [['assets','dir'], ['.env','file'], [settings,'file'], ['unknown.txt','file']])
    directory(assets, [['photo.jpg','file'], ['_index.json','file']])
    const profile = { id: 'model', apiKey: 'synthetic-key', baseUrl: 'https://example.invalid' }
    stores({ [join(root, settings)]: { theme: 'dark', ai: { activeId: 'model', profiles: [profile] } } })
    const entries = new Map<string, { method: string; push: ReturnType<typeof vi.fn> }>()
    h.zip.mockImplementationOnce((cb: ZipCallback) => ({
      add: (f: { name: string; method: string; push: ReturnType<typeof vi.fn> }) => entries.set(f.name,f),
      end: () => cb(null, Buffer.from('mock archive'), true),
    }))
    h.read.mockImplementation(path => {
      if (path === join(assets,'photo.jpg')) return Buffer.from('mock photo')
      if (path === join(assets,'_index.json')) return Buffer.from('{}')
      throw Error('Unexpected read: ' + path)
    })
    const out = { write: vi.fn(), end: vi.fn() }
    await expect(writeBackup(out as never,'fixture-version')).resolves.toEqual({ files: 2 })
    expect([...entries.keys()]).toEqual([manifest,settings,'assets/photo.jpg',index])
    const contents = (name: string) => entries.get(name)!.push.mock.calls[0][0].toString()
    expect(JSON.parse(contents(manifest))).toMatchObject({ app: 'fixture-app', version: 'fixture-version' })
    expect(JSON.parse(contents(settings))).toEqual({ theme: 'dark', ai: { activeId: 'model', profiles: [{ ...profile, apiKey: '' }] } })
    expect(entries.get('assets/photo.jpg')?.method).toBe('store')
    expect(entries.get(index)?.method).toBe('deflate')
    expect(out.write).toHaveBeenCalledExactlyOnceWith(Buffer.from('mock archive'))
    expect(out.end).toHaveBeenCalledOnce()
    expect(profile.apiKey).toBe('synthetic-key')
  })
  it('rejects ZIP callback errors rather than ending a successful stream', async () => {
    const err = fail('EIO')
    h.zip.mockImplementationOnce((cb: ZipCallback) => ({ add: vi.fn(), end: () => cb(err,new Uint8Array(),true) }))
    const out = { write: vi.fn(), end: vi.fn() }
    await expect(writeBackup(out as never,'fixture-version')).rejects.toBe(err)
    expect(out.write).not.toHaveBeenCalled(); expect(out.end).not.toHaveBeenCalled()
  })
})

describe('extractBackup', () => {
  const archive = join(src, 'archive.zip')
  const temp = join(dst, 'private-stage')
  const valid = Buffer.from(JSON.stringify({ app: 'fixture-app' }))
  function fixture(entryEvents: (emit: (file: Entry) => void) => void, readError = false) {
    h.rm.mockResolvedValueOnce(undefined); h.mkdirSync.mockReturnValue(undefined)
    const destroy = vi.fn()
    let input: (() => void) | undefined
    h.unzip.mockImplementationOnce((emit: (file: Entry) => void) => ({
      register: vi.fn(), push: (_chunk: Uint8Array, final?: boolean) => { if (!final) entryEvents(emit) },
    }))
    const handlers = new Map<string, (...values: unknown[]) => void>()
    h.stream.mockImplementationOnce((path: string) => {
      expect(path).toBe(archive)
      input = () => {
        if (readError) handlers.get('error')!(fail('EIO'))
        else { handlers.get('data')!(Buffer.from('mock input')); handlers.get('end')!() }
      }
      return { on: (name: string, cb: (...values: unknown[]) => void) => handlers.set(name,cb), destroy }
    })
    return { destroy, feed: () => { if (!input) throw Error('No registered ZIP reader'); input() } }
  }
  const emitEntry = (emit: (file: Entry) => void, name: string, onStart: (f: Entry) => void) => {
    const entry: Entry = { name, start: vi.fn(() => onStart(entry)) }
    emit(entry)
    return entry
  }
  it('filters entries, waits for pending accepted entries and closes each fd', async () => {
    let late: Entry | undefined
    let blocked: Entry | undefined
    const f = fixture(emit => {
      emitEntry(emit, manifest, e => { e.ondata!(null, valid.subarray(0,4),false); e.ondata!(null, valid.subarray(4),true) })
      blocked = emitEntry(emit, '../outside.json', () => { throw Error('unexpected start') })
      late = emitEntry(emit, 'projects/a.json', () => {})
    })
    h.open.mockReturnValueOnce(41); h.write.mockReturnValueOnce(2); h.close.mockReturnValueOnce(undefined)
    const settled = vi.fn()
    const work = extractBackup(archive,temp).then(settled)
    await Promise.resolve()
    f.feed()
    await new Promise<void>(resolveTick => setImmediate(resolveTick))
    expect(settled).not.toHaveBeenCalled()
    expect(blocked?.start).not.toHaveBeenCalled()
    late!.ondata!(null,Buffer.from('{}'),true)
    await work
    expect(h.rm).toHaveBeenCalledExactlyOnceWith(temp,{ recursive: true, force: true })
    expect(h.mkdirSync).toHaveBeenNthCalledWith(1,temp,{ recursive: true })
    expect(h.open).toHaveBeenCalledExactlyOnceWith(join(temp,'projects/a.json'),'w')
    expect(h.write).toHaveBeenCalledExactlyOnceWith(41,Buffer.from('{}'))
    expect(h.close).toHaveBeenCalledExactlyOnceWith(41)
  })
  it.each(['bad-manifest','read-error','parser-error','entry-error'] as const)('rejects %s', async kind => {
    const error = fail('decode')
    const f = fixture(emit => {
      if (kind === 'parser-error') throw error
      emitEntry(emit,manifest,e => e.ondata!(null,kind === 'bad-manifest' ? Buffer.from('{') : valid,true))
      if (kind === 'entry-error') emitEntry(emit,'projects/a.json',e => e.ondata!(error,new Uint8Array(),true))
    },kind === 'read-error')
    if (kind === 'entry-error') { h.open.mockReturnValueOnce(41); h.close.mockReturnValueOnce(undefined) }
    const work = extractBackup(archive,temp)
    const rejected = kind === 'entry-error' ? expect(work).rejects.toBe(error) : expect(work).rejects.toThrow(kind === 'bad-manifest' ? '不是 XIUMI' : '不是有效的 zip')
    await Promise.resolve(); f.feed(); await rejected
    if (kind === 'entry-error') expect(h.close).toHaveBeenCalledExactlyOnceWith(41)
    else expect(h.open).not.toHaveBeenCalled()
    if (kind === 'parser-error') expect(f.destroy).toHaveBeenCalledOnce()
  })
})
