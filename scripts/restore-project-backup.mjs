// Offline only: snapshots in, a new portable data root out. No disk paths from archive content.
import { Buffer } from 'node:buffer'
import console from 'node:console'
import process from 'node:process'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import sharp from 'sharp'

const idPattern = /^[\w-]{1,64}$/
const windowsReserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const validId = (id) => idPattern.test(id) && !windowsReserved.test(id)
const projectName = /^([\w-]{1,64})\.json$/
const imageName = /^([\w-]{1,64})\.(jpg|png)$/
const maxBytes = 128 * 1024 * 1024
const maxEntries = 2000
const docFields = ['revision', 'id', 'title', 'author', 'digest', 'themeId', 'themeOverrides', 'cover', 'blocks', 'createdAt', 'updatedAt']
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const within = (root, path) => {
  const rel = relative(root, path)
  return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function budgetReader() {
  let remaining = maxBytes
  let entries = 0
  return async (path, optional = false) => {
    const info = await lstat(path).catch((e) => {
      if (optional && e.code === 'ENOENT') return null
      throw e
    })
    if (!info) return null
    if (!info.isFile() || ++entries > maxEntries || info.size > remaining) throw new Error('备份输入不是普通文件，或超出容量与数量限制。')
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const actual = await file.stat()
      if (!actual.isFile() || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size) {
        throw new Error('备份输入在读取中发生变化。')
      }
      // Read no more than the already counted size, even if the file grows.
      const bytes = Buffer.alloc(actual.size)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) throw new Error('备份输入在读取中发生变化。')
        offset += bytesRead
      }
      if ((await file.stat()).size !== actual.size) throw new Error('备份输入在读取中发生变化。')
      remaining -= bytes.length
      return bytes
    } finally {
      await file.close()
    }
  }
}

async function directory(root, name, optional) {
  const path = join(root, name)
  const info = await lstat(path).catch((err) => { if (optional && err.code === 'ENOENT') return null; throw err })
  if (!info) return null
  if (!info.isDirectory()) throw new Error('项目和素材目录必须是真实目录。')
  return path
}

async function readSnapshot(root, read, optionalGroups = false) {
  const projects = await directory(root, 'projects', optionalGroups)
  const assets = await directory(root, 'assets', optionalGroups)
  const docs = new Map(), images = new Map()
  const entries = projects ? await readdir(projects) : []
  if (entries.length > maxEntries) throw new Error('项目数量超过恢复限制。')
  for (const name of entries) {
    const match = projectName.exec(name)
    if (!match) continue
    const id = match[1], key = id.toLowerCase()
    if (!validId(id)) throw new Error('项目标识不能用于便携版文件名。')
    const doc = JSON.parse(await read(join(projects, name)))
    if (!record(doc) || doc.id !== id || typeof doc.title !== 'string' || typeof doc.themeId !== 'string' ||
      !Array.isArray(doc.blocks) || !Number.isFinite(doc.createdAt) || !Number.isFinite(doc.updatedAt) || docs.has(key)) {
      throw new Error('项目记录不一致，无法恢复。')
    }
    docs.set(key, Object.fromEntries(docFields.filter((field) => Object.hasOwn(doc, field)).map((field) => [field, doc[field]])))
  }
  const bytes = assets ? await read(join(assets, '_index.json'), true) : null
  const index = bytes ? JSON.parse(bytes) : {}
  if (!record(index) || Object.keys(index).length > maxEntries) throw new Error('素材索引无效。')
  for (const [id, item] of Object.entries(index)) {
    if (!record(item) || !validId(id) || item.id !== id || typeof item.file !== 'string' || imageName.exec(item.file)?.[1] !== id ||
      typeof item.name !== 'string' || !Number.isFinite(item.createdAt) || images.has(id.toLowerCase())) {
      throw new Error('素材标识与索引不一致。')
    }
    const image = await read(join(assets, item.file))
    const info = await sharp(image, { limitInputPixels: 2400 ** 2 }).metadata()
    const ext = info.format === 'jpeg' ? 'jpg' : info.format === 'png' ? 'png' : ''
    if (!ext || !item.file.endsWith(`.${ext}`) || info.width !== item.width || info.height !== item.height ||
      info.width > 2400 || info.height > 2400 || image.length !== item.size) throw new Error('素材与索引中的尺寸或格式不符。')
    const { file, name, width, height, size, createdAt } = item
    images.set(id.toLowerCase(), { meta: { id, file, name, width, height, size, createdAt }, image })
  }
  return { docs, images }
}

function assertManagedReferences(docs, images) {
  const files = new Set([...images.values()].map(({ meta }) => meta.file))
  const ids = new Set([...images.values()].map(({ meta }) => meta.id))
  const todo = [...docs.values()]
  while (todo.length) {
    const item = todo.pop()
    if (typeof item === 'string') {
      for (const match of item.matchAll(/(?:^|[\s"'(])\/media\/([\w-]{1,64}\.(?:jpg|png))(?=$|[\s"'?)#<])/g)) {
        if (!files.has(match[1])) throw new Error('项目缺少素材，未生成恢复目录。')
      }
    } else if (Array.isArray(item)) {
      for (const value of item) todo.push(value)
    } else if (record(item)) {
      if (typeof item.assetId === 'string' && item.assetId && !ids.has(item.assetId)) throw new Error('项目缺少素材，未生成恢复目录。')
      for (const value of Object.values(item)) todo.push(value)
    }
  }
}

/** Restore to a fresh destination, leaving both input snapshots untouched. */
export async function stageProjectRestore({ base, incoming, output }) {
  const roots = await Promise.all([base, incoming].map(async (path) => {
    if (!(await lstat(path)).isDirectory()) throw new Error('输入必须是离线快照目录。')
    return realpath(path)
  }))
  const target = join(await realpath(dirname(resolve(output))), basename(resolve(output)))
  if (roots.some((root) => within(root, target) || within(target, root))) throw new Error('输出目录必须与输入目录隔离。')
  const knownTarget = await lstat(target).catch((err) => { if (err.code === 'ENOENT') return null; throw err })
  if (knownTarget) throw new Error('输出目录已存在，请选择新目录。')
  const read = budgetReader()
  const manifest = JSON.parse(await read(join(roots[1], 'xiumi-backup.json')))
  const legacy = record(manifest) && !Object.hasOwn(manifest, 'scope') && manifest.version === '0.2.0' &&
    typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt))
  if (manifest?.app !== 'xiumi-ai-studio' || (manifest.scope !== 'projects-and-assets' && !legacy)) {
    throw new Error('只支持已解包的项目和素材备份或 Xiumi v0.2.0 自有备份。')
  }

  const current = await readSnapshot(roots[0], read)
  const source = await readSnapshot(roots[1], read, true)
  assertManagedReferences(current.docs, current.images)
  assertManagedReferences(source.docs, source.images)
  let preserved = 0
  for (const [key, doc] of source.docs) {
    if (current.docs.has(key)) preserved++
    else current.docs.set(key, doc)
  }
  for (const [key, item] of source.images) {
    const old = current.images.get(key)
    if (!old) current.images.set(key, item)
    else if (old.meta.file !== item.meta.file || !old.image.equals(item.image)) throw new Error('素材冲突，未生成恢复目录。')
  }

  await mkdir(target)
  try {
    await mkdir(join(target, 'projects'))
    await mkdir(join(target, 'assets'))
    for (const doc of current.docs.values()) await writeFile(join(target, 'projects', `${doc.id}.json`), JSON.stringify(doc), { flag: 'wx' })
    const assetIndex = []
    for (const { meta, image } of current.images.values()) {
      await writeFile(join(target, 'assets', meta.file), image, { flag: 'wx' })
      assetIndex.push([meta.id, meta])
    }
    await writeFile(join(target, 'assets', '_index.json'), JSON.stringify(Object.fromEntries(assetIndex)), { flag: 'wx' })
  } catch (error) {
    throw new Error('输出生成失败。请勿使用未完成的新目录；两个输入未被修改。', { cause: error })
  }
  return { projects: current.docs.size, assets: current.images.size, preserved }
}

if (import.meta.main) {
  const [base, incoming, output, extra] = process.argv.slice(2)
  if (!base || !incoming || !output || extra) {
    console.error('用法：node restore-project-backup.mjs <当前数据的离线副本> <已解包的自有备份> <尚不存在的输出目录>')
    process.exitCode = 2
  } else {
    try {
      const { projects, assets, preserved } = await stageProjectRestore({ base, incoming, output })
      console.log(`生成独立数据目录：${projects} 个项目、${assets} 个素材；保留 ${preserved} 个同 ID 的当前项目。原目录未修改。`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
