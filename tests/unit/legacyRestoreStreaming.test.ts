import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { archiveUploadStorage } from '../../server/archiveUploadStorage'
import { createUploadGate } from '../../server/uploadGate'
import { createBlock } from '../../src/core/blocks'

const MiB = 1024 * 1024

it('stages a same-version library export above 32 MiB without extracting unsupported media', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-streamed-restore-test-'))
  const data = join(temp, 'data')
  const scratch = join(temp, 'scratch')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = `http://127.0.0.1:${address.port}`
    const project = join(data, 'projects', 'example.json')
    await writeFile(project, JSON.stringify({
      id: 'example',
      title: 'Streamed archive fixture',
      blocks: [createBlock('heading')],
    }))
    // One small (in pixel dimensions), deliberately uncompressed PNG used
    // for seven distinct fixture files to cross the former upload threshold.
    const png = await sharp({
      create: { width: 1280, height: 1280, channels: 3, background: '#275e81' },
    }).png({ compressionLevel: 0 }).toBuffer()
    const assetNames = Array.from({ length: 7 }, (_, i) => `example-${i}.png`)
    await Promise.all(assetNames.map(name => writeFile(join(data, 'assets', name), png)))

    const response = await fetch(base + '/api/data/backup')
    expect(response.status).toBe(200)
    const archive = await response.blob()
    expect(archive.size).toBeGreaterThan(32 * MiB)
    expect(archive.size).toBeLessThan(40 * MiB)
    await rm(project)
    const form = new FormData()
    form.append('file', archive, 'own-library.zip')
    const preview = await fetch(base + '/api/data/restore', { method: 'POST', body: form })
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({
      plan: { projects: { add: ['example'], skip: [], unsupported: [] }, unsupported: assetNames.map(name => 'assets/' + name) },
    })
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(scratch)).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
}, 15_000)

it('enforces the disk spool limit and removes the owned partial file on disconnect', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-archive-spool-test-'))
  const app = express()
  const archive = archiveUploadStorage(scratch)
  const upload = multer({ storage: archive.storage, limits: { fileSize: 16 * 1024, files: 1, fields: 0, parts: 2 } })
  const gate = createUploadGate({ concurrency: 1 })
  app.post('/', gate(upload.single('file'), async (req, res) => {
    const attempt = archive.take(req)
    if (!attempt) throw new Error('missing upload')
    try {
      expect(req.file?.buffer).toBeUndefined()
      expect(req.file?.path).toBe(attempt.path)
      res.sendStatus(204)
    } finally {
      await attempt.dispose()
    }
  }))
  app.use(((error, _req, res, _next) => res.sendStatus(error.code === 'LIMIT_FILE_SIZE' ? 413 : (error instanceof multer.MulterError ? 400 : (error.status ?? 500)))) satisfies express.ErrorRequestHandler)
  const server = createServer(app).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = `http://127.0.0.1:${address.port}`
    const form = (size: number) => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array(size)]), 'owned-fixture.zip')
      return body
    }
    const over = await fetch(base + '/', { method: 'POST', body: form(20 * 1024) })
    expect(over.status).toBe(413)
    await over.text()
    expect(await readdir(scratch)).toEqual([])
    const additionalPart = form(1024)
    additionalPart.append('outside-policy', 'ignored')
    const deniedPart = await fetch(base + '/', { method: 'POST', body: additionalPart })
    expect(deniedPart.status).toBe(400)
    await deniedPart.text()
    expect(await readdir(scratch)).toEqual([])

    const boundary = 'test-stream-closed'
    const live = request(base + '/', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } })
    live.on('error', () => {})
    const closed = new Promise<void>(resolve => live.once('close', resolve))
    live.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="owned-fixture.zip"\r\nContent-Type: application/zip\r\n\r\n`)
    live.write(Buffer.alloc(1024))
    try {
      await vi.waitFor(async () => expect(await readdir(scratch)).toHaveLength(1))
    } finally {
      live.destroy()
    }
    await closed
    await vi.waitFor(async () => expect(await readdir(scratch)).toEqual([]))
    const retry = await fetch(base + '/', { method: 'POST', body: form(1024) })
    expect(retry.status).toBe(204)
    await vi.waitFor(async () => expect(await readdir(scratch)).toEqual([]))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(scratch, { recursive: true, force: true })
  }
})
