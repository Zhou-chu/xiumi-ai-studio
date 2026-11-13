import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { guardHtml } from '../../src/core/sanitize'
const parse = (html: string) => new JSDOM(html).window.document
it.each([
 'javascript:alert(1)', 'java&#x73;cript:alert(1)', 'jav&#97;script:alert(1)',
 'JaVaScRiPt:alert(1)', 'java&#9;script:alert(1)', 'java\nscript:alert(1)',
 '&#x01;javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
])('removes dangerous parsed link protocol %s', url => {
 const doc=parse(guardHtml(`<a href="${url}">link</a>`));const a=doc.querySelector('a')!
 expect(a.textContent).toBe('link');expect(a.hasAttribute('href')).toBe(false)
})
it.each(['https://example.com/a?b=1&c=2','http://example.com','mailto:reader@example.com','#chapter','/media/image.png'])('preserves permitted link %s',url=>{
 const a=parse(guardHtml(`<a href="${url}">link</a>`)).querySelector('a')!
 expect(a.getAttribute('href')).toBe(url)
})
it('retains publication SVG and inline layout while removing active attributes',()=>{
 const doc=parse(guardHtml('<section style="display:flex;color:#333"><svg viewBox="0 0 20 20"><defs><linearGradient id="gradient"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="20" height="20" fill="red"/><text x="1" y="10">中文</text><foreignObject width="20" height="20"><p style="font-size:14px">正文</p></foreignObject></svg><img src="/media/a.png" onerror="bad()"></section>'))
 expect(doc.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 20 20')
 expect(doc.querySelector('rect')?.getAttribute('fill')).toBe('red');expect(doc.querySelector('foreignObject p')?.textContent).toBe('正文')
 expect(doc.querySelector('section')?.getAttribute('style')).toContain('display:flex');expect(doc.querySelector('[onerror]')).toBeNull()
})
it('prevents SVG animation from reintroducing a dangerous link',()=>{
 const doc=parse(guardHtml('<svg><a><text>link</text><animate attributeName="href" values="java&#x73;cript:alert(1)" dur="1s"/></a></svg>'))
 expect(doc.querySelector('animate')).toBeNull()
})
it('retains safe SVG opacity animation without handlers',()=>{
 const doc=parse(guardHtml('<svg><circle r="4"><animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" onbegin="bad()"/></circle></svg>'))
 expect(doc.querySelector('animate')?.getAttribute('attributeName')).toBe('opacity');expect(doc.querySelector('[onbegin]')).toBeNull()
})
it('drops active foreign content and malformed markup event payloads',()=>{
 const doc=parse(guardHtml('<svg><foreignObject><iframe srcdoc="bad"></iframe><p onclick="bad()">safe</p></foreignObject></svg><img src=x onerror=bad()><script>bad()</script><form action="javascript:bad()"></form>'))
 expect(doc.querySelector('script,iframe,form,[onclick],[onerror]')).toBeNull()
})
import { createBlock } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
it('protects the real raw-HTML compiler output, not only an isolated helper',()=>{
 const block=createBlock('html',{html:'<a href="java&#x73;cript:alert(1)">article</a><svg><set attributeName="href" to="javascript:alert(1)"/></svg>',label:'unsafe stored article'})
 const doc=parse(compileBlock(block,THEMES[0]));expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);expect(doc.querySelector('set')).toBeNull()
})
it.each(['href','xlink:href','onload','style'])('rejects SMIL mutation of %s',attribute=>{
 expect(parse(guardHtml(`<svg><animate attributeName="${attribute}" values="javascript:alert(1)"/></svg>`)).querySelector('animate')).toBeNull()
})
it('preserves safe transform animation and strips remote animation targeting',()=>{
 const doc=parse(guardHtml('<svg><g><animateTransform attributeName="transform" type="translate" values="0 0;10 0" dur="1s" href="https://other.test/#target"/></g></svg>'))
 const animation=doc.querySelector('animateTransform');expect(animation?.getAttribute('type')).toBe('translate');expect(animation?.hasAttribute('href')).toBe(false)
})
it.each(['values','from','to','by'])('rejects URL-like SMIL value in %s even on a permitted geometric attribute',valueAttribute=>{
 const doc=parse(guardHtml(`<svg><rect><animate attributeName="x" ${valueAttribute}="java&#x73;cript:alert(1)"/></rect></svg>`))
 expect(doc.querySelector('animate')).toBeNull()
})
it('keeps text safe through foreignObject namespace transitions and reparsing',()=>{
 const markup='<svg><foreignObject><p>safe</p><svg><a xlink:href="java&#x73;cript:alert(1)"><text>nested</text></a></svg><math><mtext><img src="x" onerror="alert(1)"></mtext></math></foreignObject></svg>'
 const doc=parse(guardHtml(markup));expect(doc.querySelector('foreignObject p')?.textContent).toBe('safe')
 expect(doc.querySelector('[onerror]')).toBeNull();expect(doc.querySelector('a')?.hasAttribute('xlink:href')).toBe(false)
})
