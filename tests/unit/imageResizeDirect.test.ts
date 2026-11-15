import { expect, it } from 'vitest'
import { applyImageWidths, validImageWidth } from '../../src/core/imageResize'
import { createBlock, normalizeBlocks } from '../../src/core/blocks'
it('retains finite 10–100 percent widths and rejects arbitrary values', () => {
 expect(validImageWidth(37.45)).toBe(37.5)
 for (const value of [NaN, Infinity, '50', 0, 9, 101, null]) expect(validImageWidth(value)).toBeUndefined()
})
it('adds width styling even to an image with no style attribute', () => {
 expect(applyImageWidths('<img src="/media/a.png" width="900" height="600">', { src:'/media/a.png', displayWidth:50 } as never)).toBe('<img src="/media/a.png" style="width:50%;max-width:100%;height:auto;">')
})
it('replaces only dimensions and preserves unrelated styles and invalid-width output', () => {
 const tag='<img src="x" style="width:100%;height:60px;display:block;border-radius:4px;">'
 const out=applyImageWidths(tag,{src:'x',displayWidth:30} as never)
 expect(out).toContain('width:30%');expect(out).not.toContain('height:60px');expect(out).toContain('border-radius:4px')
 expect(applyImageWidths(tag,{src:'x',displayWidth:Infinity} as never)).toBe(tag)
})
it('does not keep invalid display widths through document normalization', () => {
 for(const displayWidth of [NaN,Infinity,9,101,'40']) {
  const block=createBlock('image',{image:{src:'/media/a.png',displayWidth} as never})
  expect((normalizeBlocks([block])[0].props as {image:{displayWidth?:number}}).image.displayWidth).toBeUndefined()
 }
})
