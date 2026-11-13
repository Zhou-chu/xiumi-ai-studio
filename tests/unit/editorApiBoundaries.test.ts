// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {api,ApiError,assetRef,type AiProfile} from '../../src/editor/api'
import {emptyDoc} from '../../src/editor/store'
import {THEMES} from '../../src/core/themes'
import {makeDraft} from '../../src/core/components'
import {createBlock} from '../../src/core/blocks'
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({receipt:'ok'})}))})
afterEach(()=>vi.unstubAllGlobals())
const profile:AiProfile={id:'p',name:'Local',provider:'openai',baseUrl:'https://example.test',apiKey:'',model:'model',jsonMode:true}
it('serializes every JSON route with exact methods, paths and bodies',async()=>{
 const doc={...emptyDoc(),id:'doc'},block=createBlock('paragraph'),theme=THEMES[0]
 const draft=makeDraft({name:'Saved',block,source:{kind:'original',title:'Original',url:'',account:''},via:'block',attested:true})
 const cases:[()=>Promise<unknown>,string,string,unknown?][]=[
 [()=>api.assets(),'GET','/api/assets'],[()=>api.cropAsset('a',{x:1,y:2,width:3,height:4}),'POST','/api/assets/a/crop',{x:1,y:2,width:3,height:4}], [()=>api.deleteAsset('a'),'DELETE','/api/assets/a'],[()=>api.loadSample(),'POST','/api/samples/load'],
 [()=>api.projects(),'GET','/api/projects'],[()=>api.project('doc'),'GET','/api/projects/doc'],[()=>api.saveProject(doc),'PUT','/api/projects/doc',doc],[()=>api.deleteProject('doc'),'DELETE','/api/projects/doc'],[()=>api.versions('doc'),'GET','/api/projects/doc/versions'],[()=>api.saveVersion(doc,'checkpoint'),'POST','/api/projects/doc/versions',{doc,label:'checkpoint'}],[()=>api.version('doc','v'),'GET','/api/projects/doc/versions/v'],
 [()=>api.templates(),'GET','/api/templates'],[()=>api.saveTemplate('New',[block]),'POST','/api/templates',{name:'New',blocks:[block]}],[()=>api.saveTemplate('Theme',[block],doc),'POST','/api/templates',{name:'Theme',blocks:[block],themeId:doc.themeId,themeOverrides:doc.themeOverrides}],[()=>api.deleteTemplate('t'),'DELETE','/api/templates/t'],[()=>api.updateTemplate('t',{name:'Renamed'}),'PUT','/api/templates/t',{name:'Renamed'}],
 [()=>api.components(),'GET','/api/components'],[()=>api.saveComponent(draft),'POST','/api/components',draft],[()=>api.updateComponent('c',{tags:['tag']}),'PUT','/api/components/c',{tags:['tag']}],[()=>api.deleteComponent('c'),'DELETE','/api/components/c'],[()=>api.themes(),'GET','/api/themes'],[()=>api.saveTheme(theme),'POST','/api/themes',theme],[()=>api.deleteTheme('t'),'DELETE','/api/themes/t'],
 [()=>api.aiStatus(),'GET','/api/ai/status'],[()=>api.aiSettings(),'GET','/api/settings/ai'],[()=>api.saveAiSettings({activeId:'p',profiles:[profile]}),'PUT','/api/settings/ai',{activeId:'p',profiles:[profile]}],[()=>api.testAi(profile),'POST','/api/settings/ai/test',profile],[()=>api.probeEffort(profile),'POST','/api/settings/ai/probe-effort',profile],
 [()=>api.aiOutline('Body',['photo']),'POST','/api/ai/outline',{text:'Body',imageNames:['photo'],imageNotes:[]}],[()=>api.aiOutline('Body',[],['notes'],'p'),'POST','/api/ai/outline',{text:'Body',imageNames:[],imageNotes:['notes'],profileId:'p'}],[()=>api.aiDesign({title:'Brief'},'hint','p'),'POST','/api/ai/design',{brief:{title:'Brief'},hint:'hint',profileId:'p'}],
 [()=>api.aiCopywrite({brief:'b',style:'s',length:'short',levels:1,extra:'e'}),'POST','/api/ai/copywrite',{brief:'b',style:'s',length:'short',levels:1,extra:'e'}],[()=>api.aiEnrichCopy({text:'t',photos:[],keep:['intro']}),'POST','/api/ai/enrich-copy',{text:'t',photos:[],keep:['intro']}],[()=>api.aiPlacePhotos({photos:[]}),'POST','/api/ai/place-photos',{photos:[]}],
 [()=>api.aiSuggestInstruction({id:'c'},'p',['a','b']),'POST','/api/ai/suggest-instruction',{context:{id:'c'},profileId:'p',selectedId:['a','b']}],[()=>api.aiEdit({id:'c'},'fix','p','a'),'POST','/api/ai/edit',{context:{id:'c'},instruction:'fix',profileId:'p',selectedId:'a'}],
 [()=>api.fetchReference('https://example.test/ref'),'POST','/api/reference/fetch',{url:'https://example.test/ref'}],[()=>api.fetchArticle('https://example.test/article'),'POST','/api/article/fetch',{url:'https://example.test/article'}],[()=>api.importArticleImages(['https://example.test/image']),'POST','/api/assets/import-article',{urls:['https://example.test/image']}],[()=>api.fetchAssets(['/media/a']),'POST','/api/assets/fetch',{urls:['/media/a']}],
 [()=>api.wechatStatus(),'GET','/api/wechat/status'],[()=>api.wechatUploadImages(['/media/a']),'POST','/api/wechat/upload-images',{urls:['/media/a']}],[()=>api.wechatDraft({title:'t',author:'a',digest:'d',html:'<p>Body</p>',cover:'c',confirm:true}),'POST','/api/wechat/draft',{title:'t',author:'a',digest:'d',html:'<p>Body</p>',cover:'c',confirm:true}],
 ]
 for(const [call,method,url,body] of cases){
  expect(await call()).toEqual({receipt:'ok'})
  const expected:RequestInit={method};if(body!==undefined){expected.body=JSON.stringify(body);expected.headers={'content-type':'application/json'}}
  expect(fetch).toHaveBeenLastCalledWith(url,expected)
 }
})
it('uploads actual multipart file objects without forcing a content-type boundary',async()=>{
 const files=[new File(['one'],'one.txt'),new File(['two'],'two.txt')]
 await api.uploadAssets(files)
 let [url,init]=vi.mocked(fetch).mock.calls.at(-1)!
 expect(url).toBe('/api/assets');expect(init?.headers).toBeUndefined();expect((init?.body as FormData).getAll('files')).toEqual(files)
 await api.importFile(files[0]);[url,init]=vi.mocked(fetch).mock.calls.at(-1)!
 expect(url).toBe('/api/import');expect((init?.body as FormData).get('file')).toBe(files[0])
 expect(assetRef({id:'a',file:'a.png',name:'Caption',width:12,height:34,size:1,createdAt:1})).toEqual({src:'/media/a.png',assetId:'a',alt:'Caption',width:12,height:34})
})
it('preserves status and useful errors without treating failed or aborted JSON as empty success',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:409,statusText:'Conflict',json:async()=>({error:'Stale revision'})} as Response)
 await expect(api.saveProject(emptyDoc())).rejects.toMatchObject({status:409,message:'Stale revision'})
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:502,statusText:'Bad Gateway',json:async()=>{throw new SyntaxError('HTML response')}} as unknown as Response)
 await expect(api.projects()).rejects.toEqual(new ApiError('502 Bad Gateway',502))
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:503,statusText:'Unavailable',json:async()=>({})} as Response)
 await expect(api.projects()).rejects.toMatchObject({status:503,message:'503 Unavailable'})
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>{throw new DOMException('Aborted','AbortError')}} as unknown as Response)
 await expect(api.projects()).rejects.toMatchObject({name:'AbortError'})
 vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network offline'));await expect(api.project('x')).rejects.toThrow('Network offline')
})
it('accepts model arrays and wrapped arrays, rejecting malformed lists',async()=>{
 for(const result of [[{id:'one'}],{models:[{id:'one'}]}]){vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>result} as Response);expect(await api.aiModels(profile)).toEqual([{id:'one'}])}
 for(const result of [null,{}, {models:'wrong'}]){vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>result} as Response);await expect(api.aiModels(profile)).rejects.toThrow()}
})
