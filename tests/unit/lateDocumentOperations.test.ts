// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Toolbar } from '../../src/editor/Toolbar'
import { CoverDesigner } from '../../src/editor/CoverDesigner'
import { api, type Asset } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'

let root: ReturnType<typeof createRoot>
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useStore.getState().load({...emptyDoc(), title:'original'})
  vi.spyOn(api,'saveProject').mockResolvedValue({updatedAt:Date.now(),revision:'revision-1'})
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(() => { act(()=>root.unmount());host.remove();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks() })
const button = (text:string) => [...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!

for(const cancel of [false,true]) it(`late version restore preserves ${cancel?'a new project after closing':'new edits in the same document'}`,async()=>{
  const original=useStore.getState().doc
  vi.spyOn(api,'versions').mockResolvedValue([{id:'v1',label:'version one',createdAt:1,blockCount:0}])
  let finish!: (result:{doc:typeof original})=>void
  vi.spyOn(api,'version').mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>{root.render(createElement(Toolbar))})
  await act(async()=>{button('历史版本').click()})
  await act(async()=>{button('恢复').click()})
  if(cancel) {
    await act(async()=>{(host.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click()})
    await act(async()=>{useStore.getState().load({...emptyDoc(),title:'another project'})})
  } else await act(async()=>{useStore.getState().setDocFields({title:'new edits'})})
  const expected=useStore.getState().doc
  await act(async()=>{finish({doc:{...original,title:'old version'}})})
  expect(useStore.getState().doc).toBe(expected)
})

it('late cover upload never applies to a new project after the designer closes',async()=>{
  vi.spyOn(api,'assets').mockResolvedValue([])
  const ctx={font:'',fillStyle:'',fillRect(){},createLinearGradient:()=>({addColorStop(){}}),measureText:()=>({width:10}),fillText(){}}
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as any)
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['image'])))
  let finish!: (result:Asset[])=>void
  vi.spyOn(api,'uploadAssets').mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>{root.render(createElement(CoverDesigner,{onClose(){}}))})
  await act(async()=>{button('生成并设为封面').click()})
  await act(async()=>{root.render(null)})
  const next={...emptyDoc(),title:'next project'}
  await act(async()=>{useStore.getState().load(next)})
  const expected=useStore.getState().doc
  await act(async()=>{finish([{id:'cover',file:'old-cover.jpg',name:'cover',width:900,height:383,size:5,createdAt:1}])})
  expect(useStore.getState().doc).toBe(expected)
  expect(useStore.getState().doc.cover).toBeUndefined()
})

it('normal version restore remains undoable',async()=>{
  const original=useStore.getState().doc
  vi.spyOn(api,'versions').mockResolvedValue([{id:'v1',label:'version one',createdAt:1,blockCount:0}])
  vi.spyOn(api,'version').mockResolvedValue({doc:{...original,title:'restored version'}})
  await act(async()=>{root.render(createElement(Toolbar))})
  await act(async()=>{button('历史版本').click()})
  await act(async()=>{button('恢复').click()})
  expect(useStore.getState().doc.title).toBe('restored version')
  await act(async()=>{useStore.getState().undo()})
  expect(useStore.getState().doc.title).toBe(original.title)
})
