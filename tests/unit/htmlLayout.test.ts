// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { restructureImportedHtml } from '../../src/core/htmlLayout'
import { THEMES } from '../../src/core/themes'
const theme=THEMES.find(t=>t.id==='tsinghua-purple')!
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
it('rebuilds nested wrappers into ordered chapter sections without losing content or links',()=>{
 const source='<div><section><h2>Chapter one</h2><p>Hello <a href="https://example.com">world</a></p></section><div><img src="/a.png" alt="a"><h2>Chapter two</h2><p>End</p></div></div>'
 const result=restructureImportedHtml(source,'chapters',theme)
 expect(result.error).toBeUndefined()
 const doc=parse(result.html!)
 expect(doc.querySelectorAll('[data-layout-chapter]')).toHaveLength(2)
 expect(doc.body.textContent).toBe(parse(source).body.textContent)
 expect(doc.querySelector('a')?.outerHTML).toBe(parse(source).querySelector('a')?.outerHTML)
 expect(doc.querySelector('img')?.outerHTML).toBe(parse(source).querySelector('img')?.outerHTML)
 expect(result.html).not.toBe(source)
})
it('preserves tables SVG and complex background sections as intact ordered atoms',()=>{
 const atoms=['<table><tbody><tr><td>Table</td></tr></tbody></table>','<svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>','<section style="background-image:url(/bg.png);position:relative"><span>Opaque</span></section>']
 const source='<div><h2>Title</h2>'+atoms.join('')+'<p>End</p></div>'
 const result=restructureImportedHtml(source,'editorial',theme)
 expect(result.error).toBeUndefined()
 for(const atom of atoms) expect(result.html).toContain(parse(atom).body.innerHTML)
 expect(parse(result.html!).body.textContent).toBe(parse(source).body.textContent)
 expect(result.preserved).toBe(3)
})
it('refuses a wholly opaque layout rather than falsely claiming reconstruction',()=>{
 const source='<div style="position:absolute"><p>Cannot split safely</p></div>'
 expect(restructureImportedHtml(source,'editorial',theme).error).toBeTruthy()
})
it('keeps dark-background islands opaque so white text stays visible',()=>{
 const dark='<section style="background-color:#111111"><p style="color:#ffffff">White on dark</p></section>'
 const result=restructureImportedHtml('<h2>Safe heading</h2>'+dark,'chapters',theme)
 expect(result.preserved).toBe(1)
 expect(result.html).toContain(dark)
 expect(restructureImportedHtml(dark,'chapters',theme).error).toBeTruthy()
})
