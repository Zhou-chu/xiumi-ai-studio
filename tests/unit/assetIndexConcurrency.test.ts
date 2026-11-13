import { it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
it('keeps every imported/uploaded asset when saves overlap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-asset-index-'))
  vi.stubEnv('DATA_DIR', dir)
  vi.resetModules()
  try {
    const { saveAsset, listAssets } = await import('../../server/assets')
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const saved = await Promise.all(Array.from({ length: 8 }, (_, i) => saveAsset(png, `image-${i}`, `https://mmbiz.qpic.cn/${i}`)))
    expect((await listAssets()).map(a => a.id).sort()).toEqual(saved.map(a => a.id).sort())
  } finally { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) }
})
