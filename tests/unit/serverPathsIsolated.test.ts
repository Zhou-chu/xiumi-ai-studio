import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import { join, resolve } from 'node:path'

const h=vi.hoisted(()=>({has:vi.fn<(path:string)=>boolean>(),home:vi.fn<()=>string>()}))
vi.mock('node:fs',()=>({existsSync:h.has}))
vi.mock('node:os',()=>({homedir:h.home}))
const paths=()=>import('../../server/paths')
const resources=resolve('/virtual-resources'), sourceEnv=join(resources,'.env'), fallback=join(resources,'data')
const local=resolve('/virtual-local'), appData=resolve('/virtual-profile/Roaming'), home=resolve('/virtual-home')
const envKeys=['XIUMI_PACKAGED','XIUMI_RESOURCES','XIUMI_SKIP_ENV_FILES','XIUMI_DATA_DIR','DATA_DIR','LOCALAPPDATA','APPDATA','AI_MODEL'] as const
let load: MockInstance<typeof process.loadEnvFile>
const virtual=new Map<string,Partial<Record<typeof envKeys[number],string>>>()
const seed=(path:string,vars:Partial<Record<typeof envKeys[number],string>>)=>virtual.set(path,vars)
beforeEach(()=>{
 vi.resetModules()
 for(const k of envKeys)vi.stubEnv(k,undefined)
 vi.stubEnv('XIUMI_RESOURCES',resources)
 virtual.clear()
 h.has.mockReset().mockImplementation(path=>virtual.has(path))
 h.home.mockReset().mockReturnValue(home)
 load=vi.spyOn(process,'loadEnvFile').mockImplementation(file=>{
  const values=virtual.get(String(file))
  if(!values)throw Error('Unexpected configuration fixture read')
  for(const [k,v] of Object.entries(values))if(process.env[k]===undefined)process.env[k]=v
 })
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()})

it('loads repository config before choosing data and reads only the resulting data configuration',async()=>{
 const custom=resolve('/virtual-new-data'), env=join(custom,'.env')
 seed(sourceEnv,{DATA_DIR:custom,AI_MODEL:'repo choice'})
 seed(env,{AI_MODEL:'data choice'})
 const cfg=await paths()
 expect(cfg.PACKAGED).toBe(false);expect(cfg.ROOT).toBe(resources);expect(cfg.DATA).toBe(custom)
 expect(cfg.DATA_ENV).toBe(env);expect(cfg.LOG_DIR).toBe(join(custom,'logs'));expect(cfg.TMP_DIR).toBe(join(custom,'tmp'))
 expect(cfg.loadedEnvFiles).toEqual([sourceEnv,env])
 expect(load.mock.calls).toEqual([[sourceEnv],[env]])
 expect(process.env.AI_MODEL).toBe('repo choice')
})

it('honors explicit data and process choices ahead of both virtual dotenv layers',async()=>{
 const explicit=resolve('/virtual-explicit'), env=join(explicit,'.env')
 vi.stubEnv('XIUMI_DATA_DIR',explicit);vi.stubEnv('DATA_DIR','/ignored');vi.stubEnv('AI_MODEL','process choice')
 seed(sourceEnv,{DATA_DIR:'/different',AI_MODEL:'repo choice'});seed(env,{AI_MODEL:'data choice'})
 const cfg=await paths()
 expect(cfg.DATA).toBe(explicit);expect(cfg.loadedEnvFiles).toEqual([sourceEnv,env])
 expect(process.env.AI_MODEL).toBe('process choice')
})

it('uses local app data for packaged mode without checking application resources for .env',async()=>{
 vi.stubEnv('XIUMI_PACKAGED','1');vi.stubEnv('LOCALAPPDATA',local)
 const data=join(local,'XIUMI AI Studio'), env=join(data,'.env')
 seed(sourceEnv,{AI_MODEL:'must not load'});seed(env,{AI_MODEL:'fixture'})
 const cfg=await paths()
 expect(cfg.PACKAGED).toBe(true);expect(cfg.DATA).toBe(data);expect(cfg.loadedEnvFiles).toEqual([env])
 expect(h.has).toHaveBeenCalledExactlyOnceWith(env)
 expect(load).toHaveBeenCalledExactlyOnceWith(env)
})

it('derives Windows-style fallback paths from AppData and home without using the real profile',async()=>{
 vi.stubEnv('XIUMI_SKIP_ENV_FILES','1')
 const {defaultUserDataDir}=await paths()
 expect(defaultUserDataDir({LOCALAPPDATA:local,APPDATA:appData})).toBe(join(local,'XIUMI AI Studio'))
 expect(defaultUserDataDir({APPDATA:appData})).toBe(join(appData,'..','Local','XIUMI AI Studio'))
 expect(defaultUserDataDir({})).toBe(join(home,'AppData','Local','XIUMI AI Studio'))
 expect(h.home).toHaveBeenCalledOnce()
 expect(h.has).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled()
})

it('skips virtual .env entirely when explicitly disabled and retains the source default',async()=>{
 vi.stubEnv('XIUMI_SKIP_ENV_FILES','1')
 seed(sourceEnv,{DATA_DIR:'/virtual-should-not-read'});seed(join(fallback,'.env'),{AI_MODEL:'skip'})
 const cfg=await paths()
 expect(cfg.DATA).toBe(fallback);expect(cfg.loadedEnvFiles).toEqual([])
 expect(h.has).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled()
})

it('reports a failed configuration read without recording it or blocking later data files',async()=>{
 const message=vi.spyOn(console,'error').mockImplementation(()=>{})
 seed(sourceEnv,{})
 const dataEnv=join(fallback,'.env');seed(dataEnv,{AI_MODEL:'continues'})
 load.mockImplementationOnce(()=>{throw Error('synthetic input failure')})
 const cfg=await paths()
 expect(cfg.loadedEnvFiles).toEqual([dataEnv])
 expect(message).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('synthetic input failure'))
 expect(process.env.AI_MODEL).toBe('continues')
})
