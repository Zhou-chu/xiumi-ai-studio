import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '../../src/core/sanitize'
const parse = (s: string) => new JSDOM(s).window.document
describe('sanitize', () => {
  it('keeps inline styles and drops scripts, handlers, classes and hidden nodes', () => {
    const html = sanitizeHtml(
      '<section class="a" id="b" style="color:red;visibility:hidden;position:fixed"><p onclick="x()">hi</p><script>bad()</script><p style="display:none">gone</p><a href="javascript:alert(1)">link</a></section>',
      parse,
    )
    expect(html).toBe('<section style="color: red"><p>hi</p><a>link</a></section>')
  })
  it('turns lazy images into https src and rejects foreign background urls', () => {
    const html = sanitizeHtml(
      '<img data-src="http://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" src="data:image/svg+xml,x" width="300"><section style="background-image:url(https://evil.com/x.png)" data-lazy-bgimg="https://mmbiz.qpic.cn/bg/0"></section>',
      parse,
    )
    expect(html).toContain('src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg"')
    expect(html).toContain('style="width: 300px"')
    expect(html).not.toContain('evil.com')
    expect(html).toContain('mmbiz.qpic.cn/bg/0')
  })
  it('keeps svg but strips event handlers', () => {
    const html = sanitizeHtml('<svg viewBox="0 0 1 1" onload="x()"><rect width="1" height="1" class="c"></rect></svg>', parse)
    expect(html).toContain('<svg viewBox="0 0 1 1">')
    expect(html).not.toMatch(/onload|class=/)
  })
})
