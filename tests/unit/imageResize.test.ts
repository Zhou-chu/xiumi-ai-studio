import { expect, it } from 'vitest'
import { createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
it('persists valid width and compiles each identical-src gallery reference independently', () => {
 const block=createBlock('gallery',{images:[{src:'/media/a.png',width:900,height:600,displayWidth:40},{src:'/media/a.png',displayWidth:70}]})
 const normalized=normalizeBlocks([block])[0]
 expect(normalized.props).toMatchObject({images:[{displayWidth:40,width:900,height:600},{displayWidth:70}]})
 const html=compileBlock(normalized,THEMES[0]);expect(html).toContain('width:40%');expect(html).toContain('width:70%')
})
it('sizes carousel and nested box images by their own refs without sizing placeholders', () => {
 const children=[createBlock('photos',{count:2,pics:[{caption:''}, {caption:'',image:{src:'/media/same.png',displayWidth:35}}]}),createBlock('carousel',{pics:[{caption:'',image:{src:'/media/same.png',displayWidth:60}},{caption:'',image:{src:'/media/same.png',displayWidth:80}}]})]
 const html=compileBlock(createBlock('box',{children}),THEMES[0],{hints:true})
 for(const size of [35,60,80])expect(html).toContain(`width:${size}%`)
 expect(html).toContain('data-slot="0"')
 expect(html).not.toContain('image-resize')
})
