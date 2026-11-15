// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { addPicTo, blockPhotos, fitRatio, replacePhoto, setPhoto, swapPhotos } from '../../src/core/photos'
import type { Block, Doc } from '../../src/core/types'
const doc=(blocks:Block[]):Doc=>({id:'d',title:'t',author:'',digest:'',themeId:'x',blocks,createdAt:0,updatedAt:0})
const ref={src:'/media/new.jpg?fit=100%3A20&w=123',width:500,displayWidth:60}

it('does not let an unrelated malformed percent escape in an imported URL break photo replacement',()=>{
 const b=createBlock('html',{html:'<p><img src="https://fixture.invalid/50%offer.jpg?tag=%ZZ" style="width:100%"></p>'})
 expect(fitRatio('https://fixture.invalid/50%offer.jpg?tag=%ZZ')).toBeUndefined()
 const next=setPhoto(b,0,ref,{ratio:.5})
 expect(next.type==='html'&&next.props.html).toContain('src="/media/new.jpg?fit=100%3A50&amp;w=1080"')
})

it('does not treat a zero-denominator or zero-height fit as a usable crop ratio',()=>{
 expect(fitRatio('/media/a.jpg?fit=0:75')).toBeUndefined()
 expect(fitRatio('/media/a.jpg?fit=100:0')).toBeUndefined()
 expect(fitRatio('/media/a.jpg?fit=100%3A75')).toBe(.75)
 expect(fitRatio('/media/50%off.jpg?tag=%ZZ&fit=100%3A75')).toBe(.75)
 for(const input of ['?fit=%ZZ','?fit=100:75oops','?fit=1:'+ '9'.repeat(400),'#?fit=1:2','?fit=','?fit=0:0'])expect(fitRatio('/media/a.jpg'+input)).toBeUndefined()
})

it('fills fixed photo slots without losing captions or mutating the input, and reports a full layout',()=>{
 const b=createBlock('photos',{count:3,pics:[{caption:'first',image:{src:'/media/old.jpg'}},{caption:'second'}]})
 const before=structuredClone(b), next=addPicTo(b,ref)!
 expect(next.props).toMatchObject({pics:[{caption:'first',image:{src:'/media/old.jpg'}},{caption:'second',image:{...ref,src:'/media/new.jpg'}},{caption:''}]})
 expect(b).toEqual(before);expect(blockPhotos(b)).toEqual([{src:'/media/old.jpg'},null,null])
 const filled=addPicTo(next,ref)!
 expect(addPicTo(filled,ref)).toBeNull()
 expect(setPhoto(b,3,ref)).toBe(b)
})

it('fills the first carousel hole, then appends, while frame replacement strips local crop but retains metadata',()=>{
 const b=createBlock('carousel',{pics:[{caption:'keep'},{caption:'second',image:{src:'/media/b.jpg'}}]})
 const next=addPicTo(b,ref)!, appended=addPicTo(next,{src:'https://fixture.invalid/a.jpg?fit=1:2'})!
 expect(next.props).toMatchObject({pics:[{caption:'keep',image:{...ref,src:'/media/new.jpg'}},{caption:'second',image:{src:'/media/b.jpg'}}]})
 expect(appended.props).toMatchObject({pics:[{}, {},{caption:'',image:{src:'https://fixture.invalid/a.jpg?fit=1:2'}}]})
 expect(setPhoto(next,2,ref)).toBe(next)
 const frame=createBlock('frame',{}), updated=addPicTo(frame,ref)!
 expect(updated.props).toMatchObject({image:{...ref,src:'/media/new.jpg'}})
 const paragraph=createBlock('paragraph',{})
 expect(addPicTo(paragraph,ref)).toBe(paragraph);expect(blockPhotos(paragraph)).toEqual([])
})

it('requires explicit empty-slot permission and preserves identity for missing positions and same-position swaps',()=>{
 const frame={...createBlock('frame',{}),id:'f'}, root=doc([createBlock('box',{children:[frame]})])
 expect(replacePhoto(root,{blockId:'f',index:0},ref)).toBe(root)
 const next=replacePhoto(root,{blockId:'f',index:0},ref,{allowEmpty:true})
 expect(next.blocks[0].type==='box'&&next.blocks[0].props.children[0].props).toMatchObject({image:{...ref,src:'/media/new.jpg'}})
 expect(replacePhoto(root,{blockId:'missing',index:0},ref,{allowEmpty:true})).toBe(root)
 expect(swapPhotos(next,{blockId:'f',index:0},{blockId:'f',index:0})).toBe(next)
 expect(swapPhotos(next,{blockId:'f',index:0},{blockId:'missing',index:0})).toBe(next)
})

it('does not replace absent HTML or gallery slots and does not make decorative builtins movable',()=>{
 const html=createBlock('html',{html:'<p>text only</p>'}), gallery=createBlock('gallery',{images:[{src:'/media/a.jpg'}]})
 expect(setPhoto(html,0,ref)).toBe(html);expect(setPhoto(gallery,1,ref)).toBe(gallery)
 const ending=createBlock('ending',{image:{src:'/media/qr.jpg'}})
 expect(blockPhotos(ending)).toEqual([null]);expect(setPhoto(ending,0,ref)).toBe(ending)
})

it('reads only the actual fit query key rather than an ampersand in the path or a question mark inside another value',()=>{
 expect(fitRatio('/media/a&fit=100:75')).toBeUndefined()
 expect(fitRatio('/media/a.jpg?tag=?fit=100:75')).toBeUndefined()
 expect(fitRatio('/media/a.jpg?fit=100:75&fit=100:20')).toBe(.75)
})
