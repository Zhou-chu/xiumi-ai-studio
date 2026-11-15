// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { backgroundPhotos, extractSlots, removeBackgroundPhotos, setBackgroundPhoto, setSlotColor, skeleton, slotColors } from '../../src/core/slots'
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
const src='https://example.invalid/photo.jpg?x=one'
const css=(s:string)=>`background-image:url('${s}');opacity:0.8`
const id=(html:string,text:string)=>{
 const slot=extractSlots(html).find(s=>s.kind==='text'&&s.text===text)
 if(!slot)throw Error('Fixture text slot not found')
 return slot.id
}

it('lists shared background photos once with counts and excludes textured or text-bearing boxes',()=>{
 const html=`<div style="${css(src)}"></div><div style="${css(src)}"></div><div style="${css('/media/other.jpg')}"></div><div style="${css('/fixture/texture.png')}"></div><div style="${css('/media/behind-lettering.jpg')}">可读文字</div>`
 expect(backgroundPhotos(html)).toEqual([{src,count:2},{src:'/media/other.jpg',count:1}])
 expect(backgroundPhotos('<p>没有背景</p>')).toEqual([])
})
it('replaces every match, using SVG geometry or an explicit aspect for a local replacement',()=>{
 const html=`<svg viewBox="0, 0, 400, 200" style="${css(src)}"></svg><section style="${css(src)}"></section><div style="${css('/media/other.jpg')}"></div>`
 const out=parse(setBackgroundPhoto(html,src,{src:'/media/next.jpg?previous=trim'},{ratio:0.75}))
 expect(out.querySelector('svg')!.getAttribute('style')).toBe('background-image: url("/media/next.jpg?fit=100%3A50&w=1080");opacity:0.8')
 expect(out.querySelector('section')!.getAttribute('style')).toBe('background-image: url("/media/next.jpg?fit=100%3A75&w=1080");opacity:0.8')
 expect(out.querySelector('div')!.getAttribute('style')).toBe(css('/media/other.jpg'))
 const remote=parse(setBackgroundPhoto(html,src,{src:'https://fixture.invalid/remote.jpg'},{ratio:2}))
 expect(remote.querySelector('svg')!.getAttribute('style')).toBe('background-image: url("https://fixture.invalid/remote.jpg");opacity:0.8')
 expect(setBackgroundPhoto(html,src,{src:'ftp://fixture.invalid/invalid.jpg'})).toBe(html)
})
it('returns unchanged markup for no removals and strips background addresses only from eligible skeleton cells',()=>{
 const html=`<div style="${css('/fixture/texture.png')}"> words </div><div style="${css(src)}"></div><img src="/media/example.jpg" alt="alt">`
 const out=parse(skeleton(html))
 expect(out.querySelector('div')!.getAttribute('style')).toBe(css('/fixture/texture.png'))
 expect(out.querySelectorAll('div')[1].getAttribute('style')).toBe('background-image: url();opacity:0.8')
 expect(out.querySelector('img')!.getAttribute('src')).toBe('')
 expect(out.querySelector('img')!.getAttribute('alt')).toBe('alt')
 expect(out.body.textContent).toBe('')
 const untouched=`<section style="${css('/fixture/texture.png')}">留</section>`
 expect(removeBackgroundPhotos(untouched)).toEqual({html:untouched,removed:0})
 expect(removeBackgroundPhotos('<p>保留</p>')).toEqual({html:'<p>保留</p>',removed:0})
})
it('recovers inherited HTML color and bare font attribute while ignoring inherit/currentColor',()=>{
 const html='<div style="color:#123456"><p style="color: inherit"><span style="color:currentColor">继承颜色</span></p></div><p><font color="#AA3344">历史习惯</font></p><p>无颜色</p>'
 const colors=slotColors(html)
 expect(colors[id(html,'继承颜色')]).toBe('#123456')
 expect(colors[id(html,'历史习惯')]).toBe('#aa3344')
 expect(colors[id(html,'无颜色')]).toBeNull()
})
it('sets only the chosen HTML slot, clears nested foreground overrides, and preserves unrelated presentation',()=>{
 const html='<p style="color:#123456;margin:9px"><font color="#aaa"><b style="font-weight:bold;color:#345678;-webkit-text-fill-color:#999">替换内容</b></font></p><p style="color:#202020">相邻内容</p>'
 const slot=id(html,'替换内容')
 const colored=setSlotColor(html,slot,'#456789')
 const parsed=parse(colored)
 expect(parsed.querySelector('font')?.hasAttribute('color')).toBe(false)
 expect(parsed.querySelector('b')?.getAttribute('style')).not.toMatch(/(^|;)[^;]*color/)
 expect(parsed.querySelector('p')?.getAttribute('style')).toContain('margin:9px')
 expect(slotColors(colored)[id(colored,'替换内容')]).toBe('#456789')
 expect(slotColors(colored)[id(colored,'相邻内容')]).toBe('#202020')
 const reset=setSlotColor(colored,id(colored,'替换内容'),null)
 expect(slotColors(reset)[id(reset,'替换内容')]).toBeNull()
 expect(setSlotColor(html,'missing','#000')).toBe(html)
 expect(setSlotColor(html,slot,'not a color')).toBe(html)
})
it('uses SVG fill rather than HTML foreground for vector text without touching vector geometry',()=>{
 const html='<svg viewBox="0 0 60 30"><path d="M0 0L60 30" fill="#123456"/><text x="4" y="10" fill="#aa0099"><tspan style="fill:#333333;font-size:12px">矢量文字</tspan></text></svg>'
 const updated=setSlotColor(html,id(html,'矢量文字'),'#665544')
 const output=parse(updated)
 expect(output.querySelector('path')?.getAttribute('d')).toBe('M0 0L60 30')
 expect(output.querySelector('path')?.getAttribute('fill')).toBe('#123456')
 expect(output.querySelector('tspan')?.getAttribute('style')).toContain('font-size:12px')
 expect(slotColors(updated)[id(updated,'矢量文字')]).toBe('#665544')
})
