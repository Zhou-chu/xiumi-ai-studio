import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiProfile } from '../../server/settings'

type FakeSettings = { ai?: { activeId: string; profiles: AiProfile[] } }
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), saved: {} as FakeSettings }))
vi.mock('../../server/store', () => ({ DATA: '/synthetic-settings-boundary', readJson: h.read, writeJson: h.write }))

import { allProfiles, cleanEffort, cleanExtraBody, getProfile, publicAiSettings, resolveDraftProfile, saveAiSettings } from '../../server/settings'

const profile = (patch: Partial<AiProfile> = {}): AiProfile => ({
  id:'alpha', name:'Fixture A', baseUrl:'https://fictional-settings.invalid/v1',
  apiKey:'fixture-not-a-real-secret-A', model:'synthetic-model-a', provider:'openai', jsonMode:true,
  reasoningEffort:'high', efforts:['low','high'], contextWindow:9000, maxOutputTokens:2000,
  extraBody:'{"fixtureMode":true}', ...patch,
})
const setProfiles = (activeId: string, profiles: AiProfile[]) => { h.saved = { ai:{ activeId, profiles } } }

beforeEach(() => {
  h.saved = {}
  h.read.mockReset().mockImplementation(async () => structuredClone(h.saved))
  h.write.mockReset().mockImplementation(async (_path: string, value: FakeSettings) => { h.saved = structuredClone(value) })
  for (const name of ['AI_API_KEY','AI_PROVIDER','AI_BASE_URL','AI_MODEL']) vi.stubEnv(name,undefined)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected settings transport') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('reports empty settings when no saved profiles or explicit environment key exist', async () => {
  expect(await allProfiles()).toEqual([])
  expect(await getProfile()).toBeNull()
  expect(await publicAiSettings()).toEqual({ activeId:'', profiles:[] })
  expect(h.write).not.toHaveBeenCalled()
})

it.each(['anthropic', 'Other'])('offers a readonly synthetic environment profile with the valid default for %s', async setting => {
  vi.stubEnv('AI_API_KEY','fixture-env-not-a-real-key')
  vi.stubEnv('AI_PROVIDER',setting)
  const saved = profile()
  setProfiles(saved.id,[saved])
  const out = await publicAiSettings()
  expect(out.activeId).toBe(saved.id)
  expect(out.profiles.map(p => [p.id,p.readonly,p.hasKey])).toEqual([['env',true,true],[saved.id,false,true]])
  expect(out.profiles[0]).toMatchObject({
    provider: setting==='anthropic'?'anthropic':'openai',
    baseUrl: setting==='anthropic'?'https://api.anthropic.com':'https://api.deepseek.com/v1',
    apiKey: expect.stringContaining('••••••'),
  })
  expect(out.profiles[0].model).toBe('')
  expect(await getProfile()).toEqual(saved)
  expect((await getProfile('env'))?.apiKey).toBe('fixture-env-not-a-real-key')
  expect(h.write).not.toHaveBeenCalled()
})

it('uses the first safe saved profile for public display when the active ID is absent', async () => {
  const a = profile({apiKey:''})
  const b = profile({id:'beta', name:'Fixture B'})
  setProfiles('missing',[a,b])
  const out=await publicAiSettings()
  expect(out.activeId).toBe(a.id)
  expect(out.profiles[0]).toMatchObject({ id:a.id, hasKey:false, apiKey:'' })
  expect(out.profiles[1].apiKey).toBe('fix••••••et-A')
  expect(await getProfile('beta')).toEqual(b)
})

it('refuses to copy a stored credential into a changed origin, port, scheme or provider', async () => {
  const saved=profile()
  setProfiles(saved.id,[saved])
  const masked=(await publicAiSettings()).profiles[0]
  for (const patch of [
    {baseUrl:'https://another-fixture.invalid/v1'},
    {baseUrl:'https://fictional-settings.invalid:8443/v1'},
    {baseUrl:'http://fictional-settings.invalid/v1'},
    {baseUrl:'not a URL'},
    {provider:'anthropic' as const},
  ]) await expect(resolveDraftProfile({...masked,...patch})).rejects.toMatchObject({status:400})
  await expect(saveAiSettings({activeId:saved.id,profiles:[{...masked,baseUrl:'https://another-fixture.invalid/v1'}]})).rejects.toMatchObject({status:400})
  expect(h.write).not.toHaveBeenCalled()
  expect(h.saved.ai?.profiles[0]).toEqual(saved)
})

it('preserves a masked key only against its saved same-origin identity and drops stale model-specific parameters', async () => {
  const saved=profile()
  setProfiles(saved.id,[saved])
  const masked=(await publicAiSettings()).profiles[0]
  expect(await resolveDraftProfile({id:saved.id})).toMatchObject({...saved,name:''})
  const changed=await resolveDraftProfile({id:saved.id,apiKey:masked.apiKey,baseUrl:'https://fictional-settings.invalid/subpath/',model:'new'})
  expect(changed).toMatchObject({apiKey:saved.apiKey,baseUrl:'https://fictional-settings.invalid/subpath',model:'new',reasoningEffort:'',efforts:[],contextWindow:0,maxOutputTokens:0,extraBody:''})
  expect(await resolveDraftProfile({id:saved.id,baseUrl:'https://another-fixture.invalid',apiKey:' fixture-new-credential '})).toMatchObject({apiKey:'fixture-new-credential'})
  expect(await resolveDraftProfile({id:saved.id,apiKey:''})).toMatchObject({apiKey:''})
})

it('drops readonly input and persists only sanitized profile values through the fake store', async () => {
  const out=await saveAiSettings({activeId:'valid-id',profiles:[
    profile({id:'env'}),
    profile({id:'valid-id',name:'超'.repeat(50),provider:'anthropic',apiKey:' ',model:' model ',baseUrl:' https://fictional-settings.invalid/v1/// ',reasoningEffort:' HiGH ',efforts:['Low','low','Custom_A','bad value'],contextWindow:100000500,maxOutputTokens:17.8,extraBody:'{ "fixture" : 1 }'}),
    {id:'invalid ID with spaces', extraBody:'[1,2]', maxOutputTokens:Infinity, jsonMode:false},
  ]})
  expect(h.write).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/synthetic-settings-boundary.*settings\.json$/),expect.any(Object))
  expect(out.profiles).toHaveLength(2)
  expect(out.activeId).toBe('valid-id')
  expect(out.profiles[0]).toMatchObject({id:'valid-id',name:'超'.repeat(40),apiKey:'',hasKey:false,provider:'anthropic',model:'model',baseUrl:'https://fictional-settings.invalid/v1',reasoningEffort:'high',efforts:['low','Custom_A'],contextWindow:100000000,maxOutputTokens:17,extraBody:'{"fixture":1}'})
  expect(out.profiles[1]).toMatchObject({id:expect.stringMatching(/^\w{8}$/),name:'未命名模型',jsonMode:false,extraBody:'',maxOutputTokens:0})
})

it('accepts only safe effort identifiers and plain JSON-object options', () => {
  expect([undefined,'   ','hyphen space',' HIGh ',' Provider_Custom ', 'x'.repeat(41)].map(cleanEffort)).toEqual(['','','','high','Provider_Custom',''])
  expect([undefined,'','null','[]','false','invalid','{ "fixture" : false }'].map(cleanExtraBody)).toEqual(['','','','','','','{"fixture":false}'])
})

it.each([1,3,7,8])('redacts synthetic %i-character credentials in public saved and environment profiles', async length => {
  const mask='••••••'
  const fixture='QbCxYdPe'.slice(0,length)
  const saved=profile({apiKey:fixture})
  setProfiles(saved.id,[saved])
  vi.stubEnv('AI_API_KEY',fixture)
  const view=await publicAiSettings()
  const expected=length<=7?mask:fixture.slice(0,3)+mask+fixture.slice(-4)
  expect(view.profiles.map(p=>[p.id,p.apiKey,p.hasKey])).toEqual([['env',expected,true],[saved.id,expected,true]])
  // A masked value can still identify "unchanged" instead of erasing the saved credential.
  const again=await saveAiSettings({activeId:saved.id,profiles:[view.profiles[1]]})
  expect(again.profiles[1].apiKey).toBe(expected)
  expect((await getProfile(saved.id))?.apiKey).toBe(fixture)
})
