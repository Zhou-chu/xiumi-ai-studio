// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {AiSettingsModal} from '../../src/editor/AiSettingsModal'
import {api} from '../../src/editor/api'
vi.mock('../../src/editor/api',()=>({api:{aiSettings:vi.fn(),aiModels:vi.fn(),testAi:vi.fn(),probeEffort:vi.fn(),saveAiSettings:vi.fn()}}))
let root:Root,host:HTMLDivElement
beforeEach(async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();vi.mocked(api.aiSettings).mockResolvedValue({activeId:'p',profiles:[{id:'p',name:'Profile',provider:'openai',baseUrl:'https://api.example.test/v1',apiKey:'',hasKey:true,model:'model',jsonMode:true,contextWindow:128000,maxOutputTokens:8192,reasoningEffort:'high',efforts:['high'],extraBody:'{"feature":true}'}]});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<AiSettingsModal onClose={()=>{}}/>));await act(async()=>host.querySelector<HTMLButtonElement>('.ai-profile-edit')!.click())
})
afterEach(()=>{act(()=>root.unmount());host.remove()})
const input=(id:string)=>host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!
const url=()=>host.querySelector<HTMLInputElement>('input[placeholder="https://…/v1"]')!
const key=()=>host.querySelector<HTMLInputElement>('input[type="password"]')!
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!
const change=(el:HTMLInputElement,value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})
const retained=()=>{expect(input('ai-context').value).toBe('128000');expect(input('ai-max-output').value).toBe('8192');expect(input('ai-effort').value).toBe('high')}
const cleared=()=>{expect(input('ai-context').value).toBe('');expect(input('ai-max-output').value).toBe('');expect(input('ai-effort').value).toBe('')}
it.each(['https://api.example.test/v1/','https://API.EXAMPLE.TEST:443/custom/path?x=1'])('retains manual parameters for the same normalized origin: %s',address=>{change(url(),address);retained()})
it('retains parameters for a key replacement but invalidates old discovery',async()=>{
 let finish!:(x:any)=>void;vi.mocked(api.aiModels).mockReturnValue(new Promise(resolve=>finish=resolve));await act(async()=>button('从服务商获取模型列表').click());change(key(),'synthetic-new-key');retained();await act(async()=>finish([{id:'stale-model',contextWindow:1}]));expect(host.textContent).not.toContain('stale-model')
})
it('keeps invalid intermediate input local, then recovers the same origin without losing settings or typed key',()=>{
 change(key(),'synthetic-new-key');change(url(),'https://');retained();expect(button('测试连接').disabled).toBe(true);expect(button('从服务商获取模型列表').disabled).toBe(true);expect(button('检测支持的强度').disabled).toBe(true);expect(button('保存').disabled).toBe(true);expect(api.testAi).not.toHaveBeenCalled();change(url(),'https://api.example.test/other');retained();expect(key().value).toBe('synthetic-new-key');expect(button('测试连接').disabled).toBe(false)
})
it('clears parameters and typed credential when an invalid draft becomes a different origin',()=>{
 change(key(),'synthetic-new-key');change(url(),'https://');change(url(),'https://other.example.test/v1');cleared();expect(key().value).toBe('');expect(key().placeholder).not.toContain('已保存');expect(input('ai-model').value).toBe('model');expect(host.querySelector<HTMLTextAreaElement>('[data-testid="ai-extra-body"]')!.value).toBe('{"feature":true}')
})
it('clears metadata and credential on interface changes but not repeated selection of the same interface',()=>{
 change(key(),'synthetic-new-key');act(()=>button('OpenAI 兼容').click());retained();expect(key().value).toBe('synthetic-new-key');act(()=>button('Anthropic Claude').click());cleared();expect(key().value).toBe('')
})
it('does not apply a late same-origin-path discovery response',async()=>{
 let finish!:(x:any)=>void;vi.mocked(api.aiModels).mockReturnValue(new Promise(resolve=>finish=resolve));await act(async()=>button('从服务商获取模型列表').click());change(url(),'https://api.example.test/v2');retained();await act(async()=>finish([{id:'model',contextWindow:7}]));retained();expect(host.querySelector('[data-testid="ai-model-picker"]')).toBeNull()
})

it.each(['https://','ftp://api.example.test','https://user:pass@api.example.test'])('blocks provider requests for invalid or credential-bearing URL draft %s',address=>{
 change(url(),address);retained();expect(button('测试连接').disabled).toBe(true);expect(button('从服务商获取模型列表').disabled).toBe(true);act(()=>button('测试连接').click());expect(api.testAi).not.toHaveBeenCalled()
})
it('keeps saved-key reference blank and preserves same-origin settings in the dispatched draft',async()=>{
 vi.mocked(api.testAi).mockResolvedValue({ok:true,ms:1,reply:{}});change(url(),'https://api.example.test/v2/');await act(async()=>button('测试连接').click());expect(api.testAi).toHaveBeenCalledWith(expect.objectContaining({id:'p',baseUrl:'https://api.example.test/v2/',apiKey:'',contextWindow:128000,reasoningEffort:'high'}))
})

it.each(['http://api.example.test/v1','https://api.example.test:8443/v1','https://another.example.test/v1'])('treats scheme, port or host changes as a new credential origin: %s',address=>{
 change(key(),'synthetic-new-key');change(url(),address);cleared();expect(key().value).toBe('')
})
