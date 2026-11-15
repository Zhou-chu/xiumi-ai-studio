import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: any[]) => unknown
const h=vi.hoisted(()=>{
  const unsafe=()=>{throw Error('Unexpected external server route boundary')}
  const blocked=()=>vi.fn<Handler>(unsafe)
  const db=()=>({get:blocked(),put:blocked(),list:blocked(),remove:blocked()})
  const routes=new Map<string,Handler[]>(), middleware:Handler[]=[]
  const app=Object.fromEntries(['get','post','put','delete'].map(method=>[method,(path:string|RegExp,...handlers:Handler[])=>{
    routes.set(method+' '+String(path),handlers)
  }]))
  return {
    routes,middleware,app:{...app,disable:()=>{},use:(...handlers:Handler[])=>middleware.push(...handlers)},unsafe,
    project:db(),version:db(),template:db(),theme:db(),
    safeId:blocked(),exists:blocked(),readSync:blocked(),readFile:blocked(),mkdir:blocked(),rm:blocked(),writeFile:blocked(),spawn:blocked(),
    imagePath:blocked(),assets:{list:blocked(),save:blocked(),crop:blocked(),remove:blocked(),glyph:blocked(),article:blocked()},component:db(),uploadBodyImage:blocked(),writeBackup:blocked(),uploadCover:blocked(),publish:blocked(),validate:blocked(),wxStatus:blocked(),
    chat:blocked(), suggestionPrompt:blocked(),readSuggestion:blocked(), edit:blocked(), fetch:blocked(), resolveLegacy:blocked(), planMerge:blocked(), applyMerge:blocked(),extractBackup:blocked(),
    aiStatus:blocked(),resolve:blocked(),aiSettings:blocked(),aiSave:blocked(),discover:blocked(),testConnection:blocked(),probe:blocked(),
  }
})
const fakePaths=vi.hoisted(()=>{
  const rootPath='/synthetic/server'
  return {
    ROOT:rootPath,DATA:rootPath+'/data',DATA_ENV:rootPath+'/data/.env',LOG_DIR:rootPath+'/logs',TMP_DIR:rootPath+'/tmp',
    APP_ID:'synthetic-app',PACKAGED:false,
  }
})
vi.mock('express',()=>({default:Object.assign(()=>h.app,{json:()=>h.unsafe,static:()=>h.unsafe})}))
vi.mock('multer',()=>({default:()=>({single:()=>h.unsafe,array:()=>h.unsafe})}))
vi.mock('node:fs',()=>{
  h.exists.mockReturnValue(false)
  h.readSync.mockReturnValue(JSON.stringify({version:'synthetic-version'}))
  return {existsSync:h.exists,readFileSync:h.readSync}
})
vi.mock('node:fs/promises',()=>({mkdir:h.mkdir,rm:h.rm,writeFile:h.writeFile,readFile:h.readFile}))
vi.mock('node:child_process',()=>({spawn:h.spawn}))
vi.mock('../../server/paths',()=>fakePaths)
vi.mock('../../server/store',()=>({
  ROOT:fakePaths.ROOT,DIRS:{projects:'projects',templates:'templates',themes:'themes',versions:'versions'},
  safeId:h.safeId,collection:(path:string)=>{
    if(path==='templates')return h.template
    if(path==='themes')return h.theme
    if(path.replaceAll('\\','/').startsWith('versions/'))return h.version
    throw Error('Unexpected fixture collection')
  },
}))
vi.mock('../../server/projectStore',()=>({projectCollection:()=>h.project}))
vi.mock('../../server/uploadStorage',()=>({boundedDiskStorage:()=>({})}))
vi.mock('../../server/uploadGate',()=>({createUploadGate:()=>()=>h.unsafe}))
vi.mock('../../server/assets',()=>({
  cropAsset:h.assets.crop,deleteAsset:h.assets.remove,listAssets:h.assets.list,saveAsset:h.assets.save,saveGlyph:h.assets.glyph,variantPath:h.imagePath,
}))
vi.mock('../../server/dataTools',()=>({
  applyMerge:h.applyMerge,CATEGORIES:{projects:{label:'项目'}},extractBackup:h.extractBackup,planMerge:h.planMerge,resolveLegacy:h.resolveLegacy,writeBackup:h.writeBackup,
}))
vi.mock('../../server/components',()=>({
  listComponents:h.component.list,removeComponent:h.component.remove,saveComponent:h.component.put,updateComponent:h.component.get,
}))
vi.mock('../../server/net',()=>({IMAGE_HOST:/^images\.fixture\.invalid$/,MAX_PAGE_BYTES:100,WECHAT_IMAGE_HOST:/^wx\.fixture\.invalid$/,safeFetch:h.fetch}))
vi.mock('../../server/articleImages',()=>({importArticleImages:h.assets.article}))
vi.mock('../../server/importer',()=>({importFile:h.unsafe}))
vi.mock('../../server/aiModels',()=>({probeEfforts:h.probe}))
vi.mock('../../server/aiEdit',()=>({prepareEdit:h.edit}))
vi.mock('../../server/aiSuggestion',()=>({suggestionPrompt:h.suggestionPrompt,readSuggestion:h.readSuggestion,SUGGESTION_SYSTEM:''}))
vi.mock('../../server/ai',()=>({
  aiStatus:h.aiStatus,chatJson:h.chat,discoverModels:h.discover,testConnection:h.testConnection,
  COPY_SYSTEM:'fixture-copy',DESIGN_SYSTEM:'fixture-design',EDIT_SYSTEM:'fixture-edit',ENRICH_SYSTEM:'fixture-enrich',OUTLINE_SYSTEM:'fixture-outline',PLACE_SYSTEM:'fixture-place',
}))
vi.mock('../../server/settings',()=>({
  publicAiSettings:h.aiSettings,resolveDraftProfile:h.resolve,saveAiSettings:h.aiSave,
}))
vi.mock('../../server/wechat',()=>({
  addDraft:h.publish,uploadContentImage:h.uploadBodyImage,uploadCover:h.uploadCover,validateDraft:h.validate,wechatStatus:h.wxStatus,
}))

type AppModule = typeof import('../../server/app')
let createApp: AppModule['createApp'], statusLine: AppModule['statusLine']
let app: AppModule

const response=()=>{
  const res={
    code:200,body:null as unknown,headers:new Map<string,string>(),sentFile:null as string|null,ended:false,
    status: (status:number)=>{res.code=status;return res},
    json: (body:unknown)=>{res.body=body;return res},
    setHeader: (name:string,value:string)=>{res.headers.set(name,value);return res},
    sendFile: (path:string)=>{res.sentFile=path;return res},
    send: (body:unknown)=>{res.body=body;return res},
    end: ()=>{res.ended=true;return res},
  }
  return res
}
type Req={params?:Record<string,string>; body?:unknown;query?:Record<string,string>; method?:string;headers?:Record<string,string>}
const invoke=async(method:string,path:string,req:Req={})=>{
  const registered=h.routes.get(method+' '+path)
  if(!registered||registered.length!==1)throw Error('Only a sole terminal route is allowed for this harness: '+path)
  const res=response()
  const request={params:{},body:{},query:{},...req,method}
  const errorHandler=h.middleware.findLast(callback=>callback.length===4)
  if(!errorHandler)throw Error('Missing app error translation')
  const next=(error:unknown)=>errorHandler(error,request,res,h.unsafe)
  await registered[0](request,res,next)
  return res
}
const success=(res:ReturnType<typeof response>,body:unknown)=>{
  expect(res.code).toBe(200);expect(res.body).toEqual(body)
}
const error=(res:ReturnType<typeof response>,code:number,contains:string)=>{
  expect(res.code).toBe(code);expect(res.body).toEqual({error:expect.stringContaining(contains)})
}
const doc=(id='a',updatedAt=1)=>({id,updatedAt,title:'Fixture draft',themeId:'fixture',blocks:[{id:'one',body:'draft content'}]})

beforeEach(async()=>{
  vi.resetModules()
  h.routes.clear()
  h.middleware.length=0
  vi.useFakeTimers({now:1700000000000})
  vi.stubGlobal('fetch',vi.fn(h.unsafe))
  for(const boundary of [
    ...Object.values(h.project),...Object.values(h.version),...Object.values(h.template),...Object.values(h.theme),
    h.safeId,h.readSync,h.exists,h.readFile,h.mkdir,h.rm,h.writeFile,h.spawn,h.imagePath,h.uploadCover,h.publish,
    ...Object.values(h.assets),...Object.values(h.component),h.uploadBodyImage,h.writeBackup,
    h.chat,h.suggestionPrompt,h.readSuggestion,h.edit,h.fetch,h.resolveLegacy,h.planMerge,h.applyMerge,h.extractBackup,
    h.validate,h.wxStatus,h.aiStatus,h.resolve,h.aiSettings,h.aiSave,h.discover,h.testConnection,h.probe,
  ])boundary.mockReset().mockImplementation(h.unsafe)
  h.safeId.mockImplementation((id:string)=>id)
  h.exists.mockReturnValue(false)
  h.readSync.mockReturnValue(JSON.stringify({version:'synthetic-version'}))
  app=await import('../../server/app')
  ;({createApp,statusLine}=app)
  expect(h.routes.get('get /api/app/info')).toHaveLength(1)
  expect(h.middleware.filter(handler=>handler.length===4)).toHaveLength(1)
  h.readSync.mockClear()
  h.exists.mockClear()
  createApp()
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})

it('exposes only sorted project summary fields and a zero block count for a legacy record',async()=>{
  h.project.list.mockResolvedValueOnce([doc('older',2),{...doc('newer',5),blocks:undefined}])
  success(await invoke('get','/api/projects'),[
    {id:'newer',title:'Fixture draft',themeId:'fixture',updatedAt:5,blockCount:0},
    {id:'older',title:'Fixture draft',themeId:'fixture',updatedAt:2,blockCount:1},
  ])
})

it('distinguishes an absent project from a returned project and delegates deletion by route identity',async()=>{
  const params={id:'required'}
  h.project.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce(doc('required'))
  error(await invoke('get','/api/projects/:id',{params}),404,'项目不存在')
  success(await invoke('get','/api/projects/:id',{params}),doc('required'))
  h.project.remove.mockResolvedValueOnce(undefined)
  success(await invoke('delete','/api/projects/:id',{params}),{ok:true})
  expect(h.project.remove).toHaveBeenCalledExactlyOnceWith('required')
})

it('pins writes to the route document with a revision and forwards actual persistence conflict to the adapter',async()=>{
  const body={...doc('irrelevant-body'),revision:'expected-R1'},params={id:'route-id'}
  h.safeId.mockReturnValueOnce('canonical-fixture')
  h.project.put.mockResolvedValueOnce({updatedAt:123,revision:'new-R2'})
  success(await invoke('put','/api/projects/:id',{params,body}),{ok:true,updatedAt:123,revision:'new-R2'})
  expect(h.safeId).toHaveBeenCalledExactlyOnceWith(params.id)
  expect(h.project.put).toHaveBeenCalledExactlyOnceWith({...body,id:'canonical-fixture',updatedAt:1700000000000})
  h.project.put.mockRejectedValueOnce(Object.assign(new Error('revision conflict fixture'),{status:409}))
  error(await invoke('put','/api/projects/:id',{params,body}),409,'revision conflict fixture')
})

it('returns version metadata without drafts, sorts it, and reports missing selected version',async()=>{
  const params={id:'draft',vid:'selected'}
  const lower={id:'old',label:'旧稿',createdAt:1,doc:doc()}
  const higher={id:'selected',label:'已存',createdAt:2,doc:{...doc(),blocks:undefined}}
  h.version.list.mockResolvedValueOnce([lower,higher])
  success(await invoke('get','/api/projects/:id/versions',{params}),[
    {id:higher.id,label:higher.label,createdAt:2,blockCount:0},{id:lower.id,label:lower.label,createdAt:1,blockCount:1},
  ])
  h.version.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce(higher)
  error(await invoke('get','/api/projects/:id/versions/:vid',{params}),404,'版本不存在')
  success(await invoke('get','/api/projects/:id/versions/:vid',{params}),higher)
})

it('stores a new version before pruning only versions beyond the fifty most recent',async()=>{
  const order:string[]=[]
  const old=Array.from({length:51},(_,i)=>({id:'version-'+i,createdAt:i}))
  const contents=doc('project')
  h.version.put.mockImplementationOnce(async(version)=>{
    order.push('new')
    expect(version).toMatchObject({projectId:'project',label:'手动保存',doc:contents,createdAt:1700000000000})
    old.push(version)
  })
  h.version.list.mockImplementationOnce(async()=>{order.push('list');return old})
  h.version.remove.mockImplementation(async(id)=>{order.push(id)})
  const res=await invoke('post','/api/projects/:id/versions',{params:{id:'project'},body:{doc:contents}})
  expect(res.code).toBe(200)
  expect(res.body).toEqual({id:expect.stringMatching(/^1700000000000-\w{4}$/),label:'手动保存',createdAt:1700000000000})
  expect(order).toEqual(['new','list','version-1','version-0'])
})

it('keeps actual template title and optional theme data while filtering role updates to known blocks',async()=>{
  const stored={id:'one',name:'Old',blocks:[{id:'known'}],themeId:'theme',themeOverrides:{fontSize:16},createdAt:1}
  h.template.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce(stored)
  const params={id:stored.id}
  error(await invoke('put','/api/templates/:id',{params}),404,'模板不存在')
  h.template.put.mockResolvedValueOnce(undefined)
  const body={name:'  '+ '名'.repeat(65)+'  ', roles:{known:'h1',missing:'h2'}}
  const expected={...stored,name:'名'.repeat(60),roles:{known:'h1'}}
  success(await invoke('put','/api/templates/:id',{params,body}),expected)
  expect(h.template.put).toHaveBeenCalledExactlyOnceWith(expected)
  expect(stored.name).toBe('Old')
})

it('does not copy invalid template theme fields and preserves explicit valid fields on creation',async()=>{
  h.template.put.mockResolvedValue(undefined)
  const bad=await invoke('post','/api/templates',{body:{themeId:42,themeOverrides:'not theme'}})
  expect(bad.code).toBe(200)
  expect(bad.body).toEqual({id:expect.any(String),name:'未命名模板',blocks:[],createdAt:1700000000000})
  const body={name:'Fixture template',blocks:[{id:'known'}],themeId:'fixture',themeOverrides:{fontSize:15}}
  const valid=await invoke('post','/api/templates',{body})
  expect(valid.body).toMatchObject(body)
  expect(h.template.put).toHaveBeenNthCalledWith(2,valid.body)
})

it('returns synthetic status paths and does not allow UI quit when a quit callback is unavailable',async()=>{
  createApp({port:()=>5274})
  const info=await invoke('get','/api/app/info')
  expect(info.body).toMatchObject({
    app:'synthetic-app',port:5274,envExists:false,dataDir:fakePaths.DATA,envFile:fakePaths.DATA_ENV,canQuit:false,
  })
  const registrations=[...h.routes], middleware=[...h.middleware]
  createApp({port:()=>5275})
  expect((await invoke('get','/api/app/info')).body).toMatchObject({port:5275})
  expect([...h.routes]).toEqual(registrations)
  expect(h.middleware).toEqual(middleware)
  error(await invoke('post','/api/app/quit'),404,'Ctrl+C')
  expect(h.spawn).not.toHaveBeenCalled()
  expect(h.writeFile).not.toHaveBeenCalled()
})

it('acknowledges quit before scheduling a synthetic callback and never runs a process',async()=>{
  const quit=vi.fn()
  createApp({onQuit:quit})
  success(await invoke('post','/api/app/quit'),{ok:true})
  expect(quit).not.toHaveBeenCalled()
  vi.advanceTimersByTime(199);expect(quit).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1);expect(quit).toHaveBeenCalledOnce()
  expect(h.spawn).not.toHaveBeenCalled()
})

it('rejects an unknown open action without touching filesystem or launching an application',async()=>{
  error(await invoke('post','/api/app/open',{body:{target:'fixture-unknown'}}),400,'未知的目标')
  expect(h.exists).not.toHaveBeenCalled();expect(h.mkdir).not.toHaveBeenCalled()
  expect(h.writeFile).not.toHaveBeenCalled();expect(h.spawn).not.toHaveBeenCalled()
})

it('distinguishes an explicitly configured mode without leaking a provider key in statusLine',async()=>{
  const fixture={enabled:true,name:'Synthetic Provider',model:'test-model',apiKey:'never-use-fixture'}
  h.aiStatus.mockResolvedValueOnce(fixture).mockResolvedValueOnce({enabled:false})
  h.wxStatus.mockReturnValueOnce({configured:true}).mockReturnValueOnce({configured:false})
  const configured=await statusLine(5274)
  expect(configured).toContain('http://127.0.0.1:5274')
  expect(configured).toContain('Synthetic Provider / test-model')
  expect(configured).toContain('微信:已配置')
  expect(configured).not.toContain(fixture.apiKey)
  expect(await statusLine(5275)).toContain('AI:规则模式  微信:未配置')
})

it.each([undefined,false,'true'])('requires boolean confirmation for a synthetic draft payload (%s)',async confirm=>{
  error(await invoke('post','/api/wechat/draft',{body:{confirm,cover:'/media/test.jpg'}}),400,'用户确认')
  expect(h.validate).not.toHaveBeenCalled()
  expect(h.imagePath).not.toHaveBeenCalled()
  expect(h.uploadCover).not.toHaveBeenCalled()
  expect(h.publish).not.toHaveBeenCalled()
})

it('rejects a missing cover or a failed validation before preparing any concrete asset',async()=>{
  error(await invoke('post','/api/wechat/draft',{body:{confirm:true,cover:''}}),400,'封面图片')
  expect(h.validate).not.toHaveBeenCalled()
  h.validate.mockReturnValueOnce(['假输入问题一','假输入问题二'])
  error(await invoke('post','/api/wechat/draft',{body:{confirm:true,cover:'/media/test.jpg',title:'Fixture'}}),400,'假输入问题一；假输入问题二')
  expect(h.imagePath).not.toHaveBeenCalled();expect(h.uploadCover).not.toHaveBeenCalled();expect(h.publish).not.toHaveBeenCalled()
})

it('prevalidates a confirmed synthetic draft, then passes only its prepared cover ID to the mocked submitter',async()=>{
  const order:string[]=[]
  const body={confirm:true,cover:'/media/fixture.jpg',title:'合成标题',author:'合成作者',digest:'合成摘要',html:'<p>Test</p>'}
  const payload={title:body.title,author:body.author,digest:body.digest,content:body.html}
  h.validate.mockImplementationOnce(received=>{order.push('validate');expect(received).toEqual({...payload,thumb_media_id:'pending'});return []})
  h.imagePath.mockImplementationOnce(async(...args)=>{order.push('prepare');expect(args).toEqual(['fixture.jpg','235:100',900]);return '/synthetic/cover.jpg'})
  h.uploadCover.mockImplementationOnce(async(...args)=>{order.push('cover');expect(args).toEqual(['fixture.jpg#cover','/synthetic/cover.jpg']);return {media_id:'fake-cover-ID'}})
  h.publish.mockImplementationOnce(async(received)=>{order.push('draft');expect(received).toEqual({...payload,thumb_media_id:'fake-cover-ID'});return {media_id:'mock-draft-ID'}})
  success(await invoke('post','/api/wechat/draft',{body}),{media_id:'mock-draft-ID'})
  expect(order).toEqual(['validate','prepare','cover','draft'])
})

it('translates a synthetic size error to 413 before any unrelated handling',async()=>{
  h.project.list.mockRejectedValueOnce({code:'LIMIT_FILE_SIZE',message:'fixture size'})
  error(await invoke('get','/api/projects'),413,'fixture size')
})

it('offers provider discovery only through a resolved synthetic draft profile',async()=>{
  const body={profileId:'fixture',model:'input-model'}
  const resolved={id:'resolved-fixture',baseUrl:'https://provider.invalid',model:'resolved-model'}
  h.resolve.mockResolvedValueOnce(resolved);h.discover.mockResolvedValueOnce([{id:'model-option'}])
  success(await invoke('post','/api/settings/ai/models',{body}),[{id:'model-option'}])
  expect(h.resolve).toHaveBeenCalledExactlyOnceWith(body)
  expect(h.discover).toHaveBeenCalledExactlyOnceWith(resolved)
  expect(h.aiSave).not.toHaveBeenCalled()
})

it('rejects incomplete probe configuration before invoking any provider capability check',async()=>{
  h.resolve.mockResolvedValueOnce({baseUrl:'',model:'anything'}).mockResolvedValueOnce({baseUrl:'https://provider.invalid',model:''})
  for(const prof of [{alias:'one'},{alias:'two'}]) {
    error(await invoke('post','/api/settings/ai/probe-effort',{body:prof}),400,'请先填写接口地址和模型名称')
  }
  expect(h.probe).not.toHaveBeenCalled()
  const profile={baseUrl:'https://provider.invalid',model:'fixture-model'}
  h.resolve.mockResolvedValueOnce(profile);h.probe.mockResolvedValueOnce({supported:['fixture-effort']})
  success(await invoke('post','/api/settings/ai/probe-effort'),{supported:['fixture-effort']})
  expect(h.probe).toHaveBeenCalledExactlyOnceWith(profile)
})

it('acknowledges only explicit success in the provider test reply and measures actual returned timing',async()=>{
  const profile={baseUrl:'https://provider.invalid',model:'fixture-model'}
  h.resolve.mockResolvedValue(profile)
  h.testConnection.mockImplementationOnce(async()=>{
    vi.setSystemTime(1700000000030)
    return {ok:'true',text:'synthetic fixture'}
  }).mockResolvedValueOnce({ok:true})
  success(await invoke('post','/api/settings/ai/test'),{ok:false,reply:{ok:'true',text:'synthetic fixture'},ms:30})
  success(await invoke('post','/api/settings/ai/test'),{ok:true,reply:{ok:true},ms:0})
  expect(h.testConnection.mock.calls).toEqual([[profile],[profile]])
})

it('passes the public settings and save reply through their explicit boundary, without model or filesystem calls',async()=>{
  const body={activeId:'selected-fixture',profiles:[]}
  const initial={activeId:'before',profiles:[]}
  h.aiSettings.mockResolvedValueOnce(initial);h.aiSave.mockResolvedValueOnce(body)
  success(await invoke('get','/api/settings/ai'),initial)
  success(await invoke('put','/api/settings/ai',{body}),body)
  expect(h.aiSave).toHaveBeenCalledExactlyOnceWith(body)
  expect(h.resolve).not.toHaveBeenCalled()
  expect(h.discover).not.toHaveBeenCalled()
  expect(h.writeFile).not.toHaveBeenCalled()
})

it('keeps image names with bounded descriptions in the synthetic outline request',async()=>{
  h.chat.mockResolvedValueOnce({sections:[{heading:'合成结果'}]})
  const body={text:'合成文稿',imageNames:['cover.jpg','another.jpg'],imageNotes:['  '+'图'.repeat(101)+'  '],profileId:'synthetic-profile'}
  success(await invoke('post','/api/ai/outline',{body}),{sections:[{heading:'合成结果'}]})
  expect(h.chat).toHaveBeenCalledExactlyOnceWith(
    'fixture-outline',expect.stringContaining('cover.jpg（'+'图'.repeat(100)+'）、another.jpg'),
    expect.objectContaining({profileId:'synthetic-profile'}),
  )
  expect(h.chat.mock.calls[0][1]).toContain('合成文稿')
})

it('passes synthetic design directives and contextual summary without treating a non-string profile as a profile ID',async()=>{
  h.chat.mockResolvedValueOnce({name:'合成布局'})
  const body={brief:{sections:['一段']},hint:'输入描述',profileId:42}
  success(await invoke('post','/api/ai/design',{body}),{name:'合成布局'})
  expect(h.chat).toHaveBeenCalledExactlyOnceWith('fixture-design',expect.any(String),expect.objectContaining({profileId:undefined}))
  expect(h.chat.mock.calls[0][1]).toContain('输入描述')
  expect(h.chat.mock.calls[0][1]).toContain(JSON.stringify(body.brief))
})

it('bounds heading specificity and sends previous copy only for an explicit revision',async()=>{
  h.chat.mockResolvedValue({text:'合成输出'})
  success(await invoke('post','/api/ai/copywrite',{body:{brief:'合成活动',levels:99,previous:'上一版合成稿',revise:'保留原事实'}}),{text:'合成输出'})
  expect(h.chat.mock.calls[0][1]).toContain('使用 3 级标题')
  expect(h.chat.mock.calls[0][1]).toContain('上一版合成稿')
  expect(h.chat.mock.calls[0][1]).toContain('保留原事实')
  success(await invoke('post','/api/ai/copywrite',{body:{brief:'合成活动',levels:-20,revise:'单有意见不等于已有文案'}}),{text:'合成输出'})
  expect(h.chat.mock.calls[1][1]).toContain('使用 1 级标题')
  expect(h.chat.mock.calls[1][1]).not.toContain('上一版文案')
  expect(h.chat.mock.calls[1][1]).not.toContain('单有意见不等于已有文案')
})

it('skips model calls when no photo note is present and retains grouping and immovable copy otherwise',async()=>{
  error(await invoke('post','/api/ai/enrich-copy',{body:{photos:[{no:1,note:''}]}}),400,'没有照片描述')
  expect(h.chat).not.toHaveBeenCalled()
  h.chat.mockResolvedValueOnce({text:'合成补充稿'})
  const body={photos:[{no:1,note:'合成图片描述',group:'甲组',after:'合成锚点'}],text:'合成原文',keep:['必须保留这句']}
  success(await invoke('post','/api/ai/enrich-copy',{body}),{text:'合成补充稿'})
  expect(h.chat.mock.calls[0][0]).toBe('fixture-enrich')
  expect(h.chat.mock.calls[0][1]).toContain('照片 1（组 甲组，放在「合成锚点」后面）：合成图片描述')
  expect(h.chat.mock.calls[0][1]).toContain('- 必须保留这句')
})

it('delegates placement with the allowed layout envelope and selected synthetic profile',async()=>{
  h.chat.mockResolvedValueOnce({placement:[{section:'一'}]})
  const body={items:[{id:'item'}],units:[{id:'unit'}],layouts:{1:['single']},profileId:'fake-profile'}
  success(await invoke('post','/api/ai/place-photos',{body}),{placement:[{section:'一'}]})
  expect(h.chat).toHaveBeenCalledExactlyOnceWith('fixture-place',expect.any(String),expect.objectContaining({profileId:'fake-profile'}))
  const request=h.chat.mock.calls[0][1]
  for(const input of [body.items,body.units,body.layouts])expect(request).toContain(JSON.stringify(input))
})

it('passes the exact selected scope to its edit adapter before a model call and returns only the adapter result',async()=>{
  const order:string[]=[]
  const synthetic={ops:[{op:'update',id:'a'}]}
  const body={context:{blocks:[{id:'a'},{id:'b'}]},selectedIds:['a','b'],instruction:'精简合成文本',profileId:'profile'}
  h.edit.mockImplementationOnce((...args)=>{
    order.push('bound scope');expect(args).toEqual([body.context,undefined,undefined,body.selectedIds])
    return {prompt:(instruction:string)=>{order.push('instruction');return 'prepared '+instruction},
      result:(raw:unknown)=>{order.push('limit reply');expect(raw).toBe(synthetic);return {visible:'approved-only'}}}
  })
  h.chat.mockImplementationOnce(async()=>{order.push('stub model');return synthetic})
  success(await invoke('post','/api/ai/edit',{body}),{visible:'approved-only'})
  expect(h.chat).toHaveBeenCalledExactlyOnceWith('fixture-edit','prepared 精简合成文本',expect.objectContaining({profileId:'profile'}))
  expect(order).toEqual(['bound scope','instruction','stub model','limit reply'])
})

it.each(['/api/article/fetch','/api/reference/fetch'])('uses only the transport mock and propagates the synthetic fetched status for %s',async route=>{
  const body={url:'https://fixture.invalid/item'}
  h.fetch.mockResolvedValueOnce({ok:true,text:async()=>'<p>合成回执</p>'}).mockResolvedValueOnce({ok:false,status:503})
  success(await invoke('post',route,{body}),{html:'<p>合成回执</p>'})
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith(body.url,expect.objectContaining({maxBytes:100,maxRedirects:5}))
  const expectedLog=vi.spyOn(console,'error').mockImplementation(()=>{})
  try {
    error(await invoke('post',route,{body}),502,'抓取失败 HTTP 503')
    expect(expectedLog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({status:502}))
  } finally { expectedLog.mockRestore() }
})

it('keeps migration preview read-only and applies only a separate synthetic plan',async()=>{
  const paths={dataDir:'/fixture/data',envFile:'/fixture/.env'}
  const plan={source:'synthetic-source',target:'synthetic-target',counts:{projects:{add:1}},ignored:['fixture'],ai:false,env:false}
  const body={path:'/fixture/legacy'}
  h.resolveLegacy.mockReturnValue(paths)
  h.planMerge.mockResolvedValue(plan)
  success(await invoke('post','/api/data/migrate/preview',{body}),{plan:{...plan,counts:{projects:{add:1,label:'项目'}}}})
  expect(h.applyMerge).not.toHaveBeenCalled()
  expect(h.mkdir).not.toHaveBeenCalled()
  h.applyMerge.mockResolvedValueOnce({applied:1})
  success(await invoke('post','/api/data/migrate/apply',{body}),{applied:1})
  expect(h.resolveLegacy.mock.calls).toEqual([[body.path],[body.path]])
  expect(h.planMerge.mock.calls).toEqual([[paths.dataDir,paths.envFile],[paths.dataDir,paths.envFile]])
  expect(h.applyMerge).toHaveBeenCalledExactlyOnceWith(plan)
})

it('serves an immutable media response using the exact selected variant and does not echo a missing file',async()=>{
  h.imagePath.mockResolvedValueOnce('/virtual/asset-small.jpg')
  const result=await invoke('get','/media/:file',{params:{file:'asset.jpg'},query:{fit:'100:50',w:'640'}})
  expect(result.code).toBe(200)
  expect(result.sentFile).toBe('/virtual/asset-small.jpg')
  expect(result.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  expect(h.imagePath).toHaveBeenCalledExactlyOnceWith('asset.jpg','100:50',640)
  h.imagePath.mockRejectedValueOnce(Object.assign(Error('fixture image missing'),{status:404}))
  const missing=await invoke('get','/media/:file',{params:{file:'missing.jpg'},query:{w:'NaN'}})
  error(missing,404,'fixture image missing')
  expect(missing.sentFile).toBeNull()
  expect(missing.headers.size).toBe(0)
  expect(h.imagePath).toHaveBeenLastCalledWith('missing.jpg',undefined,undefined)
})

it('delegates crop and delete to the requested asset, and returns a direct library listing',async()=>{
  const listed=[{id:'fixture-original'}], box={x:3,y:5,width:50,height:40}, cropped={id:'fixture-new'}
  h.assets.list.mockResolvedValueOnce(listed)
  h.assets.crop.mockResolvedValueOnce(cropped)
  h.assets.remove.mockResolvedValueOnce(undefined)
  success(await invoke('get','/api/assets'),listed)
  success(await invoke('post','/api/assets/:id/crop',{params:{id:'fixture-original'},body:box}),cropped)
  success(await invoke('delete','/api/assets/:id',{params:{id:'fixture-original'}}),{ok:true})
  expect(h.assets.crop).toHaveBeenCalledExactlyOnceWith('fixture-original',box)
  expect(h.assets.remove).toHaveBeenCalledExactlyOnceWith('fixture-original')
})

it('returns a bounded request-only grouping of successful glyph receipts and ignores malformed entries',async()=>{
  h.assets.glyph.mockResolvedValueOnce('rp-first.png').mockResolvedValueOnce(undefined)
  const images=['synthetic-raster-a',{},'synthetic-raster-b',...Array(797).fill(0),'outside-array-limit']
  success(await invoke('post','/api/replay/glyphs',{body:{images}}),{'synthetic-raster-a':'/media/rp-first.png?w=2400'})
  success(await invoke('post','/api/replay/glyphs',{body:{images:'not-array'}}),{})
  expect(h.assets.glyph.mock.calls).toEqual([['synthetic-raster-a'],['synthetic-raster-b']])
})

it('preserves the article and reference fetch response contract and maps bad upstream status without real traffic',async()=>{
  const url='https://source.fixture.invalid/article'
  h.fetch.mockResolvedValueOnce(new Response('<main>合成片段</main>')).mockResolvedValueOnce(new Response(null,{status:503}))
  success(await invoke('post','/api/article/fetch',{body:{url}}),{html:'<main>合成片段</main>'})
  const log=vi.spyOn(console,'error').mockImplementation(()=>{})
  error(await invoke('post','/api/reference/fetch',{body:{url}}),502,'抓取失败 HTTP 503')
  expect(h.fetch.mock.calls).toEqual(Array.from({length:2},()=>[url,expect.objectContaining({maxRedirects:5,maxBytes:100})]))
  expect(log).toHaveBeenCalledOnce()
})

it('forwards the WeChat image bytes only through the checked adapter with fallback content type',async()=>{
  const url='https://wx.fixture.invalid/selected.jpg'
  h.fetch.mockResolvedValueOnce(new Response(Uint8Array.from([41,42])))
  const returned=await invoke('get','/api/wx-image',{query:{u:url}})
  expect(returned.code).toBe(200)
  expect(returned.body).toEqual(Buffer.from([41,42]))
  expect(returned.headers.get('Content-Type')).toBe('image/jpeg')
  expect(returned.headers.get('Cache-Control')).toBe('public, max-age=86400')
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith(url,expect.objectContaining({allowHost:expect.any(Function)}))
  const allow=h.fetch.mock.calls[0][1].allowHost
  expect(allow('wx.fixture.invalid')).toBe(true)
  expect(allow('unrelated.fixture.invalid')).toBe(false)
  h.fetch.mockRejectedValueOnce(Error('synthetic upstream failure')).mockResolvedValueOnce(new Response(null,{status:404}))
  for(let i=0;i<2;i++){
    const rejected=await invoke('get','/api/wx-image')
    expect(rejected.code).toBe(502);expect(rejected.ended).toBe(true);expect(rejected.body).toBeNull()
  }
  expect(h.fetch).toHaveBeenLastCalledWith('',expect.anything())
})

it('imports a submitted article image list through only the collection adapter',async()=>{
  const urls=['https://images.fixture.invalid/image/example.png'], receipt={count:1,results:[{id:'asset-fixture'}]}
  h.assets.article.mockResolvedValueOnce(receipt)
  success(await invoke('post','/api/assets/import-article',{body:{urls}}),receipt)
  expect(h.assets.article).toHaveBeenCalledExactlyOnceWith(urls)
  expect(h.fetch).not.toHaveBeenCalled()
  expect(h.assets.save).not.toHaveBeenCalled()
})

it('deduplicates synthetic image imports, retaining successes when another origin fails',async()=>{
  const good='https://images.fixture.invalid/article/photo.jpg', bad='https://images.fixture.invalid/bad.jpg', other='https://images.fixture.invalid/not-found.jpg'
  h.fetch.mockImplementation(async(url:string)=>{
    if(url===good)return new Response(Uint8Array.from([1,2,3]))
    if(url===other)return new Response(null,{status:404})
    throw Error('synthetic connection failure')
  })
  const receipt={id:'saved-fixture'}
  h.assets.save.mockResolvedValueOnce(receipt)
  success(await invoke('post','/api/assets/fetch',{body:{urls:[good,bad,other,good]}}),{[good]:receipt})
  expect(h.fetch.mock.calls.map(([url])=>url)).toEqual([good,bad,other])
  expect(h.assets.save).toHaveBeenCalledExactlyOnceWith(Buffer.from([1,2,3]),'wx-article.jpg')
  const allowed=h.fetch.mock.calls[0][1].allowHost
  expect(allowed('images.fixture.invalid')).toBe(true)
  expect(allowed('wx.fixture.invalid')).toBe(false)
  success(await invoke('post','/api/assets/fetch'),{})
})

it('returns only local body-image variants uploaded through the substituted draft image seam',async()=>{
  const a='/media/crop-a.jpg?fit=3%3A2&w=480', b='/media/crop-b.png'
  h.imagePath.mockResolvedValueOnce('/virtual/cache/a.jpg').mockResolvedValueOnce('/virtual/cache/b.png')
  h.uploadBodyImage.mockResolvedValueOnce('https://wx.fixture.invalid/a').mockResolvedValueOnce('https://wx.fixture.invalid/b')
  success(await invoke('post','/api/wechat/upload-images',{body:{urls:[a,'https://outside.fixture.invalid/remote.jpg',b]}}),
    {[a]:'https://wx.fixture.invalid/a',[b]:'https://wx.fixture.invalid/b'})
  expect(h.imagePath.mock.calls).toEqual([['crop-a.jpg','3:2',480],['crop-b.png',undefined,undefined]])
  expect(h.uploadBodyImage.mock.calls).toEqual([[a,'/virtual/cache/a.jpg'],[b,'/virtual/cache/b.png']])
})

it('keeps repository routes scoped to the stated component, theme or template',async()=>{
  const item={id:'fixture-card',name:'修改'}, theme={id:'unclear-theme',colors:{primary:'#abcdef'}}
  h.component.list.mockResolvedValueOnce([item]); h.component.put.mockResolvedValueOnce({component:item,duplicate:false})
  h.component.get.mockResolvedValueOnce(item); h.component.remove.mockResolvedValueOnce(undefined)
  h.theme.list.mockResolvedValueOnce([theme]); h.theme.put.mockResolvedValueOnce(undefined);h.theme.remove.mockResolvedValueOnce(undefined)
  h.template.remove.mockResolvedValueOnce(undefined)
  success(await invoke('get','/api/components'),[item])
  success(await invoke('post','/api/components',{body:item}),{component:item,duplicate:false})
  success(await invoke('put','/api/components/:id',{params:{id:'fixture-card'},body:item}),item)
  success(await invoke('delete','/api/components/:id',{params:{id:'fixture-card'}}),{ok:true})
  success(await invoke('get','/api/themes'),[theme])
  h.safeId.mockReturnValueOnce('canonical-theme')
  success(await invoke('post','/api/themes',{body:theme}),{ok:true})
  success(await invoke('delete','/api/themes/:id',{params:{id:'theme-to-delete'}}),{ok:true})
  success(await invoke('delete','/api/templates/:id',{params:{id:'template-to-delete'}}),{ok:true})
  expect(h.component.put).toHaveBeenCalledExactlyOnceWith(item)
  expect(h.component.get).toHaveBeenCalledExactlyOnceWith('fixture-card',item)
  expect(h.component.remove).toHaveBeenCalledExactlyOnceWith('fixture-card')
  expect(h.theme.put).toHaveBeenCalledExactlyOnceWith({...theme,id:'canonical-theme'})
  expect(h.theme.remove).toHaveBeenCalledExactlyOnceWith('theme-to-delete')
  expect(h.template.remove).toHaveBeenCalledExactlyOnceWith('template-to-delete')
})

it('sets local backup download headers and delegates ZIP generation to an in-memory boundary',async()=>{
  h.writeBackup.mockResolvedValueOnce(undefined)
  const result=await invoke('get','/api/data/backup')
  expect(result.code).toBe(200)
  expect(result.headers.get('Content-Type')).toBe('application/zip')
  expect(result.headers.get('Content-Disposition')).toMatch(/^attachment; filename="xiumi-backup-\d{8}-\d{4}\.zip"; filename\*=UTF-8''XIUMI/)
  expect(h.writeBackup).toHaveBeenCalledExactlyOnceWith(result,'synthetic-version')
})

describe('本机访问限制', () => {
  const req = (host: string, method = 'GET', origin?: string) => ({ method, headers: { host, ...(origin && { origin }) } })
  it('只接受回环地址的 Host', () => {
    expect(app.localOnly(req('127.0.0.1:5174'))).toBeNull()
    expect(app.localOnly(req('localhost:5273'))).toBeNull()
    expect(app.localOnly(req('[::1]:5174'))).toBeNull()
    expect(app.localOnly(req('evil.example.com:5174'))).toContain('本机')
    expect(app.localOnly(req('192.168.1.5:5174'))).toContain('本机')
  })
  it('拒绝其他网站发来的写请求，读取不受影响', () => {
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'http://localhost:5273'))).toBeNull()
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'https://evil.example.com'))).toContain('其他网站')
    expect(app.localOnly(req('127.0.0.1:5174', 'POST', 'null'))).toContain('其他网站')
    expect(app.localOnly(req('127.0.0.1:5174', 'GET', 'https://evil.example.com'))).toBeNull()
  })
})

// Invoke only the actual backup terminal handler. The first Multer adapter is
// deliberately NOT executed; file receipts below are synthetic, not multipart.
const backupTerminal=async(file?:{path:string})=>{
  const callbacks=h.routes.get('post /api/data/restore')!
  expect(callbacks).toHaveLength(2)
  const res=response(),req={file,params:{},body:{},query:{},method:'POST'}
  const translate=h.middleware.findLast(fn=>fn.length===4)!
  await callbacks[1](req,res,(err:unknown)=>translate(err,req,res,h.unsafe))
  return res
}
const mergeReceipt={source:'/virtual/archive',target:'/virtual/data',counts:{projects:{add:2,skip:1}},ignored:['settings'],ai:false,env:false}

it('keeps backup preview separate from apply and consumes a verified in-memory session only once',async()=>{
  h.extractBackup.mockResolvedValue(undefined);h.rm.mockResolvedValue(undefined);h.planMerge.mockResolvedValue(mergeReceipt)
  const preview=await backupTerminal({path:'/virtual/upload.zip'})
  const body=preview.body as {token:string;plan:unknown}
  const dir=String(h.extractBackup.mock.calls[0][1])
  expect(body.token).toMatch(/^\w{12}$/)
  expect(h.extractBackup).toHaveBeenCalledExactlyOnceWith('/virtual/upload.zip',dir)
  expect(h.rm).toHaveBeenCalledExactlyOnceWith('/virtual/upload.zip',{force:true})
  expect(h.applyMerge).not.toHaveBeenCalled()
  expect(body.plan).toEqual({...mergeReceipt,counts:{projects:{add:2,skip:1,label:'项目'}}})
  h.applyMerge.mockResolvedValueOnce({added:2})
  success(await invoke('post','/api/data/restore/:token/apply',{params:{token:body.token}}),{added:2})
  expect(h.planMerge.mock.calls).toEqual([[dir,null],[dir,null]])
  expect(h.applyMerge).toHaveBeenCalledExactlyOnceWith(mergeReceipt)
  expect(h.rm).toHaveBeenLastCalledWith(dir,{recursive:true,force:true})
  error(await invoke('post','/api/data/restore/:token/apply',{params:{token:body.token}}),404,'会话已过期')
  expect(h.applyMerge).toHaveBeenCalledOnce()
})

it('rejects an absent backup before extraction and always removes a failed uploaded receipt',async()=>{
  error(await backupTerminal(),400,'缺少备份文件');expect(h.extractBackup).not.toHaveBeenCalled();expect(h.rm).not.toHaveBeenCalled()
  h.extractBackup.mockRejectedValueOnce(Object.assign(Error('synthetic invalid archive'),{status:422}));h.rm.mockResolvedValueOnce(undefined)
  error(await backupTerminal({path:'/virtual/invalid.zip'}),422,'invalid archive')
  expect(h.rm).toHaveBeenCalledExactlyOnceWith('/virtual/invalid.zip',{force:true})
  expect(h.planMerge).not.toHaveBeenCalled();expect(h.applyMerge).not.toHaveBeenCalled()
})

it('cleans a consumed staging directory even when merge rejects, without permitting duplicate apply',async()=>{
  h.extractBackup.mockResolvedValue(undefined);h.rm.mockResolvedValue(undefined);h.planMerge.mockResolvedValue(mergeReceipt)
  const preview=await backupTerminal({path:'/virtual/upload.zip'}), token=(preview.body as {token:string}).token
  const dir=h.extractBackup.mock.calls[0][1]
  h.applyMerge.mockRejectedValueOnce(Object.assign(Error('simulated merge refusal'),{status:409}))
  error(await invoke('post','/api/data/restore/:token/apply',{params:{token}}),409,'merge refusal')
  expect(h.rm).toHaveBeenLastCalledWith(dir,{recursive:true,force:true})
  error(await invoke('post','/api/data/restore/:token/apply',{params:{token}}),404,'会话已过期')
  expect(h.applyMerge).toHaveBeenCalledOnce()
})

it('expires only old preview sessions when a later backup arrives',async()=>{
  h.extractBackup.mockResolvedValue(undefined);h.rm.mockResolvedValue(undefined);h.planMerge.mockResolvedValue(mergeReceipt)
  const old=await backupTerminal({path:'/virtual/old.zip'}),oldToken=(old.body as {token:string}).token,oldDir=h.extractBackup.mock.calls[0][1]
  vi.setSystemTime(1700000000000+3600001)
  const fresh=await backupTerminal({path:'/virtual/new.zip'}),newToken=(fresh.body as {token:string}).token
  expect(h.rm).toHaveBeenNthCalledWith(2,oldDir,{recursive:true,force:true})
  error(await invoke('post','/api/data/restore/:token/apply',{params:{token:oldToken}}),404,'会话已过期')
  h.applyMerge.mockResolvedValueOnce({added:2})
  success(await invoke('post','/api/data/restore/:token/apply',{params:{token:newToken}}),{added:2})
})

// EventEmitter receipts exercise handler ownership, not Express/HTTP transport.
const suggestionRun=(flags:{aborted?:boolean;destroyed?:boolean;writableEnded?:boolean}={})=>{
  const req=Object.assign(new EventEmitter(),{body:{context:'synthetic context',selectedId:'one',selectedIds:['one'],profileId:'fixture-profile'},aborted:flags.aborted??false})
  const events=new EventEmitter()
  const res=Object.assign(response(),{destroyed:flags.destroyed??false,writableEnded:flags.writableEnded??false,once:events.once.bind(events),emit:events.emit.bind(events),removeListener:events.removeListener.bind(events),listenerCount:events.listenerCount.bind(events)})
  const next=vi.fn(),callbacks=h.routes.get('post /api/ai/suggest-instruction')!
  expect(callbacks).toHaveLength(1)
  const pending=Promise.resolve(callbacks[0](req,res,next))
  return {req,res,next,pending}
}
it('forwards suggestion identity and cleans listeners after a normal response',async()=>{
  h.suggestionPrompt.mockReturnValue('fixture prompt');h.chat.mockResolvedValue({raw:true});h.readSuggestion.mockReturnValue({instruction:'receipt'})
  const run=suggestionRun();await run.pending
  expect(h.suggestionPrompt).toHaveBeenCalledExactlyOnceWith('synthetic context','one',['one'])
  expect(h.chat.mock.calls[0][2]).toEqual({maxTokens:2000,profileId:'fixture-profile',signal:expect.any(AbortSignal)})
  success(run.res,{instruction:'receipt'});expect(run.next).not.toHaveBeenCalled()
  expect(run.req.listenerCount('aborted')).toBe(0);expect(run.res.listenerCount('close')).toBe(0)
})
it.each([{aborted:true},{destroyed:true}])('refuses already disconnected suggestion receipt %j before model work',async flags=>{
  h.suggestionPrompt.mockReturnValue('fixture prompt')
  const run=suggestionRun(flags);await run.pending
  expect(h.chat).not.toHaveBeenCalled();expect(h.readSuggestion).not.toHaveBeenCalled();expect(run.next).not.toHaveBeenCalled()
  expect(run.res.body).toBeNull();expect(run.req.listenerCount('aborted')).toBe(0);expect(run.res.listenerCount('close')).toBe(0)
})
it.each(['request','response'])('cancels pending suggestion on %s disconnect and ignores a late model success',async source=>{
  h.suggestionPrompt.mockReturnValue('fixture prompt')
  let finish!:(value:unknown)=>void;h.chat.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const run=suggestionRun(),signal=h.chat.mock.calls[0][2].signal as AbortSignal
  if(source==='request')run.req.emit('aborted');else run.res.emit('close')
  expect(signal.aborted).toBe(true);finish({late:true});await run.pending
  expect(h.readSuggestion).not.toHaveBeenCalled();expect(run.res.body).toBeNull();expect(run.next).not.toHaveBeenCalled()
  expect(run.req.listenerCount('aborted')).toBe(0);expect(run.res.listenerCount('close')).toBe(0)
})
it('does not cancel an ended response and forwards ordinary model failures after listener cleanup',async()=>{
  h.suggestionPrompt.mockReturnValue('fixture prompt')
  let fail!:(error:Error)=>void;h.chat.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject}))
  const run=suggestionRun({writableEnded:true}),signal=h.chat.mock.calls[0][2].signal as AbortSignal
  run.res.emit('close');expect(signal.aborted).toBe(false)
  const refusal=Error('synthetic model refusal');fail(refusal);await run.pending
  expect(run.next).toHaveBeenCalledExactlyOnceWith(refusal);expect(h.readSuggestion).not.toHaveBeenCalled()
  expect(run.req.listenerCount('aborted')).toBe(0);expect(run.res.listenerCount('close')).toBe(0)
})
it('enforces the actual local-only middleware before route dispatch',()=>{
  const guard=h.middleware.find(fn=>fn.length===3)!,next=vi.fn(),denied=response(),allowed=response()
  guard({method:'GET',headers:{}},denied,next)
  error(denied,403,'本机');expect(next).not.toHaveBeenCalled()
  guard({method:'POST',headers:{host:'127.0.0.1:5174',origin:'http://localhost:5273'}},allowed,next)
  expect(next).toHaveBeenCalledOnce();expect(allowed.body).toBeNull()
})
it.each(['data','logs','env'])('opens the %s receipt only through substituted filesystem/process adapters',async target=>{
  h.mkdir.mockResolvedValue(undefined);h.writeFile.mockRejectedValueOnce(Error('synthetic exclusive-create race'))
  const unref=vi.fn();h.spawn.mockReturnValue({unref})
  const result=await invoke('post','/api/app/open',{body:{target}})
  const path=target==='data'?fakePaths.DATA:target==='logs'?fakePaths.LOG_DIR:fakePaths.DATA_ENV
  success(result,{opened:process.platform==='win32',path})
  expect(h.mkdir).toHaveBeenCalledExactlyOnceWith(target==='env'?fakePaths.DATA:path,{recursive:true})
  if(target==='env')expect(h.writeFile).toHaveBeenCalledWith(path,expect.stringContaining('WECHAT_APPSECRET=\n'),{encoding:'utf8',flag:'wx'})
  else expect(h.writeFile).not.toHaveBeenCalled()
  if(process.platform==='win32'){expect(h.spawn).toHaveBeenCalledExactlyOnceWith(target==='env'?'notepad.exe':'explorer.exe',[path],{detached:true,stdio:'ignore'});expect(unref).toHaveBeenCalledOnce()}
  else expect(h.spawn).not.toHaveBeenCalled()
})
it('does not recreate an existing env receipt and reports the actual configured port',async()=>{
  h.exists.mockReturnValue(true);h.mkdir.mockResolvedValue(undefined);h.spawn.mockReturnValue({unref:vi.fn()})
  await invoke('post','/api/app/open',{body:{target:'env'}})
  expect(h.writeFile).not.toHaveBeenCalled()
  createApp({port:()=>12345});const info=await invoke('get','/api/app/info')
  expect(info.body).toMatchObject({port:12345,envExists:true})
})
it('uses empty draft configuration defaults without inventing an enabled probe',async()=>{
  const profile={baseUrl:'',model:''};h.resolve.mockResolvedValue(profile);h.discover.mockResolvedValue([]);h.testConnection.mockResolvedValue(null)
  success(await invoke('post','/api/settings/ai/models',{body:undefined}),[])
  success(await invoke('post','/api/settings/ai/test',{body:undefined}),{ok:false,reply:null,ms:0})
  error(await invoke('post','/api/settings/ai/probe-effort',{body:undefined}),400,'接口地址')
  expect(h.resolve.mock.calls).toEqual([[{}],[{}],[{}]]);expect(h.probe).not.toHaveBeenCalled()
})
it('constructs explicit no-material defaults for outline, design and placement prompts',async()=>{
  h.chat.mockResolvedValue({receipt:true})
  for(const route of ['/api/ai/outline','/api/ai/design','/api/ai/place-photos'])success(await invoke('post',route,{body:route.endsWith('place-photos')?undefined:{}}),{receipt:true})
  expect(h.chat.mock.calls[0][1]).toMatch(/可用图片.*：无$/)
  expect(h.chat.mock.calls[1][1]).toContain('用户的风格要求：无，自行判断最适合该内容的风格')
  expect(h.chat.mock.calls[2][1]).toBe('段落：\n[]\n\n照片单元：\n[]\n\n可用版式（按照片张数）：\n{}')
})
it('distinguishes default copy writing from a prior draft that requests a default revision',async()=>{
  h.chat.mockResolvedValue({receipt:true})
  await invoke('post','/api/ai/copywrite',{body:undefined})
  const first=h.chat.mock.calls[0][1]
  expect(first).toContain('文风：自然真实的活动通讯');expect(first).toContain('正文约 1500–2000 字');expect(first).toContain('使用 2 级标题')
  expect(first).not.toContain('上一版文案')
  await invoke('post','/api/ai/copywrite',{body:{previous:'Original facts'}})
  expect(h.chat.mock.calls[1][1]).toContain('修改意见：换一种写法重新写，保留事实')
})
it('refuses absent enrichment material but preserves a note with unknown number and no grouping',async()=>{
  error(await invoke('post','/api/ai/enrich-copy',{body:undefined}),400,'没有照片描述')
  expect(h.chat).not.toHaveBeenCalled()
  h.chat.mockResolvedValue({receipt:true})
  await invoke('post','/api/ai/enrich-copy',{body:{photos:[{}, {note:'Visible note'}]}})
  expect(h.chat.mock.calls[0][1]).toContain('照片 ?：Visible note')
  expect(h.chat.mock.calls[0][1]).toContain('必须原样保留的句子：\n无')
})
it('translates an unexpected thrown value with a bounded default status through its actual error middleware',()=>{
  const translate=h.middleware.findLast(fn=>fn.length===4)!,res=response(),logging=vi.spyOn(console,'error').mockImplementation(()=>{})
  translate('synthetic failure',{},res,h.unsafe)
  error(res,500,'synthetic failure');expect(logging).toHaveBeenCalledExactlyOnceWith('synthetic failure')
})
