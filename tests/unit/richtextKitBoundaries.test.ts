import { describe, expect, it } from 'vitest'
import { textToRich, richToPlain, richToMarkdown, richCharCount, setRichAlignment } from '../../src/core/richtext'
import { createBlock } from '../../src/core/blocks'
import { boxParts, KIT_RENDERERS, kitEmptySlots, photoRows } from '../../src/core/kit'
import type { RichText } from '../../src/core/types'
describe('rich text serialization edges',()=>{
 it('normalizes blanks, preserves requested whitespace and counts nonspaces',()=>{
  expect(richToPlain(undefined)).toBe('');expect(richToMarkdown(undefined)).toBe('');expect(richToPlain(textToRich(''))).toBe('')
  expect(richToPlain(textToRich(' first **bold** tail\n\nlast '))).toBe('first bold tail\nlast')
  expect(richToPlain(textToRich(' a \n\n b ',{preserveWhitespace:true}),{preserveWhitespace:true})).toBe(' a \n\n b ')
  expect(richCharCount(textToRich(' a b\nc'))).toBe(3)
 })
 it('serializes marks, links, hard breaks, nested inline nodes, list items and absent content',()=>{
  const r:RichText={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'B',marks:[{type:'bold'},{type:'italic'}]},{type:'hardBreak'},{type:'span',content:[{type:'text',text:'L',marks:[{type:'link',attrs:{href:'https://example.com'}}]}]},{type:'text',marks:[{type:'link'},{type:'unknown'}]},{type:'span'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'item'}]}]},{type:'listItem'}]},{type:'orderedList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'ordered'}]}]},{type:'listItem'}]},{type:'unknown'},{type:'paragraph'},{type:'bulletList'},{type:'orderedList'}]}
  const md=richToMarkdown(r);expect(md).toContain('***B***');expect(md).toContain('[L](https://example.com)');expect(md).toContain('[]()');expect(md).toContain('- item');expect(md).toContain('1. ordered');expect(richToPlain(r)).toContain('B\nL')
  expect(richToMarkdown({type:'doc'} as any)).toBe('')
  const aligned=setRichAlignment(r,'right');expect(aligned.content?.[0].attrs?.textAlign).toBe('right');expect(r.content?.[0].attrs).toBeUndefined()
 })
})
describe('kit rendering optional data and layout variants',()=>{
 const image={src:'/media/a.jpg',width:600,height:900}
 const context=(hints=false)=>({hints,inBox:false,img:(im:any)=>im?.src??''})
 it.each(['rule','paper','plate'] as const)('renders %s box with each title/label combination',variant=>{
  for(const [title,label] of [['',''],['Title',''],['','Label'],['Title','Label']]){
   const parts=boxParts(createBlock('box',{variant,title,label}).props);expect(parts.body).toContain('font-size:14px');if(title)expect(parts.header).toContain(title);if(label)expect(parts.header).toContain(label)
  }
 })
 it.each(['circuit','ticket','flag'] as const)('renders %s frames with empty/portrait/unknown-size photos',variant=>{
  expect(KIT_RENDERERS.frame(createBlock('frame',{variant,image:undefined,caption:'',label:''}),context())).toBe('')
  for(const [caption,label] of [['',''],['Cap',''],['','Label'],['Cap','Label']]){
   const b=createBlock('frame',{variant,image,caption,label});const out=KIT_RENDERERS.frame(b,context());expect(out).toContain('/media/a.jpg');if(caption)expect(out).toContain('Cap');if(label)expect(out).toContain('Label')
  }
  expect(KIT_RENDERERS.frame(createBlock('frame',{variant,image:{src:'/media/no-size.jpg'},caption:'',label:''}),context())).toContain('/media/no-size.jpg')
  expect(KIT_RENDERERS.frame(createBlock('frame',{variant,image:undefined,caption:'',label:''}),context(true))).toContain('data-slot="0"')
 })
 it('renders no, one and multiple carousel slots with honest placeholders',()=>{
  expect(KIT_RENDERERS.carousel(createBlock('carousel',{pics:[],label:''}),context())).toBe('')
  expect(KIT_RENDERERS.carousel(createBlock('carousel',{pics:[],label:''}),context(true))).toContain('data-slot="0"')
  for(const variant of ['peek','full'] as const)for(const hints of [false,true]){
   const one=KIT_RENDERERS.carousel(createBlock('carousel',{variant,label:'',pics:[{image,caption:''}]}),context(hints));expect(one).toContain('/media/a.jpg');expect(one).not.toContain('overflow-x:auto')
   const many=KIT_RENDERERS.carousel(createBlock('carousel',{variant,label:'Gallery',pics:[{image,caption:'Cap'},{image,caption:''},{caption:''}]}),context(hints));expect(many).toContain('Gallery');expect(many).toContain('overflow-x:auto');expect(many).toContain('Cap')
  }
 })
 it('renders every photo row layout and counts empty placeholders',()=>{
  for(const count of [2,3,4] as const)for(const layout of ['even','feature'] as const){
   expect(photoRows(count,layout,'1:1').flat()).toHaveLength(count)
   const b=createBlock('photos',{count,layout,pics:[]});expect(KIT_RENDERERS.photos(b,context())).toBe('');expect(kitEmptySlots(b)).toBe(count)
   expect(KIT_RENDERERS.photos(b,context(true))).toContain('data-slot="0"')
   b.props.pics=[{image,caption:''}];expect(KIT_RENDERERS.photos(b,context())).toContain('/media/a.jpg');expect(kitEmptySlots(b)).toBe(count-1)
  }
  expect(kitEmptySlots(createBlock('paragraph'))).toBe(0);expect(kitEmptySlots(createBlock('frame',{image}))).toBe(0);expect(kitEmptySlots(createBlock('frame',{image:undefined}))).toBe(1)
  expect(kitEmptySlots(createBlock('carousel',{pics:[{image,caption:''},{caption:''}]}))).toBe(1)
 })
})
