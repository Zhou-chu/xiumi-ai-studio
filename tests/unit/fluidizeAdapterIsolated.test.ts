// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const h=vi.hoisted(()=>{
 const refuse=()=>{throw Error('unexpected fluidize boundary')}
 return {refuse,column:vi.fn<(root:Element)=>{el:Element;width:number}|null>(refuse),tree:vi.fn<(root:HTMLElement)=>number>(refuse)}
})
vi.mock('../../src/core/fluid',()=>({fluidizeTree:h.tree,sourceColumn:h.column}))
import { fluidizeArticle } from '../../src/editor/fluidize'

const hidden=()=>[...document.body.children].filter(e=>e.getAttribute('style')?.includes('left: -100000px'))
const fixture=()=>{
 const root=document.createElement('main')
 root.innerHTML='<section style="padding: 0 10px"><article><img src="/media/qa-placeholder.jpg" alt="unchanged"><p>Content</p></article></section>'
 return root
}
const measure=()=>{
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return Number.parseFloat(this.parentElement?.style.width||'0')})
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {width:Number.parseFloat(this.style.width||'0')} as DOMRect})
}
beforeEach(()=>{
 h.column.mockReset().mockImplementation(h.refuse);h.tree.mockReset().mockImplementation(h.refuse)
 vi.stubGlobal('fetch',vi.fn(h.refuse))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it('preserves the original markup and skips measuring when there is no fixed source column',()=>{
 const root=fixture(),before=root.innerHTML
 h.column.mockReturnValueOnce(null)
 expect(fluidizeArticle(root)).toBe(0)
 expect(h.column).toHaveBeenCalledExactlyOnceWith(root)
 expect(h.tree).not.toHaveBeenCalled();expect(root.innerHTML).toBe(before);expect(hidden()).toEqual([])
})

it('adjusts a padded measurement host, temporarily omits image sources and copies only the final tree',()=>{
 const root=fixture();measure()
 h.column.mockReturnValueOnce({el:root.querySelector('article')!,width:320})
 h.tree.mockImplementationOnce(host=>{
  expect(host.style.width).toBe('340px')
  expect(hidden()).toEqual([host])
  expect(host.querySelector('[data-fluid-ref]')).toBeNull()
  expect(host.querySelector('img')?.hasAttribute('src')).toBe(false)
  expect(host.querySelector('img')?.getAttribute('data-fluid-src')).toBe('/media/qa-placeholder.jpg')
  expect(root.querySelector('article')?.hasAttribute('data-fluid-ref')).toBe(false)
  host.querySelector('p')?.setAttribute('style','width: 50%')
  return 1
 })
 expect(fluidizeArticle(root)).toBe(1)
 expect(root.querySelector('img')?.getAttribute('src')).toBe('/media/qa-placeholder.jpg')
 expect(root.querySelector('img')?.getAttribute('alt')).toBe('unchanged')
 expect(root.querySelector('[data-fluid-src], [data-fluid-ref]')).toBeNull()
 expect(root.querySelector('p')?.getAttribute('style')).toBe('width: 50%')
 expect(hidden()).toEqual([])
})

it.each([false,true])('removes the temporary host and leaves original markup on no change or failure (%s)',throws=>{
 const root=fixture(),before=root.innerHTML
 h.column.mockReturnValueOnce({el:root.querySelector('article')!,width:320})
 measure()
 h.tree.mockImplementationOnce(host=>{
  expect(hidden()).toEqual([host])
  expect(host.querySelector('img')?.hasAttribute('src')).toBe(false)
  host.querySelector('p')?.remove()
  if(throws)throw Error('synthetic measure refusal')
  return 0
 })
 if(throws)expect(()=>fluidizeArticle(root)).toThrow('synthetic measure refusal')
 else expect(fluidizeArticle(root)).toBe(0)
 expect(root.innerHTML).toBe(before);expect(hidden()).toEqual([])
})
