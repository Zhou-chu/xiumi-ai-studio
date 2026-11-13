// @vitest-environment jsdom
import {act,type ReactNode} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {CoverDesigner} from '../../src/editor/CoverDesigner'
import {CropModal} from '../../src/editor/CropModal'
import {useStore,emptyDoc} from '../../src/editor/store'
import {api,type Asset} from '../../src/editor/api'
vi.mock('../../src/editor/api',async original=>({...await original<typeof import('../../src/editor/api')>(),api:{assets:vi.fn(),uploadAssets:vi.fn(),cropAsset:vi.fn()}}))
vi.mock('react-easy-crop',()=>({default:({image,crop,zoom,aspect,onCropChange,onZoomChange,onCropComplete}:any)=><div data-testid="cropper" data-image={image} data-crop={JSON.stringify(crop)} data-zoom={zoom} data-aspect={aspect}><button data-testid="crop-select" onClick={()=>{onCropChange({x:20,y:30});onCropComplete({}, {x:10,y:15,width:100,height:80})}}>select area</button><button data-testid="crop-zoom" onClick={()=>onZoomChange(2)}>zoom</button></div>}))
const initial=useStore.getState(),close=vi.fn(),done=vi.fn();let host:HTMLDivElement,root:Root
const asset={id:'one',file:'one.jpg',name:'Photo',width:800,height:600} as Asset
const ctx={fillStyle:'',font:'',fillRect:vi.fn(),drawImage:vi.fn(),fillText:vi.fn(),measureText:vi.fn((text:string)=>({width:text.length*20})),createLinearGradient:vi.fn(()=>({addColorStop:vi.fn()}))}
let imageMode:'load'|'error'|'hold'='load';let images:any[]=[]
async function render(node:ReactNode){await act(async()=>root.render(node));await flush()}
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
async function click(selector:string){const el=host.querySelector<HTMLElement>(selector)!;expect(el).toBeTruthy();await act(async()=>el.click());await flush()}
async function value(selector:string,text:string){const el=host.querySelector<HTMLInputElement>(selector)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();imageMode='load';images=[];useStore.setState({...initial,doc:{...emptyDoc(),title:'A complete title'}},true);vi.mocked(api.assets).mockResolvedValue([asset]);vi.mocked(api.uploadAssets).mockResolvedValue([asset]);vi.mocked(api.cropAsset).mockResolvedValue(asset)
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as any);vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['image'],{type:'image/jpeg'})))
 vi.stubGlobal('Image',class{width=800;height=600;onload:(()=>void)|null=null;onerror:((error:Error)=>void)|null=null;set src(_value:string){images.push(this);if(imageMode!=='hold')queueMicrotask(()=>imageMode==='error'?this.onerror?.(new Error('image failed')):this.onload?.())}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('crop requires selected area, changes ratio/zoom and saves a distinct asset',async()=>{
 await render(<CropModal asset={asset} onClose={close} onDone={done}/>);expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true);expect(host.querySelector('[data-testid="cropper"]')?.getAttribute('data-image')).toBe('/media/one.jpg')
 await click('.row.gap button:first-child');expect(Number(host.querySelector('[data-testid="cropper"]')?.getAttribute('data-aspect'))).toBeCloseTo(800/600);await click('.row.gap button:nth-child(2)');expect(host.querySelector('[data-testid="cropper"]')?.getAttribute('data-aspect')).toBe('1')
 await click('[data-testid="crop-select"]');await click('[data-testid="crop-zoom"]');await value('input[type="range"]','3');expect(host.querySelector('[data-testid="cropper"]')?.getAttribute('data-zoom')).toBe('3');await click('button.primary');expect(api.cropAsset).toHaveBeenCalledWith('one',{x:10,y:15,width:100,height:80});expect(done).toHaveBeenCalledWith(asset);expect(useStore.getState().toast?.text).toContain('原图保留')
})
it('crop failure retains selection for retry and cancel does not call crop',async()=>{
 await render(<CropModal asset={asset} onClose={close} onDone={done}/>);await click('[data-testid="crop-select"]');vi.mocked(api.cropAsset).mockRejectedValueOnce(new Error('crop failed'));await click('button.primary');expect(done).not.toHaveBeenCalled();expect(useStore.getState().toast?.text).toBe('crop failed');await click('.modal-actions button:first-child');expect(close).toHaveBeenCalled();expect(api.cropAsset).toHaveBeenCalledTimes(1)
})
it('renders all cover layouts, selects source image or solid background, updates title and saves',async()=>{
 const original=useStore.getState().doc;await render(<CoverDesigner onClose={close}/>);expect(ctx.fillText).toHaveBeenCalledWith('A complete title',expect.any(Number),expect.any(Number));await value('input[placeholder="小标签"]','Label');await value('input[placeholder="标题"]','Changed cover title');await click('.seg button:nth-child(2)');await click('.seg button:nth-child(3)');await click('.seg button:first-child');await click('.asset-strip img');expect(ctx.drawImage).toHaveBeenCalled();await click('.asset-strip button');await click('button.primary');expect(api.uploadAssets).toHaveBeenCalledOnce();expect(useStore.getState().doc.cover?.src).toBe('/media/one.jpg');expect(useStore.getState().doc.blocks).toBe(original.blocks);expect(close).toHaveBeenCalledOnce()
})
it('direct original image action applies only known library asset',async()=>{
 await render(<CoverDesigner onClose={close}/>);await click('.asset-strip img');await click('.modal-actions button:nth-child(2)');expect(api.uploadAssets).not.toHaveBeenCalled();expect(useStore.getState().doc.cover?.src).toBe('/media/one.jpg');expect(close).toHaveBeenCalled()
})
it('long titles are never silently truncated into saved output; background failure remains usable',async()=>{
 useStore.setState({doc:{...useStore.getState().doc,title:'Long '.repeat(150),cover:{src:'/media/missing.jpg'}}});imageMode='error';await render(<CoverDesigner onClose={close}/>);expect(host.querySelector('[role="alert"]')).toBeTruthy();expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true);expect(api.uploadAssets).not.toHaveBeenCalled();await value('input[placeholder="标题"]','');expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(false)
 const button=host.querySelector<HTMLElement>('.modal-actions button:nth-child(2)')!;await act(async()=>button.click());expect(close).not.toHaveBeenCalled()
})
it('late image render cannot overwrite a newer layout, and save waits for image completion',async()=>{
 useStore.setState({doc:{...useStore.getState().doc,cover:{src:'/media/old.jpg'}}});imageMode='hold';await render(<CoverDesigner onClose={close}/>);expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true);await click('.asset-strip button');const draws=ctx.drawImage.mock.calls.length;await act(async()=>images[0].onload());expect(ctx.drawImage).toHaveBeenCalledTimes(draws);expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(false)
})
it('late uploaded cover preserves newer document and exposes generated asset without applying it',async()=>{
 await render(<CoverDesigner onClose={close}/>);let finish!:(value:Asset[])=>void;vi.mocked(api.uploadAssets).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');const newer={...useStore.getState().doc,title:'New manual title'};await act(async()=>useStore.setState({doc:newer}));await act(async()=>finish([asset]));expect(useStore.getState().doc).toBe(newer);expect(useStore.getState().toast?.text).toContain('已保留当前内容');expect(close).not.toHaveBeenCalled()
})
it('late upload after unmount and failed upload never set cover',async()=>{
 await render(<CoverDesigner onClose={close}/>);vi.mocked(api.uploadAssets).mockRejectedValueOnce(new Error('upload failed'));await click('button.primary');expect(useStore.getState().toast?.text).toBe('upload failed');const before=useStore.getState().doc;let finish!:(value:Asset[])=>void;vi.mocked(api.uploadAssets).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');await render(null);await act(async()=>finish([asset]));expect(useStore.getState().doc).toBe(before);expect(close).not.toHaveBeenCalled()
})
it('changing cover settings while upload is pending protects those new settings',async()=>{
 vi.mocked(api.assets).mockRejectedValueOnce(new Error('assets offline'));await render(<CoverDesigner onClose={close}/>);let finish!:(value:Asset[])=>void;vi.mocked(api.uploadAssets).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');await value('input[placeholder="标题"]','Changed during upload');await act(async()=>finish([asset]));expect(useStore.getState().doc.cover).toBeUndefined();expect(close).not.toHaveBeenCalled()
})

it('closing crop during upload cannot dismiss a subsequently opened crop dialog',async()=>{
 await render(<CropModal key="first" asset={asset} onClose={close} onDone={done}/>);await click('[data-testid="crop-select"]');let finish!:(value:Asset)=>void;vi.mocked(api.cropAsset).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');await click('button.close');await render(<CropModal key="second" asset={{...asset,id:'second',name:'Second photo'}} onClose={close} onDone={done}/>);await act(async()=>finish(asset));expect(done).not.toHaveBeenCalled();expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toContain('Second photo')
})
it('close invalidates crop completion immediately before the parent unmounts',async()=>{
 await render(<CropModal asset={asset} onClose={close} onDone={done}/>);await click('[data-testid="crop-select"]');let finish!:(value:Asset)=>void;vi.mocked(api.cropAsset).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');await click('.modal-actions button:first-child');await act(async()=>finish(asset));expect(done).not.toHaveBeenCalled();expect(useStore.getState().toast?.text).toContain('可能仍会')
})
