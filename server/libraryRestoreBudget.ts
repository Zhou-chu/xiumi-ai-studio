// Resource ceilings of the browser's whole-library restore route, not the
// separate single-project reader.
export const LIBRARY_RESTORE_ZIP_BUDGET = {
  maxEntries: 5_000,
  maxNameBytes: 1024 * 1024,
  entryBytes: 4 * 1024 * 1024,
  totalProjectBytes: 32 * 1024 * 1024,
  totalAssetBytes: 32 * 1024 * 1024,
}

export function restoredZipNameBytes(name: string, lowercase: string, retainedZipMetadataBytes = 0): number {
  return Buffer.byteLength(lowercase, 'utf8') +
    (name === lowercase ? 0 : Buffer.byteLength(name, 'utf8')) + retainedZipMetadataBytes
}

const MiB = 1024 * 1024

type PlannedMember = { name: string; size: number }

function restoreCapacityError(detail: string) {
  return Object.assign(new Error('无法下载整库备份：' + detail + '。当前版本无法恢复这样的备份；请先为需要保留的文稿单独备份，再清理不需要的数据后重试。'), { status: 413 })
}

/** Preflight our own archive's hard inner limits before writing ZIP headers.
 * Optional categories retain the restore route's existing skip/review rules. */
export function assertLibraryRestoreCapacity(members: readonly PlannedMember[]) {
  const limit = LIBRARY_RESTORE_ZIP_BUDGET
  if (members.length > limit.maxEntries) throw restoreCapacityError(`备份条目超过 ${limit.maxEntries.toLocaleString('en-US')} 个`)
  let names = 0
  let projects = 0
  for (const { name, size } of members) {
    // The writer emits no ZIP comments or extras. When images are selected
    // the restore route also retains the raw member names of asset entries.
    names += restoredZipNameBytes(name, name.toLowerCase(), name.startsWith('assets/') ? Buffer.byteLength(name, 'utf8') : 0)
    if (names > limit.maxNameBytes) throw restoreCapacityError(`备份文件名总量超过 ${limit.maxNameBytes / MiB} MiB`)
    if (!name.startsWith('projects/')) continue
    if (size > limit.entryBytes) throw restoreCapacityError(`单个文稿超过 ${limit.entryBytes / MiB} MiB`)
    projects += size
    if (projects > limit.totalProjectBytes) throw restoreCapacityError(`文稿总大小超过 ${limit.totalProjectBytes / MiB} MiB`)
  }
}
