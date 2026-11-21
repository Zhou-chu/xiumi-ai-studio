import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const categories = ['projects', 'versions', 'templates', 'components', 'themes', 'assets'] as const
type Category = typeof categories[number]
type Count = Record<'available' | 'occupied' | 'blocked', number>
type MigrationPreview = {
  sourceLayout: 'checkout' | 'data'
  mode: 'metadata-only'
  categories: Record<Category, Count>
  metadata: { settingsDetected: boolean; wechatEnvDetected: boolean; assetIndexDetected: boolean }
}

class LocalMigrationError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const invalid = () => new LocalMigrationError('旧版数据预览需要已明确配置的本机文件夹，且不能与当前数据目录重叠', 400)
const inaccessible = () => new LocalMigrationError('无法安全读取配置的旧版数据目录，请检查其位置和权限', 400)
const tooLarge = () => new LocalMigrationError('目录条目超过迁移预览上限', 413)
const id = /^[\w-]{1,64}$/
const jsonFile = /^[\w-]{1,64}\.json$/
const revision = /^[\w-]{1,80}\.json$/
const asset = /^[\w-]{1,64}\.(?:jpg|png)$/
const comparable = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name

/** Only local absolute paths provided by the process owner; never accept a request path. */
async function ownerDirectory(name: string) {
  if (!isAbsolute(name) || /^[\\/]{2}/.test(name) || Array.from(name, char => char.charCodeAt(0)).some(code => code < 32 || code === 127)
    || process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(name)) throw invalid()
  const path = resolve(name)
  if (path === parse(path).root) throw invalid()
  if (!await directDirectory(path)) throw invalid()
  return path
}

async function inspect(path: string) {
  try { return await lstat(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function directDirectory(path: string) {
  const info = await inspect(path)
  return !!info?.isDirectory() && comparable(await realpath(path)) === comparable(path)
}

function contains(parent: string, child: string) {
  const rel = relative(comparable(parent), comparable(child))
  return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}

function disjoint(a: string, b: string) {
  if (contains(a, b) || contains(b, a)) throw invalid()
}

async function recognizable(path: string) {
  for (const category of categories) if (await directDirectory(join(path, category))) return true
  return (await inspect(join(path, 'settings.json')))?.isFile() ?? false
}

async function* leaves(root: string, pattern: RegExp, scan: () => void): AsyncGenerator<string> {
  if (!await directDirectory(root)) return
  for await (const entry of await opendir(root)) {
    scan()
    if (entry.isFile() && pattern.test(entry.name)) yield entry.name
  }
}

async function* files(source: string, category: Category, scan: () => void): AsyncGenerator<string[]> {
  const directory = join(source, category)
  if (category !== 'versions') {
    for await (const file of leaves(directory, category === 'assets' ? asset : jsonFile, scan)) yield [category, file]
    return
  }
  if (!await directDirectory(directory)) return
  for await (const project of await opendir(directory)) {
    scan()
    if (!project.isDirectory() || !id.test(project.name)) continue
    for await (const file of leaves(join(directory, project.name), revision, scan)) yield [category, project.name, file]
  }
}

async function occupancy(target: string, segments: string[]): Promise<keyof Count> {
  const folder = join(target, segments[0])
  const info = await inspect(folder)
  if (!info) return 'available'
  if (!info.isDirectory() || !await directDirectory(folder)) return 'blocked'
  if (segments.length === 3) {
    const nested = join(folder, segments[1])
    const parent = await inspect(nested)
    if (!parent) return 'available'
    if (!parent.isDirectory() || !await directDirectory(nested)) return 'blocked'
  }
  return await inspect(join(target, ...segments)) ? 'occupied' : 'available'
}

async function metadata(source: string, data: string): Promise<MigrationPreview['metadata']> {
  const assets = join(data, 'assets')
  return {
    settingsDetected: (await inspect(join(data, 'settings.json')))?.isFile() ?? false,
    wechatEnvDetected: (await inspect(join(source, '.env')))?.isFile() ?? false,
    assetIndexDetected: await directDirectory(assets) && ((await inspect(join(assets, '_index.json')))?.isFile() ?? false),
  }
}

type Options = { configuredSource: string | undefined; target: string; maxEntries?: number }

/**
 * A setup-time capability, not a path-based HTTP API. The host must bind
 * `configuredSource` to a local owner opt-in and apply its normal loopback/CSRF
 * policy before exposing preview. Do not pass request data here.
 *
 * The result is a read-only census of recognized regular files, not a content
 * validator, restore token or copy plan. Settings and .env contents are never
 * read, including outside the expressly configured checkout. Applying migration
 * must revalidate the source and use dependency-aware, add-only restore stores.
 */
export function createLegacyDirectoryPreview({ configuredSource, target, maxEntries = 50_000 }: Options) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 50_000) throw new RangeError('Invalid preview entry budget')
  return {
    async preview(signal?: AbortSignal): Promise<MigrationPreview> {
      if (!configuredSource) throw new LocalMigrationError('尚未在本机明确指定旧版数据位置', 403)
      signal?.throwIfAborted()
      try {
        const source = await ownerDirectory(configuredSource)
        const destination = await ownerDirectory(target)
        disjoint(source, destination)
        const child = join(source, 'data')
        const nested = await directDirectory(child) && await recognizable(child)
        const data = nested ? child : source
        if (!nested && !await recognizable(data)) throw invalid()
        let visited = 0
        const scan = () => {
          signal?.throwIfAborted()
          if (++visited > maxEntries) throw tooLarge()
        }
        const counts = {} as Record<Category, Count>
        for (const category of categories) {
          signal?.throwIfAborted()
          const count = counts[category] = { available: 0, occupied: 0, blocked: 0 }
          for await (const file of files(data, category, scan)) count[await occupancy(destination, file)]++
        }
        signal?.throwIfAborted()
        return { sourceLayout: nested ? 'checkout' : 'data', mode: 'metadata-only', categories: counts, metadata: await metadata(source, data) }
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof LocalMigrationError) throw error
        throw inaccessible()
      }
    },
  }
}
