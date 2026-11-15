import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { api, assetRef, type AiProfile } from '../../src/editor/api'
import type { Doc } from '../../src/core/types'
const doc:Doc={id:'draft-id',revision:'opaque-revision',title:'合成稿',author:'作者',digest:'摘要',themeId:'fixture',blocks:[],createdAt:1,updatedAt:2}
const profile:AiProfile={id:'profile',name:'合成模型',provider:'openai',baseUrl:'https://fixture.invalid',model:'model',apiKey:'synthetic-not-real',jsonMode:true}
const context={blocks:[{id:'one'}]}
const ids=['one','two']
const fetcher=vi.fn<typeof fetch>()
const reply={opaque:'synthetic-reply'}
beforeEach(()=>{fetcher.mockReset().mockImplementation(async()=>Response.json(reply));vi.stubGlobal('fetch',fetcher)})
afterEach(()=>vi.unstubAllGlobals())
type Case={name:string;call:()=>Promise<unknown>;method:string;url:string;body?:unknown}
const copy={brief:'活动',style:'简洁',length:'短',levels:2,extra:'保持事实',previous:'原稿',revise:'缩短',profileId:profile.id}
const enriched={text:'正文',photos:[{no:1,note:'描述'}],keep:['原句'],profileId:profile.id}
const draft={title:'标题',author:'作者',digest:'摘要',html:'<p>文稿</p>',cover:'/media/fixture.png',confirm:true as const}
const cases:Case[]=[
 {name:'assets',call:()=>api.assets(),method:'GET',url:'/api/assets'},
 {name:'asset crop',call:()=>api.cropAsset('asset',{x:1,y:2,width:3,height:4}),method:'POST',url:'/api/assets/asset/crop',body:{x:1,y:2,width:3,height:4}},
 {name:'asset delete',call:()=>api.deleteAsset('asset'),method:'DELETE',url:'/api/assets/asset'},
 {name:'sample',call:()=>api.loadSample(),method:'POST',url:'/api/samples/load'},
 {name:'project',call:()=>api.project(doc.id),method:'GET',url:'/api/projects/draft-id'},
 {name:'save preserves revision',call:()=>api.saveProject(doc),method:'PUT',url:'/api/projects/draft-id',body:doc},
 {name:'version list',call:()=>api.versions(doc.id),method:'GET',url:'/api/projects/draft-id/versions'},
 {name:'snapshot',call:()=>api.saveVersion(doc,'手动版本'),method:'POST',url:'/api/projects/draft-id/versions',body:{doc,label:'手动版本'}},
 {name:'version read',call:()=>api.version(doc.id,'version-id'),method:'GET',url:'/api/projects/draft-id/versions/version-id'},
 {name:'templates',call:()=>api.templates(),method:'GET',url:'/api/templates'},
 {name:'template optional theme',call:()=>api.saveTemplate('名字',[]),method:'POST',url:'/api/templates',body:{name:'名字',blocks:[]}},
 {name:'template theme',call:()=>api.saveTemplate('名字',[],{themeId:'theme',themeOverrides:{fontSize:17}}),method:'POST',url:'/api/templates',body:{name:'名字',blocks:[],themeId:'theme',themeOverrides:{fontSize:17}}},
 {name:'template delete',call:()=>api.deleteTemplate('template'),method:'DELETE',url:'/api/templates/template'},
 {name:'template update',call:()=>api.updateTemplate('template',{name:'新名',roles:{one:'h1'}}),method:'PUT',url:'/api/templates/template',body:{name:'新名',roles:{one:'h1'}}},
 {name:'components',call:()=>api.components(),method:'GET',url:'/api/components'},
 {name:'component update',call:()=>api.updateComponent('component',{name:'新名',tags:['标签'],role:'body'}),method:'PUT',url:'/api/components/component',body:{name:'新名',tags:['标签'],role:'body'}},
 {name:'component delete',call:()=>api.deleteComponent('component'),method:'DELETE',url:'/api/components/component'},
 {name:'themes',call:()=>api.themes(),method:'GET',url:'/api/themes'},
 {name:'theme delete',call:()=>api.deleteTheme('theme'),method:'DELETE',url:'/api/themes/theme'},
 {name:'AI status',call:()=>api.aiStatus(),method:'GET',url:'/api/ai/status'},
 {name:'AI settings',call:()=>api.aiSettings(),method:'GET',url:'/api/settings/ai'},
 {name:'AI save',call:()=>api.saveAiSettings({activeId:profile.id,profiles:[profile]}),method:'PUT',url:'/api/settings/ai',body:{activeId:profile.id,profiles:[profile]}},
 {name:'AI connection',call:()=>api.testAi(profile),method:'POST',url:'/api/settings/ai/test',body:profile},
 {name:'effort',call:()=>api.probeEffort(profile),method:'POST',url:'/api/settings/ai/probe-effort',body:profile},
 {name:'outline defaults',call:()=>api.aiOutline('正文',['图']),method:'POST',url:'/api/ai/outline',body:{text:'正文',imageNames:['图'],imageNotes:[]}},
 {name:'outline options',call:()=>api.aiOutline('正文',['图'],['备注'],profile.id),method:'POST',url:'/api/ai/outline',body:{text:'正文',imageNames:['图'],imageNotes:['备注'],profileId:profile.id}},
 {name:'design',call:()=>api.aiDesign({title:'题'},'提示',profile.id),method:'POST',url:'/api/ai/design',body:{brief:{title:'题'},hint:'提示',profileId:profile.id}},
 {name:'copy revision',call:()=>api.aiCopywrite(copy),method:'POST',url:'/api/ai/copywrite',body:copy},
 {name:'photo enrichment',call:()=>api.aiEnrichCopy(enriched),method:'POST',url:'/api/ai/enrich-copy',body:enriched},
 {name:'explicit draft confirmation',call:()=>api.wechatDraft(draft),method:'POST',url:'/api/wechat/draft',body:draft},
 {name:'placement',call:()=>api.aiPlacePhotos({units:['组']}),method:'POST',url:'/api/ai/place-photos',body:{units:['组']}},
 {name:'edit multi scope',call:()=>api.aiEdit(context,'修改',profile.id,'one',ids),method:'POST',url:'/api/ai/edit',body:{context,instruction:'修改',profileId:profile.id,selectedId:'one',selectedIds:ids}},
 {name:'reference',call:()=>api.fetchReference('https://fixture.invalid/ref'),method:'POST',url:'/api/reference/fetch',body:{url:'https://fixture.invalid/ref'}},
 {name:'article',call:()=>api.fetchArticle('https://fixture.invalid/article'),method:'POST',url:'/api/article/fetch',body:{url:'https://fixture.invalid/article'}},
 {name:'collect images',call:()=>api.importArticleImages(['https://fixture.invalid/a.png']),method:'POST',url:'/api/assets/import-article',body:{urls:['https://fixture.invalid/a.png']}},
 {name:'fetch images',call:()=>api.fetchAssets(['https://fixture.invalid/a.png']),method:'POST',url:'/api/assets/fetch',body:{urls:['https://fixture.invalid/a.png']}},
 {name:'app info',call:()=>api.appInfo(),method:'GET',url:'/api/app/info'},
 {name:'open folder',call:()=>api.openFolder('logs'),method:'POST',url:'/api/app/open',body:{target:'logs'}},
 {name:'quit',call:()=>api.quit(),method:'POST',url:'/api/app/quit',body:{}},
 {name:'apply restore',call:()=>api.restoreApply('token'),method:'POST',url:'/api/data/restore/token/apply',body:{}},
 {name:'migration preview',call:()=>api.migratePreview('/fixture/legacy'),method:'POST',url:'/api/data/migrate/preview',body:{path:'/fixture/legacy'}},
 {name:'migration apply',call:()=>api.migrateApply('/fixture/legacy'),method:'POST',url:'/api/data/migrate/apply',body:{path:'/fixture/legacy'}},
 {name:'wechat status',call:()=>api.wechatStatus(),method:'GET',url:'/api/wechat/status'},
 {name:'wechat images',call:()=>api.wechatUploadImages(['https://fixture.invalid/a.png']),method:'POST',url:'/api/wechat/upload-images',body:{urls:['https://fixture.invalid/a.png']}},
 {name:'glyphs',call:()=>api.replayGlyphs(['data:image/png;base64,fixture']),method:'POST',url:'/api/replay/glyphs',body:{images:['data:image/png;base64,fixture']}},
]
it.each(cases)('$name keeps the exact wire contract without invoking an actual service',async ({call,method,url,body})=>{
 expect(await call()).toEqual(reply)
 expect(fetcher).toHaveBeenCalledExactlyOnceWith(url,body===undefined?{method}:{method,body:JSON.stringify(body),headers:{'content-type':'application/json'}})
})
it('passes the caller cancellation identity together with both selection forms',async()=>{
 const signal=new AbortController().signal
 expect(await api.aiSuggestInstruction(context,profile.id,'one',signal,ids)).toEqual(reply)
 expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/ai/suggest-instruction',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({context,profileId:profile.id,selectedId:'one',selectedIds:ids})})
})
it.each(['uploadAssets','importFile','restoreUpload'] as const)('%s sends real in-memory multipart with the original file and no invented boundary header',async method=>{
 const file=new File(['合成文件'], '图像.png',{type:'image/png'})
 const second=new File(['other'],'other.txt',{type:'text/plain'})
 const value=method==='uploadAssets'?api.uploadAssets([file,second]):api[method](file)
 expect(await value).toEqual(reply)
 const [url,init]=fetcher.mock.calls[0]
 expect(url).toBe(method==='uploadAssets'?'/api/assets':method==='importFile'?'/api/import':'/api/data/restore')
 expect(init?.method).toBe('POST');expect(init?.headers).toBeUndefined()
 const data=init!.body as FormData
 expect([...data.keys()]).toEqual(method==='uploadAssets'?['files','files']:['file'])
 const sent=data.get(method==='uploadAssets'?'files':'file') as File
 expect(sent.name).toBe('图像.png');expect(await sent.text()).toBe('合成文件')
 if(method==='uploadAssets')expect((data.getAll('files')[1] as File).name).toBe('other.txt')
})
it('builds a document image reference without fetching or mutating the source asset',()=>{
 const asset={id:'asset',file:'photo.png',name:'说明',width:120,height:80,size:4,createdAt:1}
 expect(assetRef(asset)).toEqual({src:'/media/photo.png',assetId:'asset',alt:'说明',width:120,height:80})
 expect(asset).toEqual({id:'asset',file:'photo.png',name:'说明',width:120,height:80,size:4,createdAt:1});expect(fetcher).not.toHaveBeenCalled()
})
