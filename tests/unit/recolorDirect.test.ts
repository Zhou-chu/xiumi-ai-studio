// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { clusterHues, collectColors, docMainColors, fixedDecorCount, harmonize, recolorHtml } from '../../src/core/recolor'
import { createBlock } from '../../src/core/blocks'
import { toHsl } from '../../src/core/color'
const parse=(s:string)=>new DOMParser().parseFromString(s,'text/html')
it('weights backgrounds and SVG fills while excluding URL fragments and non-color declarations',()=>{
  const colors=collectColors('<div style="background:#f00;color:rgb(255,0,0);width:#0f0;content: #00f;background-image:url(https://x/#abc)"><svg><path fill="#f00" stroke="#00f" /></svg></div>')
  expect(colors).toEqual([{hex:'#ff0000',count:7,chroma:true},{hex:'#0000ff',count:1,chroma:true}])
})
it('normalizes short and alpha hex, filters barely visible colors and preserves neutral classification',()=>{
  const colors=collectColors('<p style="color:#f008;background:rgba(0,255,0,14%);border-color:rgba(0,0,255,15%);outline-color:#ff000022;box-shadow:0 0 #ffffff;fill:#000000;stroke:#808080"></p>')
  expect(colors.find(c=>c.hex==='#ff0000')).toMatchObject({count:1,chroma:true})
  expect(colors.find(c=>c.hex==='#00ff00')).toBeUndefined()
  expect(colors.find(c=>c.hex==='#0000ff')).toMatchObject({count:1,chroma:true})
  expect(colors.filter(c=>!c.chroma).map(c=>c.hex).sort()).toEqual(['#000000','#808080','#ffffff'])
})
it('maps color tokens and alpha but leaves images, URL references, text and excluded CSS untouched',()=>{
  const original='<section style="background: #f008;content:#f00;transform:translate(#f00);border:1px solid #f00;background-image:url(https://x/#f00)"><svg><path fill="#ff000080" stroke="#abc"/><animate values="#f00;#abc"/></svg><img src="https://x/red.png"><p>红色文字</p></section>'
  const result=parse(recolorHtml(original,{'#ff0000':'#0000ff'}))
  const style=result.querySelector('section')!.getAttribute('style')!
  expect(style).toContain('rgba(0, 0, 255, 0.53)');expect(style).toContain('border:1px solid #0000ff')
  expect(style).toContain('content:#f00');expect(style).toContain('transform:translate(#f00)');expect(style).toContain('url(https://x/#f00)')
  expect(result.querySelector('path')!.getAttribute('fill')).toBe('rgba(0, 0, 255, 0.50)')
  expect(result.querySelector('path')!.getAttribute('stroke')).toBe('#abc')
  expect(result.querySelector('animate')!.getAttribute('values')).toBe('#0000ff;#abc')
  expect(result.querySelector('img')!.getAttribute('src')).toBe('https://x/red.png')
  expect(result.querySelector('p')!.textContent).toBe('红色文字')
})
it('returns identical bytes for an empty map and preserves percent alpha on RGB replacements',()=>{
  const input='<P style="color:rgba(255, 0, 0, 50%);bad-declaration"> 原文 </P>'
  expect(recolorHtml(input,{})).toBe(input)
  expect(recolorHtml(input,{'#ff0000':'#00ff00'})).toContain('rgba(0, 255, 0, 50%)')
  expect(recolorHtml(input,{'#ff0000':'#00ff00'})).toContain('bad-declaration')
})
it('clusters chromatic colors across the hue wrap and ranks total weight without mutating input',()=>{
  const colors=[{hex:'#ff0000',count:1,chroma:true},{hex:'#ff0080',count:2,chroma:true},{hex:'#00ff00',count:8,chroma:true},{hex:'#ffffff',count:99,chroma:false}]
  const before=structuredClone(colors), groups=clusterHues(colors)
  expect(groups.map(g=>g.total)).toEqual([8,3]);expect(groups[1].colors.map(c=>c.hex)).toEqual(['#ff0000','#ff0080'])
  expect(colors).toEqual(before)
})
it('harmonizes major and accent hue while preserving lightness, and falls back from neutral accent',()=>{
  const colors=[{hex:'#ff0000',count:5,chroma:true},{hex:'#ff9999',count:2,chroma:true},{hex:'#00ff00',count:1,chroma:true}]
  const mapped=harmonize(colors,{primary:'#0000ff',accent:'#ff00ff'})
  expect(mapped['#ff0000']).toBe('#0000ff');expect(mapped['#00ff00']).toBe('#ff00ff')
  expect(toHsl(mapped['#ff9999']).l).toBeCloseTo(toHsl('#ff9999').l,2)
  expect(harmonize(colors,{primary:'#0000ff',accent:'#888888'})['#00ff00']).toBe('#0000ff')
  expect(harmonize(colors,{primary:'#888888',accent:'#ff00ff'})).toEqual({})
  expect(harmonize([],{primary:'#0000ff',accent:'#ff00ff'})).toEqual({})
  expect(harmonize([colors[0]],{primary:'#ff0000',accent:'#0000ff'})).toEqual({})
})
it('uses dominant imported colors and falls back independently to theme colors',()=>{
  const theme={colors:{primary:'#123456',accent:'#654321',primarySoft:'#eee',text:'#222',muted:'#666',bg:'#fff',surface:'#fafafa',border:'#ccc'}}
  expect(docMainColors([createBlock('paragraph')],theme)).toEqual({primary:'#123456',accent:'#654321'})
  const html=createBlock('html',{html:'<div style="background:#f00"><b style="color:#0f0">文</b></div>'})
  expect(docMainColors([html],theme)).toEqual({primary:'#ff0000',accent:'#00ff00'})
  expect(docMainColors([createBlock('html',{html:'<b style="color:#f00">文</b>'})],theme)).toEqual({primary:'#ff0000',accent:'#654321'})
})
it('counts fixed raster decorations without treating SVG or JPEG photos as recolorable stickers',()=>{
  expect(fixedDecorCount('<img src="a.png?q=1"><img src="data:image/gif;base64,AA"><img src="https://x/mmbiz_png/1"><img src="photo.jpg"><img src="vector.svg"><img><div style="background-image:url(\'tile.gif\')"></div><div style="background-image:url(photo.jpg)"></div>')).toBe(4)
})
