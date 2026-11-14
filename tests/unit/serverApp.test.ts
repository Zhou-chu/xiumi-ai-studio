import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ root: '', docs: new Map<string, Map<string, any>>() }))
const boundary = vi.hoisted(() => ({
  assets: { listAssets: vi.fn(), saveAsset: vi.fn(), cropAsset: vi.fn(), deleteAsset: vi.fn(), variantPath: vi.fn() },
  components: { listComponents: vi.fn(), saveComponent: vi.fn(), updateComponent: vi.fn(), removeComponent: vi.fn() },
  ai: { aiStatus: vi.fn(), chatJson: vi.fn(), discoverModels: vi.fn(), testConnection: vi.fn() },
  settings: { publicAiSettings: vi.fn(), saveAiSettings: vi.fn(), resolveDraftProfile: vi.fn() },
  wechat: { wechatStatus: vi.fn(), validateDraft: vi.fn(), uploadContentImage: vi.fn(), uploadCover: vi.fn(), addDraft: vi.fn() },
  safeFetch: vi.fn(), importFile: vi.fn(), importArticleImages: vi.fn(), probeEfforts: vi.fn(),
  editPrompt: vi.fn(), scopeEditResult: vi.fn(), suggestionPrompt: vi.fn(), readSuggestion: vi.fn(),
}))
vi.mock('../../server/assets', () => boundary.assets)
vi.mock('../../server/components', () => boundary.components)
vi.mock('../../server/ai', () => ({ ...boundary.ai, COPY_SYSTEM: 'copy', DESIGN_SYSTEM: 'design', EDIT_SYSTEM: 'edit', ENRICH_SYSTEM: 'enrich', OUTLINE_SYSTEM: 'outline', PLACE_SYSTEM: 'place' }))
vi.mock('../../server/settings', () => boundary.settings)
vi.mock('../../server/wechat', () => boundary.wechat)
vi.mock('../../server/net', () => ({ safeFetch: boundary.safeFetch, WECHAT_IMAGE_HOST: /^mmbiz\.qpic\.cn$/, IMAGE_HOST: /^(?:mmbiz\.qpic\.cn|img\.xiumi\.us)$/ }))
vi.mock('../../server/importer', () => ({ importFile: boundary.importFile }))
vi.mock('../../server/articleImages', () => ({ importArticleImages: boundary.importArticleImages }))
vi.mock('../../server/aiModels', () => ({ probeEfforts: boundary.probeEfforts }))
vi.mock('../../server/aiEdit', () => ({ editPrompt: boundary.editPrompt, scopeEditResult: boundary.scopeEditResult }))
vi.mock('../../server/aiSuggestion', () => ({ suggestionPrompt: boundary.suggestionPrompt, readSuggestion: boundary.readSuggestion, SUGGESTION_SYSTEM: 'suggest' }))
vi.mock('../../src/core/roles', () => ({ isRoleId: (value: unknown) => value === 'heading' }))
vi.mock('../../server/store', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  state.root = mkdtempSync(join(tmpdir(), 'xiumi-app-unit-'))
  const collection = (dir: string) => {
    const getMap = () => { if (!state.docs.has(dir)) state.docs.set(dir, new Map()); return state.docs.get(dir)! }
    return {
      list: async () => [...getMap().values()],
      get: async (id: string) => getMap().get(id),
      put: async (doc: any) => { const saved = { ...doc, revision: (doc.revision ?? 0) + 1 }; getMap().set(doc.id, saved); return saved },
      remove: async (id: string) => { getMap().delete(id) },
    }
  }
  return { ROOT: state.root, DIRS: { projects: 'projects', templates: 'templates', themes: 'themes', versions: 'versions' }, collection,
    safeId: (id: string) => { if (!/^[\w-]{1,64}$/.test(id)) throw Object.assign(new Error('invalid id'), { status: 400 }); return id } }
})
vi.mock('../../server/projectStore', async () => ({ projectCollection: (await import('../../server/store')).collection }))
import { createApp } from '../../server/app'

let server: Server
let url: string
const payload = { ok: true }
async function request(path: string, method = 'GET', body?: unknown) {
  return fetch(url + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
}
async function json(path: string, method = 'GET', body?: unknown) { const r = await request(path, method, body); return { status: r.status, body: await r.json() } }
async function upload(path: string, name: string, field = 'files') {
  const data = new FormData(); data.append(field, new Blob(['file contents']), name)
  return fetch(url + path, { method: 'POST', body: data })
}
beforeAll(async () => {
  server = createServer(createApp()).listen(0, '127.0.0.1')
  await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw Error('no port')
  url = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(state.root, { recursive: true, force: true }) })
beforeEach(() => {
  vi.resetAllMocks(); state.docs.clear()
  boundary.assets.listAssets.mockResolvedValue([]); boundary.assets.saveAsset.mockImplementation(async (_buf, name) => ({ id: name, name }))
  boundary.assets.cropAsset.mockResolvedValue(payload); boundary.assets.deleteAsset.mockResolvedValue(undefined)
  boundary.components.listComponents.mockResolvedValue([]); boundary.components.saveComponent.mockResolvedValue(payload); boundary.components.updateComponent.mockResolvedValue(payload)
  boundary.ai.aiStatus.mockResolvedValue({ enabled: true }); boundary.ai.chatJson.mockResolvedValue(payload)
  boundary.ai.discoverModels.mockResolvedValue(['model']); boundary.ai.testConnection.mockResolvedValue({ ok: true })
  boundary.settings.publicAiSettings.mockResolvedValue({ profiles: [] }); boundary.settings.saveAiSettings.mockResolvedValue(payload)
  boundary.settings.resolveDraftProfile.mockResolvedValue({ baseUrl: 'https://example.test', model: 'model' })
  boundary.probeEfforts.mockResolvedValue(['low']); boundary.importFile.mockResolvedValue({ text: 'text' })
  boundary.importArticleImages.mockResolvedValue([]); boundary.editPrompt.mockReturnValue('edit prompt'); boundary.scopeEditResult.mockReturnValue(payload)
  boundary.suggestionPrompt.mockReturnValue('suggest prompt'); boundary.readSuggestion.mockReturnValue(payload)
  boundary.wechat.wechatStatus.mockReturnValue({ configured: true }); boundary.wechat.validateDraft.mockReturnValue([])
  boundary.wechat.uploadContentImage.mockResolvedValue('https://mmbiz.qpic.cn/image'); boundary.wechat.uploadCover.mockResolvedValue({ media_id: 'cover' }); boundary.wechat.addDraft.mockResolvedValue({ media_id: 'draft' })
})

describe('application HTTP routes with isolated dependencies', () => {
  it('handles media reads, assets upload/crop/delete and missing upload file', async () => {
    const file = join(state.root, 'image.png'); await writeFile(file, 'image')
    boundary.assets.variantPath.mockResolvedValue(file)
    const response = await request('/media/image.png?fit=1:1&w=240')
    expect(await response.text()).toBe('image'); expect(response.headers.get('cache-control')).toContain('immutable')
    expect(boundary.assets.variantPath).toHaveBeenCalledWith('image.png', '1:1', 240)
    await request('/media/image.png'); expect(boundary.assets.variantPath).toHaveBeenLastCalledWith('image.png', undefined, undefined)
    expect((await json('/api/assets')).body).toEqual([])
    expect(await (await upload('/api/assets', 'photo.png')).json()).toEqual([{ id: 'photo.png', name: 'photo.png' }])
    expect((await json('/api/assets', 'POST')).body).toEqual([])
    expect((await json('/api/assets/a/crop', 'POST', { x: 1 })).body).toEqual(payload)
    expect(boundary.assets.cropAsset).toHaveBeenCalledWith('a', { x: 1 })
    expect((await json('/api/assets/a', 'DELETE')).body).toEqual({ ok: true }); expect(boundary.assets.deleteAsset).toHaveBeenCalledWith('a')
    expect((await json('/api/import', 'POST')).status).toBe(400)
    expect(await (await upload('/api/import', 'source.txt', 'file')).json()).toEqual({ text: 'text' })
  })

  it('loads samples only when all fixture files exist', async () => {
    expect((await json('/api/samples/load', 'POST')).status).toBe(404)
    const dir = join(state.root, 'samples'); await mkdir(dir)
    await writeFile(join(dir, 'activity.txt'), 'sample activity')
    for (let i=1;i<=10;i++) await writeFile(join(dir, `photo-${String(i).padStart(2,'0')}.jpg`), `image-${i}`)
    const result = await json('/api/samples/load', 'POST')
    expect(result.status).toBe(200); expect(result.body.text).toBe('sample activity'); expect(result.body.assets).toHaveLength(10)
  })

  it('sorts project summaries, validates IDs and persists revision response', async () => {
    state.docs.set('projects', new Map([['a', { id: 'a', title: 'A', updatedAt: 1, blocks: [] }], ['b', { id: 'b', title: 'B', updatedAt: 2 }]]))
    expect((await json('/api/projects')).body.map((p: any) => [p.id,p.blockCount])).toEqual([['b',0],['a',0]])
    expect((await json('/api/projects/a')).body.title).toBe('A'); expect((await json('/api/projects/missing')).status).toBe(404)
    const saved = await json('/api/projects/a', 'PUT', { id: 'wrong', title: 'updated', revision: 4 })
    expect(saved.body).toEqual({ ok: true, updatedAt: expect.any(Number), revision: 5 })
    expect((await json('/api/projects/a')).body.id).toBe('a')
    expect((await json('/api/projects/bad.id', 'PUT', {})).status).toBe(400)
    expect((await json('/api/projects/a', 'DELETE')).body).toEqual({ ok:true }); expect((await json('/api/projects/a')).status).toBe(404)
  })

  it('creates/gets/lists versions and retains newest fifty', async () => {
    const key = join('versions','a'); const versions = new Map<string, any>()
    for (let i=0;i<51;i++) versions.set(`v${i}`, {id:`v${i}`,createdAt:i,doc: i%2 ? {} : {blocks:[{}]}})
    state.docs.set(key, versions)
    const result = await json('/api/projects/a/versions', 'POST', { label: 'snapshot', doc: { title:'v',blocks:[{},{}] } })
    expect(result.body.label).toBe('snapshot'); expect(versions.size).toBe(50); expect(versions.has('v0')).toBe(false)
    expect((await json('/api/projects/a/versions')).body[0].blockCount).toBe(2)
    expect((await json(`/api/projects/a/versions/${result.body.id}`)).body.doc.title).toBe('v')
    expect((await json('/api/projects/a/versions/nope')).status).toBe(404)
    expect((await json('/api/projects/a/versions', 'POST', { doc:{} })).status).toBe(200)
  })

  it('handles templates including guarded roles and optional metadata', async () => {
    const first = await json('/api/templates', 'POST', { name:'Custom', blocks:[{id:'b'}],themeId:'dark',themeOverrides:{a:1} })
    const id = first.body.id; expect(first.body).toMatchObject({themeId:'dark',themeOverrides:{a:1}})
    expect((await json('/api/templates', 'POST', {})).status).toBe(200)
    expect((await json('/api/templates')).body).toHaveLength(2)
    expect((await json('/api/templates/missing','PUT',{})).status).toBe(404)
    const updated = await json(`/api/templates/${id}`,'PUT',{name:'  New  ',roles:{b:'heading',bad:'heading',ignored:'no'}})
    expect(updated.body.name).toBe('New'); expect(updated.body.roles).toEqual({b:'heading'})
    expect((await json(`/api/templates/${id}`,'PUT',{name:'   '})).body.name).toBe('New')
    expect((await json(`/api/templates/${id}`,'DELETE')).body).toEqual({ok:true})
  })

  it('delegates component lifecycle and manages themes', async () => {
    expect((await json('/api/components')).body).toEqual([])
    for (const method of ['POST','PUT']) expect((await json('/api/components'+(method==='PUT'?'/c':''),method,{name:'c'})).body).toEqual(payload)
    expect((await json('/api/components/c','DELETE')).body).toEqual({ok:true})
    expect(boundary.components.removeComponent).toHaveBeenCalledWith('c')
    expect((await json('/api/themes','POST',{id:'theme',name:'My theme'})).body).toEqual({ok:true})
    expect((await json('/api/themes')).body[0].name).toBe('My theme')
    await json('/api/themes/theme','DELETE'); expect((await json('/api/themes')).body).toEqual([])
  })

  it('delegates public AI settings and distinct connection outcomes without exposing profiles', async () => {
    expect((await json('/api/ai/status?profileId=one')).body.enabled).toBe(true)
    expect(boundary.ai.aiStatus).toHaveBeenCalledWith('one')
    expect((await json('/api/settings/ai')).body).toEqual({profiles:[]})
    expect((await json('/api/settings/ai','PUT',{profiles:[]})).body).toEqual(payload)
    expect((await json('/api/settings/ai/models','POST',{})).body).toEqual(['model'])
    expect((await json('/api/settings/ai/test','POST',{})).body).toMatchObject({ok:true,ms:expect.any(Number)})
    boundary.ai.testConnection.mockResolvedValue(undefined)
    expect((await json('/api/settings/ai/test','POST')).body.ok).toBe(false)
    expect((await json('/api/settings/ai/probe-effort','POST',{})).body).toEqual(['low'])
    boundary.settings.resolveDraftProfile.mockResolvedValue({model:'x'}); expect((await json('/api/settings/ai/probe-effort','POST',{})).status).toBe(400)
    boundary.settings.resolveDraftProfile.mockResolvedValue({baseUrl:'x'}); expect((await json('/api/settings/ai/probe-effort','POST',{})).status).toBe(400)
  })

  it('formats outline/design/copy prompts and passes only supported profile IDs', async () => {
    await json('/api/ai/outline','POST',{text:'text',imageNames:['a','b'],imageNotes:[' note ',''],profileId:'one'})
    expect(boundary.ai.chatJson).toHaveBeenLastCalledWith('outline',expect.stringContaining('note'),{defaultMaxTokens:8000,profileId:'one'})
    await json('/api/ai/outline','POST',{})
    await json('/api/ai/design','POST',{brief:{x:1},hint:'minimal',profileId:123})
    expect(boundary.ai.chatJson).toHaveBeenLastCalledWith('design',expect.stringContaining('minimal'),{defaultMaxTokens:6000,temperature:0.8,profileId:undefined})
    await json('/api/ai/design','POST',{})
    await json('/api/ai/copywrite','POST',{brief:'event',style:'formal',length:300,levels:3,extra:'keep',previous:'old',revise:'new'})
    expect(boundary.ai.chatJson).toHaveBeenLastCalledWith('copy',expect.stringContaining('new'),expect.objectContaining({defaultMaxTokens:6000}))
    await json('/api/ai/copywrite','POST',{})
    await json('/api/ai/copywrite','POST',{previous:'old'})
  })

  it('handles photo enrichment and placement with safe prompt bounds', async () => {
    expect((await json('/api/ai/enrich-copy','POST',{})).status).toBe(400)
    await json('/api/ai/enrich-copy','POST',{text:'story',photos:[{no:1,note:'portrait',group:2,after:'section'},{}],keep:['phrase']})
    expect(boundary.ai.chatJson).toHaveBeenLastCalledWith('enrich',expect.stringContaining('portrait'),expect.objectContaining({temperature:0.5}))
    await json('/api/ai/enrich-copy','POST',{photos:[{note:'photo'}]})
    await json('/api/ai/place-photos','POST',{})
    await json('/api/ai/place-photos','POST',{items:[1],units:[2],layouts:{x:1}})
    expect(boundary.ai.chatJson).toHaveBeenLastCalledWith('place',expect.stringContaining('"x":1'),expect.objectContaining({defaultMaxTokens:3000}))
  })

  it('validates suggestion/edit target and preserves scoped processing', async () => {
    expect((await json('/api/ai/suggest-instruction','POST',{selectedId:42})).status).toBe(400)
    expect((await json('/api/ai/suggest-instruction','POST',{selectedId:''})).status).toBe(400)
    expect((await json('/api/ai/suggest-instruction','POST',{context:{x:1},selectedId:'b'})).body).toEqual(payload)
    expect(boundary.suggestionPrompt).toHaveBeenCalledWith({x:1},'b')
    await json('/api/ai/suggest-instruction','POST',{})
    expect((await json('/api/ai/edit','POST',{selectedId:0})).status).toBe(400)
    expect((await json('/api/ai/edit','POST',{selectedId:''})).status).toBe(400)
    await json('/api/ai/edit','POST',{context:{focus:{id:'b'}},instruction:'edit'})
    expect(boundary.scopeEditResult).toHaveBeenLastCalledWith(payload,'b')
    await json('/api/ai/edit','POST',{instruction:'all'})
    expect(boundary.scopeEditResult).toHaveBeenLastCalledWith(payload,undefined)
  })

  it('fetches article/reference content and surfaces upstream failure', async () => {
    boundary.safeFetch.mockResolvedValue(new Response('<p>article</p>'))
    expect((await json('/api/article/fetch','POST',{url:'https://example.test'})).body).toEqual({html:'<p>article</p>'})
    boundary.safeFetch.mockResolvedValue(new Response('ref'))
    expect((await json('/api/reference/fetch','POST',{url:'https://example.test/ref'})).body).toEqual({html:'ref'})
    boundary.safeFetch.mockResolvedValue(new Response('',{status:403}))
    const log = vi.spyOn(console,'error').mockImplementation(()=>{})
    expect((await json('/api/article/fetch','POST',{url:'https://example.test'})).status).toBe(502)
    log.mockRestore()
  })

  it('proxies only permitted WeChat image hosts and fails closed', async () => {
    boundary.safeFetch.mockResolvedValue(new Response('png',{headers:{'content-type':'image/png'}}))
    const response=await request('/api/wx-image?u=https://mmbiz.qpic.cn/x')
    expect(response.headers.get('content-type')).toContain('image/png'); expect(await response.text()).toBe('png')
    const options=boundary.safeFetch.mock.calls[0][1]; expect(options.allowHost('mmbiz.qpic.cn')).toBe(true); expect(options.allowHost('evil.test')).toBe(false)
    boundary.safeFetch.mockResolvedValue(new Response(new Uint8Array([1])))
    expect((await request('/api/wx-image')).headers.get('content-type')).toContain('image/jpeg')
    boundary.safeFetch.mockRejectedValue(Error('blocked')); expect((await request('/api/wx-image')).status).toBe(502)
    boundary.safeFetch.mockResolvedValue(new Response('',{status:404})); expect((await request('/api/wx-image')).status).toBe(502)
  })

  it('imports deduplicated image URLs, skips failed/oversized images and supports empty batches', async () => {
    expect((await json('/api/assets/import-article','POST',{urls:['a']})).body).toEqual([])
    expect(boundary.importArticleImages).toHaveBeenCalledWith(['a'])
    boundary.safeFetch.mockImplementation(async (u:string,options:any) => {
      expect(options.allowHost('img.xiumi.us')).toBe(true); expect(options.allowHost('evil.test')).toBe(false)
      if(u.endsWith('throw')) throw Error('network')
      if(u.endsWith('bad')) return new Response('',{status:403})
      if(u.endsWith('large')) return {ok:true,arrayBuffer:async()=>new Uint8Array(30*1024*1024+1).buffer}
      return new Response('image')
    })
    const good='https://img.xiumi.us/path/photo'; const result=await json('/api/assets/fetch','POST',{urls:[good,good,'https://img.xiumi.us/throw','https://img.xiumi.us/bad','https://img.xiumi.us/large','https://img.xiumi.us/']})
    expect(Object.keys(result.body)).toEqual(expect.arrayContaining([good,'https://img.xiumi.us/']))
    expect(Object.keys(result.body)).toHaveLength(2);expect(boundary.safeFetch).toHaveBeenCalledTimes(5)
    expect((await json('/api/assets/fetch','POST',{})).body).toEqual({})
  })

  it('requires explicit WeChat draft confirmation and delegates validated uploads', async () => {
    expect((await json('/api/wechat/status')).body).toEqual({configured:true})
    boundary.assets.variantPath.mockResolvedValue('/tmp/test.png')
    const uploaded=await json('/api/wechat/upload-images','POST',{urls:['https://evil.test/x','/media/a.png?fit=2:1&w=400','/media/b.jpg']})
    expect(Object.keys(uploaded.body)).toHaveLength(2)
    expect(boundary.assets.variantPath).toHaveBeenCalledWith('a.png','2:1',400)
    expect(boundary.assets.variantPath).toHaveBeenCalledWith('b.jpg',undefined,undefined)
    expect((await json('/api/wechat/upload-images','POST',{})).body).toEqual({})
    expect((await json('/api/wechat/draft','POST',{})).status).toBe(400)
    expect((await json('/api/wechat/draft','POST',{confirm:true})).status).toBe(400)
    boundary.wechat.validateDraft.mockReturnValue(['invalid'])
    expect((await json('/api/wechat/draft','POST',{confirm:true,cover:'/media/a.png'})).status).toBe(400)
    boundary.wechat.validateDraft.mockReturnValue([])
    expect((await json('/api/wechat/draft','POST',{confirm:true,cover:'/media/a.png',title:'Title',html:'<p>x</p>'})).body).toEqual({media_id:'draft'})
    expect(boundary.wechat.addDraft).toHaveBeenCalledWith(expect.objectContaining({title:'Title',thumb_media_id:'cover'}))
  })

  it('maps structured and unstructured delegate errors without stack leakage', async () => {
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    boundary.assets.listAssets.mockRejectedValue(Object.assign(Error('conflict'),{status:409}))
    expect(await json('/api/assets')).toEqual({status:409,body:{error:'conflict'}})
    boundary.assets.listAssets.mockRejectedValue('plain failure')
    expect(await json('/api/assets')).toEqual({status:500,body:{error:'plain failure'}})
    expect(log).toHaveBeenCalled();log.mockRestore()
  })

  it('serves built static content without sending the SPA for an unknown API', async () => {
    const dir=join(state.root,'dist');await mkdir(dir);await writeFile(join(dir,'index.html'),'<h1>app</h1>')
    const staticServer=createServer(createApp()).listen(0,'127.0.0.1');await once(staticServer,'listening')
    const address=staticServer.address(); if(!address || typeof address==='string') throw Error('no port')
    try {
      expect(await (await fetch(`http://127.0.0.1:${address.port}/study`)).text()).toBe('<h1>app</h1>')
      expect((await fetch(`http://127.0.0.1:${address.port}/api/not-a-route`)).status).toBe(404)
    } finally {await new Promise<void>((resolve,reject)=>staticServer.close(e=>e?reject(e):resolve()))}
  })
})
it('applies documented defaults when optional AI request bodies are absent', async () => {
  for (const path of ['/api/settings/ai/models', '/api/settings/ai/probe-effort', '/api/ai/copywrite', '/api/ai/place-photos']) {
    expect((await json(path, 'POST')).status).toBe(200)
  }
  expect(boundary.settings.resolveDraftProfile).toHaveBeenCalledWith({})
  expect((await json('/api/ai/enrich-copy', 'POST')).status).toBe(400)
  expect(boundary.ai.chatJson).toHaveBeenCalledTimes(2)
})
it('preserves exact pre-extraction prompt output for every multiline AI route',async()=>{
  const { default: fixtures } = await import('../fixtures/pre-extraction-prompts.json')
  for(const fixture of fixtures){
    expect((await json('/api/ai/'+fixture.path,'POST',fixture.body)).status).toBe(200)
    expect(boundary.ai.chatJson.mock.lastCall?.[1]).toBe(fixture.prompt)
  }
})
it('preserves uploads larger than the generic 8 MB recommendation',async()=>{
 const bytes=new Uint8Array(9*1024*1024);bytes[0]=17;bytes[bytes.length-1]=29
 const data=new FormData();data.append('files',new Blob([bytes]),'large.png')
 const response=await fetch(url+'/api/assets',{method:'POST',body:data});expect(response.status).toBe(200)
 const actual=boundary.assets.saveAsset.mock.calls[0][0] as Buffer
 expect(actual.length).toBe(bytes.length);expect(actual[0]).toBe(17);expect(actual.at(-1)).toBe(29)
},30000)
it('rejects a third real upload while two business handlers are still processing',async()=>{
 const completed:Array<()=>void>=[]
 boundary.assets.saveAsset.mockImplementation(()=>new Promise(resolve=>completed.push(()=>resolve({id:'uploaded'}))))
 const first=upload('/api/assets','one.png'),second=upload('/api/assets','two.png')
 await vi.waitFor(()=>expect(completed).toHaveLength(2))
 const third=await upload('/api/assets','three.png');expect(third.status).toBe(429);expect(third.headers.get('retry-after')).toBe('1')
 completed.forEach(done=>done());expect((await first).status).toBe(200);expect((await second).status).toBe(200)
 boundary.assets.saveAsset.mockResolvedValue({id:'next'});expect((await upload('/api/assets','next.png')).status).toBe(200)
})
it('aborting a sent suggestion disconnect propagates to the model and does not block the next request', async () => {
 let started!:()=>void;const ready=new Promise<void>(r=>started=r)
 let cancelled!:()=>void;const stopped=new Promise<void>(r=>cancelled=r)
 let modelSignal:AbortSignal|undefined
 boundary.ai.chatJson.mockImplementationOnce(async (_s,_u,opts)=>{
  modelSignal=opts.signal;started()
  await new Promise<void>(resolve=>modelSignal?.addEventListener('abort',()=>{cancelled();resolve()},{once:true}))
  throw new DOMException('Cancelled','AbortError')
 })
 const ctrl=new AbortController()
 const pending=fetch(url+'/api/ai/suggest-instruction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:{blocks:[]}}),signal:ctrl.signal})
 const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
 await ready;expect(modelSignal).toBeDefined();expect(modelSignal?.aborted).toBe(false)
 ctrl.abort();await rejected;await stopped
 expect(modelSignal?.aborted).toBe(true)
 expect((await json('/api/ai/suggest-instruction','POST',{context:{blocks:[]}})).status).toBe(200)
})
it('normal request-body close must not abort a live suggestion; model failures still reach HTTP error handling',async()=>{
 let modelSignal:AbortSignal|undefined
 boundary.ai.chatJson.mockImplementationOnce(async(_s,_u,opts)=>{modelSignal=opts.signal;await new Promise(r=>setTimeout(r,10));expect(modelSignal?.aborted).toBe(false);throw Object.assign(new Error('provider failed'),{status:502})})
 const result=await json('/api/ai/suggest-instruction','POST',{context:{blocks:[]}})
 expect(result.status).toBe(502);expect(modelSignal?.aborted).toBe(false)
})
