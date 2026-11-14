import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { restyleImportedHtml } from '../../src/core/htmlTheme'
import { THEMES } from '../../src/core/themes'

const parse = (html:string) => new JSDOM(html).window.document
const purple=THEMES[0]
describe('explicit imported HTML theme adaptation',()=>{
 it('changes visual styles while retaining text, order, images, tables and links',()=>{
  const html='<section style="border:1px solid #cc3300"><h2 style="color:#cc3300">标题</h2><p style="font-size:30px"><span style="font-family:Arial;font-size:10px">内容</span><strong>重点</strong></p><img src="https://mmbiz.qpic.cn/a.png" alt="原图"><table><tr><td>数据</td></tr></table><a href="https://mp.weixin.qq.com/a">来源</a></section>'
  const out=restyleImportedHtml(html,purple,parse),before=parse(html),after=parse(out)
  expect(after.body.textContent).toBe(before.body.textContent)
  expect(after.querySelector('img')?.outerHTML).toBe(before.querySelector('img')?.outerHTML)
  expect(after.querySelector('a')?.getAttribute('href')).toBe('https://mp.weixin.qq.com/a')
  expect(after.querySelector('h2')?.style.color).toBe('rgb(102, 8, 116)')
  expect(after.querySelector('p')?.style.fontSize).toBe('15px')
  expect(after.querySelector('span')?.style.fontSize).toBe('')
  expect(after.querySelectorAll('table tr td')).toHaveLength(1)
 })
 it('preserves SVG geometry, raster URLs, code and semantic emphasis',()=>{
  const html='<svg><text style="font-size:8px">图内文字</text><path d="M0 0" fill="#cc3300"/></svg><pre style="font-size:9px">x</pre><p><em>斜体</em><u>下划线</u><img src="/media/x.png"></p>'
  const after=parse(restyleImportedHtml(html,purple,parse))
  expect(after.querySelector('svg text')?.getAttribute('style')).toBe('font-size:8px')
  expect(after.querySelector('path')?.getAttribute('d')).toBe('M0 0')
  expect(after.querySelector('pre')?.style.fontSize).toBe('9px')
  expect(after.querySelector('img')?.getAttribute('src')).toBe('/media/x.png')
  expect(after.querySelectorAll('em,u')).toHaveLength(2)
 })
})
