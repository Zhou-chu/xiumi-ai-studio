// @vitest-environment jsdom
import { act, createElement as el } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ColorModeControl, ColorModeProvider } from '../../src/editor/ColorModeControl'
import { COLOR_MODE_KEY } from '../../src/editor/colorMode'
const h=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),resolve:vi.fn()}))
vi.mock('../../src/editor/colorMode',async importActual=>({...await importActual<typeof import('../../src/editor/colorMode')>(),readColorMode:h.read,saveColorMode:h.save,resolveColorMode:h.resolve}))
vi.mock('../../src/editor/Help',()=>({Help:()=>null}))
vi.mock('../../src/editor/UiIcon',()=>({UiIcon:()=>null}))
let root:Root,host:HTMLDivElement,previous:string|undefined
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(30_000);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  previous=document.documentElement.dataset.colorMode
  h.read.mockReset().mockReturnValue('auto');h.save.mockReset();h.resolve.mockReset().mockReturnValue('light')
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{
  act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()
  if(previous===undefined)delete document.documentElement.dataset.colorMode;else document.documentElement.dataset.colorMode=previous
})
const mount=()=>act(()=>root.render(el(ColorModeProvider,{children:el(ColorModeControl)})))
const select=()=>host.querySelector<HTMLSelectElement>('select')!
const choose=(value:string)=>act(()=>{select().value=value;select().dispatchEvent(new Event('change',{bubbles:true}))})
const sync=(key:string|null,newValue:string|null,storageArea:Storage|null=window.localStorage)=>act(()=>window.dispatchEvent(new StorageEvent('storage',{key,newValue,storageArea})))
it('renders no control outside its provider and associates essential description inside it',()=>{
  act(()=>root.render(el(ColorModeControl)));expect(host.textContent).toBe('')
  mount();expect(select().getAttribute('aria-label')).toBe('界面主题')
  const id=select().getAttribute('aria-describedby')!
  expect(document.getElementById(id)?.textContent).toContain('不影响文章和导出')
  expect(select().value).toBe('auto');expect(h.read).toHaveBeenCalledOnce()
})
it('starts from stored preference and persists manual choice without losing the current automatic clock state',()=>{
  h.read.mockReturnValue('dark');mount();expect(document.documentElement.dataset.colorMode).toBe('dark')
  choose('light');expect(h.save).toHaveBeenCalledExactlyOnceWith('light')
  h.resolve.mockReturnValue('dark');act(()=>window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('light')
  choose('auto');expect(document.documentElement.dataset.colorMode).toBe('dark')
  expect(h.save.mock.calls).toEqual([['light'],['auto']])
})
it('refreshes only at the next minute boundary and on wake signals, removing every subscriber on unmount',()=>{
  mount();h.resolve.mockClear().mockReturnValue('dark')
  act(()=>vi.advanceTimersByTime(29_999));expect(h.resolve).not.toHaveBeenCalled()
  act(()=>vi.advanceTimersByTime(1));expect(h.resolve).toHaveBeenCalledExactlyOnceWith('auto')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'))})
  expect(h.resolve).toHaveBeenCalledTimes(4)
  act(()=>root.render(null));h.resolve.mockClear();expect(vi.getTimerCount()).toBe(0)
  act(()=>{vi.advanceTimersByTime(120000);window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'))})
  sync(COLOR_MODE_KEY,'dark');expect(h.resolve).not.toHaveBeenCalled();expect(h.save).not.toHaveBeenCalled()
})
it('accepts only matching local-storage notifications, resets invalid values, and never re-saves cross-tab messages',()=>{
  mount();sync('other','dark');sync(COLOR_MODE_KEY,'dark',sessionStorage);sync(COLOR_MODE_KEY,'dark',null)
  expect(select().value).toBe('auto')
  sync(COLOR_MODE_KEY,'dark');expect(select().value).toBe('dark')
  sync(COLOR_MODE_KEY,'invalid');expect(select().value).toBe('auto')
  sync(COLOR_MODE_KEY,'light');sync(null,null);expect(select().value).toBe('auto')
  expect(h.save).not.toHaveBeenCalled()
})
it('ignores storage events when storage identity cannot be read without breaking later local choices',()=>{
  mount();const storage=localStorage
  vi.spyOn(window,'localStorage','get').mockImplementation(()=>{throw new DOMException('denied')})
  sync(COLOR_MODE_KEY,'dark',storage);expect(select().value).toBe('auto')
  choose('dark');expect(select().value).toBe('dark');expect(h.save).toHaveBeenCalledExactlyOnceWith('dark')
})
