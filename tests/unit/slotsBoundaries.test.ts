import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { extractSlots, fillSlots, slotRawTexts, extractFrames, nestInto, setBackgroundPhoto, slotAligns, setSlotAlignment, removeBackgroundPhotos, isPhotoSlot, fitOf } from '../../src/core/slots'
const parse=(s:string)=>new JSDOM(s).window.document
afterEach(()=>vi.unstubAllGlobals())
describe('slot DOM edge cases',()=>{
 it('handles missing image URLs, comments, narrow decor and preserved raw text',()=>{
  const s='<!--comment--> loose&nbsp;text <p><em>short</em><strong>longer title text</strong><br>next</p><img><img src="https://example.com/p.jpg" style="width:20%">'
  const slots=extractSlots(s,parse,true)
  expect(slots[0]).toMatchObject({kind:'text',text:' loose text '});expect(slots.filter(s=>s.kind==='image')).toHaveLength(2)
  expect(slots.at(-1)).toMatchObject({decor:true})
  expect(slotRawTexts(s,parse).t0).toBe('loose text')
  expect(extractSlots('<svg><text font-size="12px">注释</text></svg>',parse)[0]).toMatchObject({tight:true})
 })
 it('uses browser parser defaults and handles declared image aspect ratio',()=>{
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser)
  const s='<p>文字</p><img src="https://example.com/p.jpg" width="100" height="150">'
  expect(extractSlots(s)).toHaveLength(2);expect(slotRawTexts(s).t0).toBe('文字')
  expect(fillSlots(s,{i0:{src:'/media/new.jpg'}})).toContain('fit=100%3A150')
  expect(fillSlots(s,{t0:null,i0:'not-an-image'},{parse})).toContain('https://example.com/p.jpg')
  expect(isPhotoSlot({id:'i',kind:'image',src:'x',decor:false},{x:0.2})).toBe(false);expect(fitOf(20)).toBe('100:999')
 })
 it('edits loose text with whitespace spans and removes old nested text without losing images',()=>{
  expect(fillSlots('loose text<p>其他</p>',{t0:' a\n\n b '},{parse,preserveWhitespace:true})).toContain('<span>')
  const s='<p><span>短</span><strong>这是比较长的旧正文内容。</strong><br><img src="https://example.com/p.jpg"></p>'
  const out=fillSlots(s,{t0:'**新正文**\n第二段'},{parse,bold:false,split:false});expect(out).toContain('**新正文**');expect(out).not.toContain('短');expect(out).toContain('<img')
  expect(fillSlots('loose text',{t0:'**new**\n next'},{parse})).toBe('new next')
 })
 it('handles unattached body text nesting and safe image-background substitutions',()=>{
  expect(nestInto('一段足够长的裸文本内容，作为正文但是没有块级元素可以用作插入锚点。',[],{}, {parse})).toBeNull()
  expect(extractFrames('<img src="https://example.com/a.jpg">',{parse})).toEqual([])
  expect(extractFrames('<img src="https://example.com/a.jpg" style="border:1px solid #000">',{parse})).toHaveLength(1)
  const bg='<svg viewBox="0 0 100 50" style="background-image:url(/media/old.jpg)"></svg>'
  expect(setBackgroundPhoto(bg,'/media/old.jpg',{src:'javascript:bad'},{parse})).toBe(bg)
  expect(setBackgroundPhoto(bg,'/media/old.jpg',{src:'https://example.com/new.jpg'},{parse})).toContain('https://example.com/new.jpg')
  expect(setBackgroundPhoto('<section style="background-image:url(/media/old.jpg)"></section>','/media/old.jpg',{src:'/media/new.jpg'},{parse,ratio:1})).toContain('fit=100%3A100')
  const untouched='<p style="background-image:url(https://example.com/a.png)">Text</p>';expect(removeBackgroundPhotos(untouched,parse)).toEqual({html:untouched,removed:0})
 })
 it('reads logical alignment and updates inline-only slot hosts',()=>{
  for(const [align,want] of [['start','left'],['end','right'],['justify','justify']] as const)expect(slotAligns(`<p style="text-align:${align}">正文</p>`,parse).t0.align).toBe(want)
  expect(slotAligns('<section style="display:flex;justify-content:end"><p>正文</p></section>',parse).t0.align).toBe('right')
  expect(setSlotAlignment('<span>文字</span>','t0','right',parse)).toContain('text-align: right')
 })
})
