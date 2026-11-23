import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { nativeSvgFixture, nativeSvgProjectId } from '../fixtures/legacy-native-svg'

it('restores the actual upstream cross-SVG ZIP as typed project data only after explicit confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-cross-preview-'))
  const data = join(root, 'data'), scratch = join(root, 'scratch')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const url = 'http://127.0.0.1:' + address.port + '/api/data/restore'
    const bytes = new Uint8Array(await readFile(nativeSvgFixture))
    const upload = (query = '', headers: HeadersInit = {}, source = bytes) => {
      const body = new FormData()
      body.append('file', new Blob([source]), 'synthetic.zip')
      return fetch(url + query, { method: 'POST', body, headers })
    }
    const upstreamWithHistory = await JSZip.loadAsync(bytes)
    const upstreamPath = `projects/${nativeSvgProjectId}.json`
    const upstreamVersionId = 'upstream-v1', upstreamVersionKey = nativeSvgProjectId + '/' + upstreamVersionId
    const upstreamSnapshot = JSON.parse(await upstreamWithHistory.file(upstreamPath)!.async('string'))
    upstreamSnapshot.blocks[3].props.html = upstreamSnapshot.blocks[3].props.html.replace('to="0.3"', 'to="0.6"')
    upstreamWithHistory.file(`versions/${upstreamVersionKey}.json`, JSON.stringify({
      id: upstreamVersionId, projectId: nativeSvgProjectId, label: 'Earlier upstream revision', createdAt: 1750000000000, doc: upstreamSnapshot
    }))
    const withHistory = new Uint8Array(await upstreamWithHistory.generateAsync({ type: 'uint8array' }))
    const first = await upload('?crossSvgRestore=1', {}, withHistory)
    expect(first.status).toBe(200)
    const cookie = first.headers.get('set-cookie')!.split(';')[0]
    const { token, plan } = await first.json()
    expect(plan.projects).toEqual({ add: [nativeSvgProjectId], skip: [], unsupported: [] })
    expect(plan.versions.add).toEqual([upstreamVersionKey])
    const projectUrl = url.replace('/data/restore', '/projects/') + nativeSvgProjectId
    expect((await fetch(projectUrl)).status).toBe(404)
    const apply = (cookie: string, confirm = true) => fetch(url + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm })
    })
    expect((await apply('')).status).toBe(404)
    expect((await apply(cookie, false)).status).toBe(400)
    const restored = await apply(cookie)
    expect(await restored.json()).toMatchObject({ projects: { restored: [nativeSvgProjectId], unsupported: [] } })
    const historical = await fetch(projectUrl + '/versions/' + upstreamVersionId)
    expect(historical.ok).toBe(true)
    expect((await historical.json()).doc.blocks[2].props.scene.timing).toBe(6)
    const result = await fetch(projectUrl)
    expect(result.status).toBe(200)
    const project = await result.json()
    expect(project.blocks.map((block: { type: string }) => block.type)).toEqual(['html', 'html', 'linkedSvg', 'html'])
    const pair = project.blocks[2]
    expect(pair.props.scene).toMatchObject({ timing: 3, target: 4, sourceRect: { fill: 'navy' } })
    expect(pair.props.scene).not.toHaveProperty('context')
    expect(JSON.stringify(pair)).not.toMatch(/art_trigger|art_explicit_target|<svg/)
    expect(normalizeBlocks(project.blocks)).toEqual(project.blocks)
    const html = compileDoc(project).html
    expect(html).toContain('fill="navy"')
    expect(html).not.toMatch(/art_trigger|art_explicit_target|xiumi_proof_|\bhref="#/)
    const updated = { ...pair, props: { ...pair.props, scene: { ...pair.props.scene, timing: 7 } } }
    const edited = { ...project, blocks: normalizeBlocks(project.blocks.map((block: { id: string }) => block.id === pair.id ? updated : block)) }
    const save = await fetch(projectUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edited) })
    expect(save.ok).toBe(true)
    const reopened = await (await fetch(projectUrl)).json()
    expect(reopened.blocks[2].props.scene.timing).toBe(7)
    const snapshot = await fetch(projectUrl + '/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Edited linked scene snapshot', doc: reopened }) })
    expect(snapshot.ok).toBe(true)
    const editedVersionId = (await snapshot.json()).id

    const backupResponse = await fetch(url.replace('/restore', '/backup'))
    expect(backupResponse.ok).toBe(true)
    const backup = new Uint8Array(await backupResponse.arrayBuffer())
    // Test-owned isolated server only: verify a real re-export can restore the
    // edited scene and does not overwrite any project that already exists.
    const occupied = await upload('?crossSvgRestore=1', {}, backup)
    const occupiedCookie = occupied.headers.get('set-cookie')!.split(';')[0]
    const occupiedPlan = await occupied.json()
    expect(occupiedPlan.plan.projects).toEqual({ add: [], skip: [nativeSvgProjectId], unsupported: [], reasons: { [nativeSvgProjectId]: 'occupied' } })
    expect((await fetch(url + '/' + occupiedPlan.token + '/cancel', { method: 'POST', headers: { Cookie: occupiedCookie } })).status).toBe(204)
    expect((await fetch(projectUrl, { method: 'DELETE' })).ok).toBe(true)
    // The normal project-delete route does not remove historical files; the
    // re-import test empties only this test-owned temporary versions folder.
    await rm(join(data, 'versions', nativeSvgProjectId), { recursive: true, force: true })
    const reupload = await upload('?crossSvgRestore=1', {}, backup)
    const newCookie = reupload.headers.get('set-cookie')!.split(';')[0]
    const newPreview = await reupload.json()
    expect(newPreview.plan.projects.add).toEqual([nativeSvgProjectId])
    expect(newPreview.plan.versions.add).toEqual(expect.arrayContaining([upstreamVersionKey, nativeSvgProjectId + '/' + editedVersionId]))
    const reapply = await fetch(url + '/' + newPreview.token + '/apply', { method: 'POST',
      headers: { Cookie: newCookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
    expect(await reapply.json()).toMatchObject({ projects: { restored: [nativeSvgProjectId] } })
    expect((await (await fetch(projectUrl)).json()).blocks).toEqual(reopened.blocks)
    const [originalRestored, editedRestored] = await Promise.all(
      [upstreamVersionId, editedVersionId].map(id => fetch(projectUrl + '/versions/' + id).then(res => res.json())))
    expect(originalRestored.doc.blocks[2].props.scene.timing).toBe(6)
    expect(editedRestored.doc.blocks[2].props.scene.timing).toBe(7)

    const archive = await JSZip.loadAsync(bytes)
    const entry = `projects/${nativeSvgProjectId}.json`
    const altered = JSON.parse(await archive.file(entry)!.async('string'))
    altered.blocks[3].props.html = altered.blocks[3].props.html.replace('to="0.3"', 'to="0.33"')
    archive.file(entry, JSON.stringify(altered))
    const unsupported = await upload('?crossSvgRestore=1', {}, new Uint8Array(await archive.generateAsync({ type: 'uint8array' })))
    const unsupportedCookie = unsupported.headers.get('set-cookie')!.split(';')[0]
    const unsupportedPlan = await unsupported.json()
    expect(unsupportedPlan.plan.projects).toEqual({ add: [], skip: [], unsupported: [nativeSvgProjectId] })
    expect((await fetch(url + '/' + unsupportedPlan.token + '/cancel', { method: 'POST', headers: { Cookie: unsupportedCookie } })).status).toBe(204)


  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    vi.resetModules()
    await rm(root, { recursive: true, force: true })
  }
})
