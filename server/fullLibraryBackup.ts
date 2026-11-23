import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { assertLibraryRestoreCapacity } from './libraryRestoreBudget'

const CATEGORIES = ['projects', 'versions', 'templates', 'components', 'themes', 'assets'] as const
const INDEX = 'assets/_index.json'
const SETTINGS = 'settings.json'
const CHUNK = 64 * 1024
const MAX_JSON_META = 16 * 1024 * 1024
// fflate emits classic ZIP (not ZIP64). Stay below its 4 GiB/65535 hard limits
// even for incompressible input and central-directory overhead.
const MAX_BYTES = 3 * 1024 * 1024 * 1024
const MAX_FILES = 50_000
const tooLarge = () => Object.assign(new Error('整库备份超过当前 ZIP 容量，请先清理不需要的素材'), { status: 413 })
const malformed = () => Object.assign(new Error('整库备份元数据格式无效，请先检查本机设置和素材目录'), { status: 400 })
const stale = () => Object.assign(new Error('备份期间文件发生变化，请重试'), { status: 409 })
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

type RecordData = Record<string, unknown>
type LocalFile = { name: string; size: number; dev: bigint; ino: bigint }
const asRecord = (value: unknown): RecordData | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : null
const safeId = /^[\w-]{1,64}$/
const assetFile = /^[\w-]{1,64}\.(?:jpg|png)$/

function safeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function publicSettings(value: unknown) {
  const ai = asRecord(asRecord(value)?.ai)
  const raw = Array.isArray(ai?.profiles) ? ai.profiles : []
  const profiles = raw.flatMap(item => {
    const p = asRecord(item)
    if (!p || typeof p.id !== 'string' || !safeId.test(p.id) || p.id === 'env') return []
    const text = (field: string) => typeof p[field] === 'string' ? p[field] : undefined
    const count = (field: string) => typeof p[field] === 'number' && Number.isSafeInteger(p[field]) ? p[field] : undefined
    return [{
      id: p.id, name: text('name'), provider: p.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: safeBaseUrl(p.baseUrl), apiKey: '', model: text('model'), jsonMode: p.jsonMode === true,
      reasoningEffort: text('reasoningEffort'), efforts: Array.isArray(p.efforts) ? p.efforts.filter(value => typeof value === 'string') : undefined,
      contextWindow: count('contextWindow'), maxOutputTokens: count('maxOutputTokens'),
      // extraBody may carry vendor credentials under arbitrary keys; omit it.
    }]
  })
  const activeId = profiles.some(p => p.id === ai?.activeId) ? ai?.activeId : profiles[0]?.id ?? ''
  return { ai: { activeId, profiles } }
}

function publicAssetIndex(value: unknown, files: Set<string>) {
  return Object.fromEntries(Object.entries(asRecord(value) ?? {}).flatMap(([id, item]) => {
    const p = asRecord(item)
    if (!p || p.id !== id || !safeId.test(id) || typeof p.file !== 'string' || !assetFile.test(p.file) || !files.has('assets/' + p.file)) return []
    const { file, name, width, height, size, createdAt } = p
    if (typeof name !== 'string' || typeof width !== 'number' || typeof height !== 'number' ||
        typeof size !== 'number' || typeof createdAt !== 'number' ||
        ![width, height, size, createdAt].every(Number.isFinite)) return []
    return [[id, { id, file, name, width, height, size, createdAt }]]
  }))
}

async function jsonFile(handle: FileHandle) {
  const parts: Buffer[] = []
  let length = 0
  for await (const chunk of handle.createReadStream({ highWaterMark: CHUNK, autoClose: false })) {
    length += chunk.length
    if (length > MAX_JSON_META) throw tooLarge()
    parts.push(chunk)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, length))) as unknown
  } catch {
    // JSON parser diagnostics may quote credential-containing source text.
    throw malformed()
  }
}

async function* listed(root: string, leaves: (name: string) => boolean, scan: () => void): AsyncGenerator<string> {
  let dir
  try { dir = await opendir(root) }
  catch (error) { if (missing(error)) return; throw error }
  for await (const entry of dir) {
    scan()
    if (entry.isFile() && leaves(entry.name)) yield entry.name
  }
}

async function* names(root: string, signal: AbortSignal): AsyncGenerator<string> {
  let scanned = 0
  const scan = () => {
    signal.throwIfAborted()
    if (++scanned > MAX_FILES * 4) throw tooLarge()
  }
  for (const category of CATEGORIES) {
    const dir = join(root, category)
    let info
    try { info = await lstat(dir) }
    catch (error) { if (missing(error)) continue; throw error }
    if (!info.isDirectory()) continue
    if (category === 'versions') {
      const versionDirs = await opendir(dir)
      for await (const entry of versionDirs) {
        scan()
        if (entry.isDirectory() && safeId.test(entry.name)) {
          for await (const file of listed(join(dir, entry.name), name => /^[\w-]{1,80}\.json$/.test(name), scan)) yield `versions/${entry.name}/${file}`
        }
      }
    } else {
      const pattern = category === 'assets' ? assetFile : /^[\w-]{1,64}\.json$/
      for await (const file of listed(dir, name => pattern.test(name), scan)) yield `${category}/${file}`
    }
  }
}

async function localFile(root: string, name: string): Promise<LocalFile | null> {
  try {
    const info = await lstat(join(root, name), { bigint: true })
    return info.isFile() ? { name, size: Number(info.size), dev: info.dev, ino: info.ino } : null
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

async function openOwned(root: string, file: LocalFile) {
  const src = join(root, file.name)
  const owner = relative(root, await realpath(dirname(src)))
  if (owner === '..' || owner.startsWith('..' + sep) || isAbsolute(owner)) throw stale()
  const handle = await open(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const actual = await handle.stat({ bigint: true })
    if (!actual.isFile() || actual.ino !== file.ino || actual.dev !== file.dev || Number(actual.size) !== file.size) throw stale()
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function safeJson(root: string, name: string) {
  const source = await localFile(root, name)
  if (!source) return undefined
  if (source.size > MAX_JSON_META) throw tooLarge()
  const handle = await openOwned(root, source)
  try {
    const result = await jsonFile(handle)
    if (!asRecord(result)) throw malformed()
    return result
  }
  finally { await handle.close() }
}

export async function planLibraryBackup(directory: string, version: string, signal: AbortSignal) {
  const root = await realpath(directory)
  const files: LocalFile[] = []
  let size = 0
  let candidates = 0
  for await (const name of names(root, signal)) {
    signal.throwIfAborted()
    if (++candidates > MAX_FILES) throw tooLarge()
    const file = await localFile(root, name)
    if (!file) continue
    size += file.size
    if (size > MAX_BYTES) throw tooLarge()
    files.push(file)
  }
  const redacted: [string, string][] = [
    ['xiumi-backup.json', JSON.stringify({ app: 'xiumi-ai-studio', version, createdAt: new Date().toISOString(), note: '不含 AI 密钥与 .env（公众号 AppSecret）' })],
  ]
  const settings = await safeJson(root, SETTINGS)
  if (settings !== undefined) redacted.push([SETTINGS, JSON.stringify(publicSettings(settings))])
  const assets = await safeJson(root, INDEX)
  if (assets !== undefined) redacted.push([INDEX, JSON.stringify(publicAssetIndex(assets, new Set(files.map(file => file.name))))])
  assertLibraryRestoreCapacity([...files, ...redacted.map(([name, data]) => ({ name, size: Buffer.byteLength(data, 'utf8') }))])
  return { root, files, redacted }
}

type BackupPlan = Awaited<ReturnType<typeof planLibraryBackup>>

/** Upper bound for the pinned fflate 0.8.3 encoder, not a rejection quota.
 * Headers per member: 30 local + 16 descriptor + 46 central + two names;
 * end of central directory: 22. There are no extras or comments.
 * With inputs at most 64 KiB, Deflate keeps a 98,304-byte buffer and calls
 * dflt at most twice per push. Its output buffer is bounded by
 * 98,304 + 5 * (1 + ceil(98,304 / 7000)) = 98,384 bytes per call.
 * A final push may be empty; count it separately. */
export function libraryZipByteCeiling(plan: BackupPlan): number {
  let total = 22
  const add = (name: string, size: number) => {
    total += 92 + 2 * Buffer.byteLength(name, 'utf8')
    total += name.startsWith('assets/') && name !== INDEX ? size : 2 * 98_384 * (Math.ceil(size / CHUNK) + 1)
  }
  for (const { name, size } of plan.files) add(name, size)
  for (const [name, text] of plan.redacted) add(name, Buffer.byteLength(text, 'utf8'))
  return total
}

/** highWaterMark is a maximum, not a lower bound on file-read chunk size.
 * Coalesce short reads so non-final deflate inputs are exactly CHUNK. */
async function* fullDeflateChunks(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let pending: Buffer | undefined
  let used = 0
  for await (let bytes of source) {
    if (!used && bytes.length === CHUNK) { yield bytes; continue }
    while (bytes.length > 0) {
      pending ??= Buffer.allocUnsafe(CHUNK)
      const copied = bytes.copy(pending, used, 0, CHUNK - used)
      used += copied
      bytes = bytes.subarray(copied)
      if (used === CHUNK) {
        yield pending
        pending = undefined
        used = 0
      }
    }
  }
  if (pending && used) yield pending.subarray(0, used)
}

export async function* libraryZip(plan: BackupPlan, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let chunks: Uint8Array[] = []
  let zipError: Error | null = null
  const zip = new Zip((error, bytes) => {
    if (error) zipError = error
    else if (bytes.length > 0) chunks.push(bytes)
  })
  function* flush() {
    if (zipError) throw zipError
    signal.throwIfAborted()
    const emitted = chunks
    chunks = []
    yield* emitted
  }

  try {
    for (const [name, text] of plan.redacted) {
      const entry = new ZipDeflate(name, { level: 6 })
      zip.add(entry)
      const bytes = Buffer.from(text)
      for (let index = 0; index < bytes.length; index += CHUNK) {
        entry.push(bytes.subarray(index, index + CHUNK), index + CHUNK >= bytes.length)
        yield* flush()
      }
    }
    for (const file of plan.files) {
      signal.throwIfAborted()
      const handle = await openOwned(plan.root, file)
      try {
        // The response can close while the file is being opened and checked.
        // Do not construct a read stream with an already-aborted signal.
        signal.throwIfAborted()
        const stored = file.name.startsWith('assets/')
        const entry = stored ? new ZipPassThrough(file.name) : new ZipDeflate(file.name, { level: 6 })
        zip.add(entry)
        let actual = 0
        const read = handle.createReadStream({ autoClose: false, highWaterMark: CHUNK, signal })
        for await (const bytes of stored ? read : fullDeflateChunks(read)) {
          actual += bytes.length
          if (actual > file.size) throw stale()
          entry.push(bytes)
          yield* flush()
        }
        if (actual !== file.size) throw stale()
        entry.push(new Uint8Array(), true)
        yield* flush()
      } finally { await handle.close() }
    }
    zip.end()
    yield* flush()
  } finally {
    zip.terminate()
  }
}
