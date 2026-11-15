// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { extractFrames, extractSlots, fillSlots, fitOf, isPhotoSlot, nestInto, setSlotAlign, setSlotColor, slotAligns, slotColors } from '../../src/core/slots'

const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
const typedId=(html:string,text:string)=>{
 const slot=extractSlots(html).find(s=>s.kind==='text'&&s.text===text)
 if(!slot)throw Error('missing fixture slot: '+text)
 return slot.id
}

it('uses explicit dimensions for local image variants, while zero or absent dimensions do not invent a ratio',()=>{
 const base='<img src="/media/original.jpg" width="400" height="200"><img src="/media/no-size.jpg" height="0"><img src="/media/no-height.jpg" width="800">'
 const result=parse(fillSlots(base,{i0:{src:'/media/local.jpg'},i1:{src:'/media/no-size-replacement.jpg'},i2:{src:'https://fixture.invalid/remote.jpg'}}))
 const images=[...result.images]
 expect(images.map(img=>img.getAttribute('src'))).toEqual(['/media/local.jpg?fit=100%3A50&w=1080','/media/no-size-replacement.jpg','https://fixture.invalid/remote.jpg'])
 expect(images.every(img=>!img.hasAttribute('height'))).toBe(true)
 expect(fitOf(0)).toBe('100:1');expect(fitOf(20)).toBe('100:999')
})

it('rejects unsuitable photo shapes and treats narrow percent and explicit GIF fixtures as decorative',()=>{
 const slots=extractSlots('<img><img src="/media/regular.jpg"><section style="width:20%"><img src="/media/small.jpg"></section><img src="https://example.invalid/a.gif?q=1">')
 const images=slots.filter(s=>s.kind==='image')
 expect(images).toHaveLength(4)
 expect(images.map(x=>[x.src,x.decor])).toEqual([['',false],['/media/regular.jpg',false],['/media/small.jpg',true],['https://example.invalid/a.gif?q=1',true]])
 expect(isPhotoSlot(images[1],{[images[1].src]:0.45})).toBe(true)
 expect(isPhotoSlot(images[1],{[images[1].src]:2.2})).toBe(true)
 expect(isPhotoSlot(images[1],{[images[1].src]:2.21})).toBe(false)
 expect(isPhotoSlot(images[2],{[images[2].src]:1})).toBe(false)
 expect(extractFrames('<img src="/media/naked.jpg">')).toEqual([])
})

it('keeps explicit inherited alignment, including start/end and row-flex rules rather than moving unrelated children',()=>{
 const html='<div style="text-align:start"><p>开始文字</p></div><p style="text-align:end">结束文字</p><div style="display:flex;justify-content:flex-end"><p>行内文字</p></div><div style="text-align:justify"><p>两端文字</p></div>'
 const aligned=slotAligns(html)
 expect(['开始文字','结束文字','行内文字','两端文字'].map(text=>aligned[typedId(html,text)])).toEqual(
   [{align:'left',alignable:true},{align:'right',alignable:true},{align:'right',alignable:true},{align:'justify',alignable:true}],
 )
 const untouched='<svg><text>矢量文字</text></svg><p>另有内容</p>'
 expect(setSlotAlign(untouched,typedId(untouched,'矢量文字'),'right')).toBe(untouched)
})

it('applies alignment and color to a bare text slot without formatting its sibling paragraphs',()=>{
 const html='裸露文字<p style="color:#aabbcc">相邻正文</p>'
 const id=typedId(html,'裸露文字'), aligned=setSlotAlign(html,id,'center')
 expect(parse(aligned).querySelector('section')?.getAttribute('style')).toContain('text-align: center')
 expect(parse(aligned).querySelector('p')?.getAttribute('style')).toBe('color:#aabbcc')
 expect(setSlotColor(html,id,null)).toBe(html)
 const colored=setSlotColor(html,id,'#112233')
 expect(parse(colored).querySelector('span')?.textContent).toBe('裸露文字')
 expect(slotColors(colored)[typedId(colored,'裸露文字')]).toBe('#112233')
 expect(slotColors(colored)[typedId(colored,'相邻正文')]).toBe('#aabbcc')
})

it('uses stable nest fallback when no body or no suitable element body can host pre-rendered pieces',()=>{
 expect(nestInto('<p>01</p><p>LABEL</p>',[{lines:['replacement']}],{})).toBeNull()
 expect(nestInto('只有一段没有段落元素的裸文字。如期保持原始结构。<p>01</p>',[{lines:['replacement']}],{})).toBeNull()
})

it('keeps replacement text literal when bold is disabled, while ignoring caption line breaks in tight SVG text',()=>{
 const html='<svg><text x="4" y="6">先前文字</text></svg><p>旧正文。</p>'
 const updated=fillSlots(html,{
  [typedId(html,'先前文字')]:'**矢量**\n后面',
  [typedId(html,'旧正文。')]:'**字面符号**',
 },{bold:false,split:false})
 const out=parse(updated)
 expect(out.querySelector('text')?.textContent).toBe('矢量 后面')
 expect(out.querySelector('text')?.getAttribute('x')).toBe('4')
 expect(out.querySelector('p')?.textContent).toBe('**字面符号**')
 expect(out.querySelector('strong')).toBeNull()
})
