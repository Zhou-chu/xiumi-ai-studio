import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { seedDirectoryDesign } from '../fixtures/legacy-directory-design'

it.each(['opt-in', 'stale-source', 'theme-conflict', 'target-replaced', 'escaped-standalone-component'] as const)(
  'migrates qualified design from an owner-local directory without a manuscript (%s)', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-design-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    let server: ReturnType<typeof createServer> | undefined
    try {
      const { fixtures, themePath, pngPath, templatePath, componentPath, png, theme } = await seedDirectoryDesign(source)
      if (mode === 'escaped-standalone-component') { await rm(join(source, templatePath)); fixtures.delete(templatePath) }
      expect(await readdir(source)).not.toContain('projects')
      vi.stubEnv('DATA_DIR', target)
      vi.resetModules()
      const { createApp } = await import('../../server/app')
      server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('missing test port')
      const origin = 'http://127.0.0.1:' + address.port
      const send = (body: unknown = {}, suffix = '', cookie = '', actualOrigin = origin) => fetch(origin + '/api/data/migrate' + suffix, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': actualOrigin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
        body: JSON.stringify(body),
      })
      const preview = async (options: unknown) => {
        const response = await send(options)
        expect(response.status).toBe(200)
        return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
      }
      const apply = ({ token, cookie }: { token: string; cookie: string }) => send({ confirm: true }, '/' + token + '/apply', cookie)
      const localTheme = Buffer.from(theme.toString('utf8').replace('#112233', '#FF4400'))
      if (mode === 'theme-conflict') await writeFile(join(target, themePath), localTheme)
      if (mode === 'opt-in') {
        expect((await send({ designRecords: true }, '', '', 'https://not-local.invalid')).status).toBe(403)
        expect((await send({ designRecords: true, path: source })).status).toBe(400)
        const normal = await preview({})
        expect(normal.plan).toMatchObject({ add: 0 })
        expect(normal.plan.design).toBeUndefined()
        expect((await apply(normal)).status).toBe(200)
        expect(await readdir(join(target, 'assets'))).toEqual([])
      }
      const pristine = await preview({ designRecords: true })
      const conflict = mode === 'theme-conflict'
      const hasTemplate = !conflict && mode !== 'escaped-standalone-component'
      expect(pristine.plan).toMatchObject({
        add: 0, design: {
          themes: { add: conflict ? 0 : 1, conflicts: conflict ? 1 : 0 },
          templates: { add: hasTemplate ? 1 : 0, unresolved: conflict ? 1 : 0 }, components: { add: 1 },
        },
      })
      expect(await readdir(join(target, 'assets'))).toEqual([])
      expect(await readdir(join(target, 'projects'))).toEqual([])
      if (mode === 'stale-source') {
        expect(localTheme).toHaveLength(theme.length)
        expect(localTheme).not.toEqual(theme)
        await writeFile(join(source, themePath), localTheme)
      } else if (mode === 'target-replaced') {
        await rename(join(target, 'components'), join(root, 'original-components'))
        await mkdir(join(target, 'components'))
      }
      expect((await send({ confirm: true, designRecords: true }, '/' + pristine.token + '/apply', pristine.cookie)).status).toBe(400)
      const applied = await apply(pristine)
      expect(await readdir(join(target, 'projects'))).toEqual([])
      if (mode === 'stale-source' || mode === 'target-replaced') {
        expect(applied.status).toBe(409)
        for (const d of ['assets', 'themes', 'templates', 'components']) expect(await readdir(join(target, d))).toEqual([])
      } else {
        expect(applied.status).toBe(200)
        expect(await applied.json()).toMatchObject({
          restored: 0, design: {
            themes: { restored: conflict ? 0 : 1, conflicts: conflict ? 1 : 0 },
            templates: { restored: hasTemplate ? 1 : 0, unresolved: conflict ? 1 : 0 }, components: { restored: 1 },
          },
        })
        expect((await readdir(join(target, 'assets'))).sort()).toEqual(['_index.json', 'fixture-template-only-teal.png'])
        expect(await readFile(join(target, pngPath))).toEqual(png)
        const component = JSON.parse(await readFile(join(target, componentPath), 'utf8'))
        expect(component.block.props.html).toMatch(/fixture-template-only-teal\.png\?gen=[a-f0-9]{64}/)
        expect(component.origin.redistributable).toBe(false)
        if (conflict) {
          expect(await readFile(join(target, themePath))).toEqual(localTheme)
          await expect(readFile(join(target, templatePath))).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(JSON.parse(await readFile(join(target, themePath), 'utf8')).colors.primary).toBe('#112233')
          if (hasTemplate) expect(JSON.parse(await readFile(join(target, templatePath), 'utf8')).themeId).toBe('custom-fixture')
          else await expect(readFile(join(target, templatePath))).rejects.toMatchObject({ code: 'ENOENT' })
        }
      }
      for (const [path, original] of fixtures) {
        expect(await readFile(join(source, path))).toEqual(mode === 'stale-source' && path === themePath ? localTheme : original)
      }
    } finally {
      if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
      }
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
)
