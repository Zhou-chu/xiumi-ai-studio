import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MAX_RESTORE_ARCHIVE_MIB, MAX_RESTORE_ARCHIVE_UPLOAD } from '../src/core/backupLimits'
import { libraryZip, libraryZipByteCeiling } from './fullLibraryBackup'

type BackupPlan = Parameters<typeof libraryZip>[0]
export type BackupZipOptions = { maxBytes?: number; tempRoot?: string }
type Download = { body: () => Readable; size?: number; dispose?: () => Promise<void> }

const tooLarge = () => Object.assign(new Error(
  `无法下载整库备份：压缩后的 ZIP 达到或超过当前恢复上限（${MAX_RESTORE_ARCHIVE_MIB} MiB）。请先为需要保留的文稿单独备份，再清理不需要的数据后重试。`,
), { status: 413 })

function knownEncoder(): boolean {
  // The portable bundle leaves packages external. If an installation uses a
  // different fflate implementation or has no manifest, don't assume a bound.
  try { return createRequire(import.meta.url)('fflate/package.json').version === '0.8.3' }
  catch { return false }
}

async function* withinDownloadLimit(source: AsyncIterable<Uint8Array>, max: number, count: (n: number) => void) {
  let length = 0
  for await (const chunk of source) {
    // The normal file picker requires a strict inequality, including final
    // directory/EOCD bytes. Reject before writing this chunk.
    if (chunk.byteLength >= max - length) throw tooLarge()
    length += chunk.byteLength
    count(length)
    yield chunk
  }
}

async function removeSpool(directory: string) {
  try { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) }
  catch { console.warn('Could not remove the library backup spool.') }
}

/** Keep the ordinary streaming path when we can prove a safe upper bound.
 * Otherwise encode once, with backpressure and a strict bound on disk. */
export async function prepareLibraryDownload(plan: BackupPlan, signal: AbortSignal, options: BackupZipOptions = {}): Promise<Download> {
  const max = Math.min(options.maxBytes ?? MAX_RESTORE_ARCHIVE_UPLOAD, MAX_RESTORE_ARCHIVE_UPLOAD)
  if (!Number.isSafeInteger(max) || max <= 0) throw new RangeError('Invalid backup ZIP limit')
  signal.throwIfAborted()
  if (knownEncoder() && libraryZipByteCeiling(plan) < max) {
    return { body: () => Readable.from(libraryZip(plan, signal), { objectMode: false }) }
  }
  let directory: string | undefined
  try {
    directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'xiumi-backup-archive-'))
    signal.throwIfAborted()
    const path = join(directory, 'archive')
    let size = 0
    const source = Readable.from(withinDownloadLimit(libraryZip(plan, signal), max, n => { size = n }), { objectMode: false })
    await pipeline(source, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal })
    signal.throwIfAborted()
    const ownedDirectory = directory
    return { size, body: () => createReadStream(path, { signal }), dispose: () => removeSpool(ownedDirectory) }
  } catch (error) {
    if (directory) await removeSpool(directory)
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
      throw Object.assign(new Error('整库备份临时目录空间不足'), { status: 507 })
    }
    throw error
  }
}
