// @vitest-environment jsdom
import { expect,it } from 'vitest'
import { articleToHtmlBlocks,cardContent,contentLayer } from '../../src/core/wxImport'
const root=(s:string)=>new DOMParser().parseFromString('<main>'+s+'</main>','text/html').querySelector('main')!
const parts=(s:string)=>articleToHtmlBlocks(root('<p>Prefix</p>'+s),1,true).slice(1)
const html=(b:ReturnType<typeof parts>[number])=>{if(b.type!=='html')throw Error('fixture');return b.props.html}
const styled=(s:string)=>parts(`<section style="background:#eee">${s}</section>`)
it('distributes four-sided wrapper edges without duplicating vertical padding or borders',()=>{
 const blocks=parts('<section style="background:#eee;padding:2px 4px 6px 8px;margin:10px 12px 14px 16px;border:1px solid black;border-radius:9px"><p>A</p><p>B</p><p>C</p></section>')
 expect(blocks).toHaveLength(3)
 const styles=blocks.map(b=>(root(html(b)).firstElementChild as HTMLElement).style)
 expect(styles.map(s=>[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft])).toEqual([['2px','4px','0px','8px'],['0px','4px','0px','8px'],['0px','4px','6px','8px']])
 expect(styles.map(s=>[s.marginTop,s.marginBottom])).toEqual([['10px','0px'],['0px','0px'],['0px','14px']])
 expect(styles.map(s=>s.borderRadius)).toEqual(['9px 9px 0 0','0 0 0 0','0 0 9px 9px'])
 expect(styles.map(s=>s.display)).toEqual(['flow-root','flow-root','flow-root'])
})
it.each([['10px','20px','10px'],['20px','10px','0px'],['10px','10px','0px']])('preserves collapsed positive sibling margin %s / %s', (bottom,top,want)=>{
 const blocks=styled(`<p style="margin-bottom:${bottom}">A</p><p style="margin-top:${top}">B</p>`)
 expect(blocks).toHaveLength(2)
 expect((root(html(blocks[1])).querySelector('p') as HTMLElement).style.marginTop).toBe(want)
})
it.each(['-5px','1em','auto'])('does not invent pixel collapse for uncertain margin %s',value=>{
 const blocks=styled(`<p style="margin-bottom:10px">A</p><p style="margin-top:${value}">B</p>`)
 expect((root(html(blocks[1])).querySelector('p') as HTMLElement).style.marginTop).toBe(value)
})
it('stores inherited card content with nearest text styles and preserves explicit child overrides',()=>{
 const blocks=parts('<section style="background:#eee;color:#123456;font-family:serif"><div style="color:#abcdef;font-size:18px"><p style="color:#fedcba">A</p><p>B</p></div></section>')
 expect(blocks).toHaveLength(2)
 const a=root(cardContent.get(blocks[0])!),b=root(cardContent.get(blocks[1])!)
 expect((a.querySelector('p') as HTMLElement).style.color).toBe('rgb(254, 220, 186)')
 expect((b.querySelector('p') as HTMLElement).style.color).toBe('rgb(171, 205, 239)')
 expect((b.querySelector('p') as HTMLElement).style.fontFamily).toBe('serif')
 expect((b.querySelector('p') as HTMLElement).style.fontSize).toBe('18px')
})
it('stops wrapper peeling after sixteen levels and never mutates the supplied DOM',()=>{
 const original=root('<section>'.repeat(20)+'<p>A</p><p>B</p>'+'</section>'.repeat(20))
 const before=original.outerHTML
 const {layer}=contentLayer(original)
 let depth=0;for(let e:Element|null=layer;e&&e!==original;e=e.parentElement)depth++
 expect(depth).toBe(16);expect(original.outerHTML).toBe(before)
})
