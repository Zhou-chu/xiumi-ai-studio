// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {Toolbar} from '../../src/editor/Toolbar'
import {CoverDesigner} from '../../src/editor/CoverDesigner'
import {api} from '../../src/editor/api'
import {emptyDoc} from '../../src/editor/store'
import {setup,cleanup,mount,host,click,button,input,state,asset} from './libraryToolbarHarness'
beforeEach(()=>{setup();vi.spyOn(api,'versions').mockResolvedValue([])})
afterEach(cleanup)
const versions=async()=>{await mount(<Toolbar/>);await click(button('历史版本'));return button('保存当前为新版本')}
const context=()=>({fillRect:vi.fn(),fillText:vi.fn(),drawImage:vi.fn(),measureText:(text:string)=>({width:text.length*10}),createLinearGradient:()=>({addColorStop:vi.fn()})})
it('version save failure is handled without leaking server detail and can retry',async()=>{
 const save=vi.spyOn(api,'saveVersion').mockRejectedValueOnce(new Error('secret-test-token')).mockResolvedValue({id:'v',label:'Version',createdAt:1,blockCount:1});const action=await versions(),before=state().doc;await click(action);expect(state().toast?.kind).toBe('error');expect(state().toast?.text).not.toContain('secret-test-token');expect(state().doc).toBe(before);expect(action.disabled).toBe(false);await click(action);expect(save).toHaveBeenCalledTimes(2);expect(state().toast?.kind).toBe('ok')
})
for(const closed of [true,false])it(`version duplicate protection and delayed response after ${closed?'close':'switch'} never affect current context`,async()=>{
 let resolve!:(x:any)=>void;const save=vi.spyOn(api,'saveVersion').mockImplementation(()=>new Promise(r=>{resolve=r}));const action=await versions();await click(action);await click(action);expect(save).toHaveBeenCalledTimes(1);expect(action.disabled).toBe(true)
 if(closed)await click(host.querySelector('button.close'));else await act(async()=>state().load({...emptyDoc(),id:'other',title:'Other'}));const expected=state().doc,toast=state().toast,calls=vi.mocked(api.versions).mock.calls.length
 await act(async()=>resolve({id:'v',label:'saved',createdAt:1,blockCount:1}));expect(state().doc).toBe(expected);expect(state().toast).toBe(toast);expect(api.versions).toHaveBeenCalledTimes(calls)
})
it('missing canvas context reports a safe error, keeps export disabled, and recovers on rerender',async()=>{
 const get=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);await mount(<CoverDesigner onClose={()=>{}}/>);expect(state().toast?.kind).toBe('error');expect((host.querySelector('button.primary') as HTMLButtonElement).disabled).toBe(true)
 get.mockReturnValue(context() as any);await input(host.querySelector('input[placeholder="标题"]'),'Retry title');expect((host.querySelector('button.primary') as HTMLButtonElement).disabled).toBe(false)
})
it('draw failure is handled and does not reveal detail; next layout render recovers',async()=>{
 const ctx=context();ctx.fillRect.mockImplementationOnce(()=>{throw new Error('secret-render-token')});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as any);await mount(<CoverDesigner onClose={()=>{}}/>);expect(state().toast?.kind).toBe('error');expect(state().toast?.text).not.toContain('secret-render-token');expect((host.querySelector('button.primary') as HTMLButtonElement).disabled).toBe(true);await click(host.querySelector('.seg button:nth-child(2)'));expect((host.querySelector('button.primary') as HTMLButtonElement).disabled).toBe(false)
})
it('late cover rendering after close neither reports errors nor makes an export ready',async()=>{
 const images:any[]=[];vi.stubGlobal('Image',class {onload:any;onerror:any;width=10;height=10;constructor(){images.push(this)}set src(_v:string){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context() as any);state().load({...state().doc,cover:{src:'/media/photo.png'}});await mount(<CoverDesigner onClose={()=>{}}/>);const toast=state().toast;await mount(<div/>);await act(async()=>images[0].onload());expect(state().toast).toBe(toast)
})
it('cover uploads are locked while pending and cannot apply after close',async()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context() as any);vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['image'])));let resolve!:(x:any)=>void;const upload=vi.spyOn(api,'uploadAssets').mockImplementation(()=>new Promise(r=>{resolve=r}));await mount(<CoverDesigner onClose={()=>{}}/>);const action=host.querySelector('button.primary')!;await click(action);await click(action);expect(upload).toHaveBeenCalledTimes(1);const before=state().doc;await mount(<div/>);await act(async()=>resolve([asset]));expect(state().doc).toBe(before)
})

it('late version rejection after closing is handled without a stale toast',async()=>{
 let reject!:(e:Error)=>void;vi.spyOn(api,'saveVersion').mockImplementation(()=>new Promise((_,r)=>{reject=r}));const action=await versions();await click(action);await click(host.querySelector('button.close'));const toast=state().toast;await act(async()=>reject(new Error('private detail')));expect(state().toast).toBe(toast)
})
