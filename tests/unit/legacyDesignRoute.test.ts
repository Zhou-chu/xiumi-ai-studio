import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { registerTheme } from '../../src/core/themes'

const archive = new URL('../fixtures/legacy-backup/upstream-design.zip', import.meta.url)
const tid = 'custom-fixture'
const template = 'fixture-template'

it.each(['clean', 'conflict', 'template-collision', 'malformed'] as const)('restores bounded upstream style records via guarded preview and ordinary APIs (%s)', async mode => {
  const tmp = await mkdtemp(join(tmpdir(), 'xiumi-design-route-'))
  const data = join(tmp, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: tmp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
    const base = `http://127.0.0.1:${address.port}`
    const url = base + '/api/data/restore'
    const bytes = await readFile(archive)
    const broken = mode === 'malformed' ? await JSZip.loadAsync(bytes) : null
    if (broken) {
      const raw = JSON.parse(await broken.file(`templates/${template}.json`)!.async('string'))
      raw.blocks[0].props.unchecked = { unsafeExtra: 'not a recognized heading field' }
      broken.file(`templates/${template}.json`, JSON.stringify(raw))
    }
    const input = broken ? await broken.generateAsync({ type: 'nodebuffer' }) : bytes
    const upload = async (includeDesign: boolean, headers?: HeadersInit) => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array(input)]), 'upstream-design.zip')
      return fetch(url + (includeDesign ? '?design=1' : ''), { method: 'POST', body, headers })
    }
    const denied = await upload(true, { Origin: 'https://example.invalid' })
    expect(denied.status).toBe(403)
    await denied.text()
    const optOut = await upload(false)
    expect(optOut.status).toBe(200)
    const firstCookie = optOut.headers.get('set-cookie')!.split(';', 1)[0]
    const firstPlan = (await optOut.json()).plan
    expect(firstPlan.design).toBeUndefined()
    expect(firstPlan.unsupported).toEqual(expect.arrayContaining([`themes/${tid}.json`, `templates/${template}.json`]))
    const preview = await upload(true, { Cookie: firstCookie })
    expect(preview.status).toBe(200)
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await preview.json()
    expect(plan.projects.add).toEqual([])
    expect(plan.design).toMatchObject({ themes: { add: [tid] }, templates: { add: broken ? [] : [template] } })
    expect(plan.unsupported).toEqual(broken ? [`templates/${template}.json`] : [])
    await expect(readdir(join(data, 'templates'))).resolves.toEqual([])
    await expect(readdir(join(data, 'themes'))).resolves.toEqual([])
    const send = (location: string, json: unknown, owner?: string) => fetch(location, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(owner && { Cookie: owner }) }, body: JSON.stringify(json),
    })
    const apply = url + '/' + token + '/apply'
    expect((await send(apply, { confirm: true }, firstCookie)).status).toBe(404)
    expect((await send(apply, { confirm: false }, cookie)).status).toBe(400)
    const local = { id: tid, name: 'Kept local' }
    if (mode === 'conflict') expect((await send(base + '/api/themes', local)).status).toBe(200)
    const templatePath = join(data, 'templates', template + '.json')
    if (mode === 'template-collision') await writeFile(templatePath, 'local interrupted template bytes')
    const response = await send(apply, { confirm: true }, cookie)
    expect(response.status).toBe(200)
    const result = (await response.json()).design
    const themes = await (await fetch(base + '/api/themes')).json()
    const templates = await (await fetch(base + '/api/templates')).json()
    if (mode === 'clean') {
      expect(result).toMatchObject({ themes: { restored: [tid] }, templates: { restored: [template] } })
      const saved = templates.find((value: { id: string }) => value.id === template)
      expect(saved).toMatchObject({ themeId: tid, roles: { intro: 'h1' } })
      expect(themes).toContainEqual(expect.objectContaining({ id: tid, colors: expect.objectContaining({ primary: '#112233' }) }))
      registerTheme(themes[0])
      const html = compileDoc({ ...saved, title: saved.name, author: '', digest: '', createdAt: 1, updatedAt: 1 }).html
      expect(html).toContain('Archived template heading')
      expect(html).toContain('Archived quote')
      expect(html).toContain('#112233')
      const second = await upload(true)
      expect((await second.json()).plan.design).toMatchObject({ themes: { alreadyPresent: [tid] }, templates: { alreadyPresent: [template] } })
    } else if (mode === 'conflict') {
      expect(result).toMatchObject({ themes: { conflicts: [tid] }, templates: { unresolved: [template] } })
      expect(themes).toEqual([local])
      expect(templates).toEqual([])
    } else {
      const conflicts = mode === 'template-collision' ? [template] : []
      expect(result).toMatchObject({ themes: { restored: [tid] }, templates: { restored: [], conflicts } })
      expect(themes).toContainEqual(expect.objectContaining({ id: tid }))
      if (conflicts.length) await expect(readFile(templatePath, 'utf8')).resolves.toBe('local interrupted template bytes')
      expect(templates).toEqual([])
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(tmp, { recursive: true, force: true })
  }
})
