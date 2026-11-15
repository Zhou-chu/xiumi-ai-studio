import {afterEach,expect,it,vi} from 'vitest'
import {inspect} from 'node:util'
vi.mock('../../server/store',()=>({DATA:'unused-mocked-settings',readJson:async()=>({ai:{activeId:'',profiles:[]}}),writeJson:vi.fn()}))
import {fetchModels} from '../../server/aiModels'
import {resolveDraftProfile,type AiProfile} from '../../server/settings'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers()})
const profile=(apiKey:string):AiProfile=>({id:'draft',name:'fixture',provider:'openai',apiKey,baseUrl:'https://provider.invalid/v1',model:'fixture',jsonMode:false})
const key='SYNTHETIC_cred/with+"quoted"=value'
const echoes=[key,JSON.stringify(key).slice(1,-1),encodeURIComponent(key)]
const assertSafe=(error:unknown)=>{const value=inspect(error,{depth:8})+JSON.stringify(error);for(const echo of echoes)expect(value).not.toContain(echo);expect(String(error)).toContain('***')}
it.each(echoes)('protects real draft resolution through model discovery error: %s',async echo=>{
 vi.stubEnv('AI_API_KEY','');const draft=await resolveDraftProfile(profile(key))
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:'upstream says '+echo}}),{status:401}))
 const error=await fetchModels(draft,fetcher as typeof fetch).catch(error=>error)
 expect(error).toMatchObject({status:502});assertSafe(error)
})
