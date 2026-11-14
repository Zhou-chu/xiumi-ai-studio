// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest'
import {copyRichText} from '../../src/editor/wechatOutput'
afterEach(()=>{vi.unstubAllGlobals();Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})})
it('propagates failed compilation without unhandled fallback branches',async()=>{
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})
 await expect(copyRichText(Promise.reject(new Error('Image compilation failed')))).rejects.toThrow('Image compilation failed')
})
it('preserves delayed compilation failure when clipboard rejects before consuming its promises',async()=>{
 vi.stubGlobal('ClipboardItem',class {constructor(public data:unknown){}})
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:vi.fn().mockRejectedValue(new Error('Denied'))}})
 let reject!:(e:Error)=>void
 const pending=new Promise<string>((_,r)=>{reject=r})
 const copied=copyRichText(pending)
 const assertion=expect(copied).rejects.toThrow('Original compilation failure')
 await Promise.resolve()
 reject(new Error('Original compilation failure'))
 await assertion
})
