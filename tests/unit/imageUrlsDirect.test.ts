// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { displayHtml, displayUrl, rehostUrls, rewriteImages, storedHtml } from '../../src/core/images'
const a='https://img.xiumi.us/a.png',b='https://xiumius.cn/b.jpg',c='https://mmbiz.qpic.cn/c.png'
const dom=(s:string)=>new DOMParser().parseFromString(s,'text/html')
it('collects unique supported hosts from img, SVG and backgrounds without requesting resources',()=>{
  expect(rehostUrls(`<img src="${a}"><img src="${a}"><img src="${c}"><img><svg><image href="${b}"/><image xlink:href="${a}"/></svg><p style="background:url('${b}');color:red"></p><p style="color:red"></p><img src="https://xiumi.us.evil.invalid/no.png">`)).toEqual([a,b])
})
it('replaces only explicitly mapped img, SVG attribute and CSS URL values while keeping other content',()=>{
  const input=`<img src="${a}"><img src="${c}"><svg><image href="${a}" xlink:href="${b}"/></svg><p style="background:url('${a}');mask:url(${c});color:red">原文</p><p style="color:red">尾部</p>`
  const out=dom(rewriteImages(input,{[a]:'/media/a.png',[b]:'/media/b.jpg'}))
  expect([...out.querySelectorAll('img')].map(n=>n.getAttribute('src'))).toEqual(['/media/a.png',c])
  expect(out.querySelector('image')!.getAttribute('href')).toBe('/media/a.png')
  expect(out.querySelector('image')!.getAttribute('xlink:href')).toBe('/media/b.jpg')
  expect(out.querySelector('p')!.getAttribute('style')).toBe(`background:url("/media/a.png");mask:url(${c});color:red`)
  expect(out.body.textContent).toBe('原文尾部')
  expect(out.querySelectorAll('p')[1].getAttribute('style')).toBe('color:red')
})
it('returns original bytes for an empty mapping and leaves missing SVG/image attributes untouched',()=>{
  const input='<IMG><svg><image/></svg><p style="margin:0"> 原文 </p>'
  expect(rewriteImages(input,{})).toBe(input)
  const out=dom(rewriteImages(input,{[a]:'/media/new.png'}))
  expect(out.querySelector('img')!.hasAttribute('src')).toBe(false)
  expect(out.querySelector('image')!.hasAttribute('href')).toBe(false)
})
it('proxies only HTTPS WeChat display URLs while preserving unrelated and local addresses',()=>{
  expect(displayUrl(c)).toBe('/api/wx-image?u='+encodeURIComponent(c))
  expect(displayUrl('https://wx.qlogo.cn/logo')).toBe('/api/wx-image?u='+encodeURIComponent('https://wx.qlogo.cn/logo'))
  for(const url of [a,'/media/a.png','http://mmbiz.qpic.cn/x'])expect(displayUrl(url)).toBe(url)
})
it.each(['"',"'",'&quot;',''])('round-trips a display-only background with escaped query and quote form %s',(q)=>{
  const input=`<section style='background-image:url(${q}${c}?a=1&amp;b=2${q});color:red'><img src="${c}">文</section>`
  const display=displayHtml(input)
  expect(display).toContain('/api/wx-image?u='+encodeURIComponent(c+'?a=1&b=2'))
  expect(display).toContain(`<img src="${c}">`)
  expect(storedHtml(display)).toBe(input)
  expect(displayHtml(display)).toBe(display)
  expect(storedHtml(input)).toBe(input)
})
