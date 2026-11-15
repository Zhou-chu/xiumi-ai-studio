import { expect, it, vi } from 'vitest'
import { asciiHtml, checkedXiumiParts, makeZip, replaceLocalImages, xiumiLength, xiumiReport, xiumiSvgBoxes } from '../../src/core/xiumiExport'

it('rejects unsplittable text and SVG instead of silently exporting oversized files', () => {
  for (const html of [`<section><p>${'字'.repeat(140000)}</p></section>`, `<svg><path d="${'M1 1 '.repeat(30000)}"></path></svg>`]) {
    expect(() => checkedXiumiParts(html)).toThrow(/手动拆分/)
  }
})

it('keeps safely split content complete and bounded', () => {
  const html = `<section>${Array.from({length: 8}, (_, i) => `<p>${i}${'字'.repeat(20000)}</p>`).join('')}</section>`
  const parts = checkedXiumiParts(html)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(p => p.length <= 120000)).toBe(true)
  expect(parts.map(p => p.slice(9, -10)).join('')).toBe(html.slice(9, -10))
})

it('writes HTML text and attribute characters as ASCII without corrupting supplementary code points', () => {
  expect(asciiHtml('<p title="京">字•😀</p>')).toBe('<p title="&#x4EAC;">&#x5B57;&#x2022;&#x1F600;</p>')
})

it('counts recognized entity references as one character each', () => {
  expect(xiumiLength('&amp;&#x1F600;&#169;abc')).toBe(6)
  expect(xiumiLength('&#xNO;')).toBe(6)
})

it('moves exterior SVG layout declarations to the correct wrapper while preserving inner geometry', () => {
  const html=xiumiSvgBoxes('<svg viewBox="0 0 10 10" style="display:inline-block;width:20px;margin:0 auto;vertical-align:middle;overflow:hidden"><path d="M0 0L1 1"/></svg>')
  expect(html).toMatch(/^<span [^>]+><svg viewBox="0 0 10 10" [^>]+><path d="M0 0L1 1"\/><\/svg><\/span>$/)
  const declarations=[...html.matchAll(/style="([^"]*)"/g)].map(match=>match[1].split(';').sort())
  expect(declarations).toEqual([
    ['display:inline-block','width:20px','margin:0 auto','vertical-align:middle','line-height:0','font-size:0'].sort(),
    ['display:block','width:20px','overflow:hidden'].sort(),
  ])
})

it('gives repeated image and background occurrences one replacement callback in document order', () => {
  const html='<img src="/media/one.jpg?q=1&amp;x=2"><p style="background-image:url(&quot;/media/one.jpg?q=1&amp;x=2&quot;)"></p><img src="/media/two.jpg">'
  const choose=vi.fn((_url: string,index: number)=>'/fixture/image-'+index)
  expect(replaceLocalImages(html,choose)).toEqual({
    urls:['/media/one.jpg?q=1&x=2','/media/two.jpg'],
    html:'<img src="/fixture/image-0"><p style="background-image:url(&quot;/fixture/image-0&quot;)"></p><img src="/fixture/image-1">',
  })
  expect(choose.mock.calls).toEqual([['/media/one.jpg?q=1&x=2',0],['/media/two.jpg',1]])
})

it('distinguishes distinct local assets from inline and repeated background placements', () => {
  const html='<img src="/media/one.jpg"><section style="background-image: url(/media/one.jpg)"></section><section style="background-image:url(/media/two.jpg)"></section><img src="data:image/png;base64,fixture">'
  expect(xiumiReport(html)).toEqual({localImages:2,localBackgrounds:2,dataImages:1,backgrounds:2})
})

it('stores the original UTF-8 file name and bytes in a ZIP with matching local and central headers', () => {
  const zip=makeZip([{name:'正文.txt', data:new Uint8Array([1,2,3])}])
  const read=new DataView(zip.buffer,zip.byteOffset,zip.byteLength)
  expect(read.getUint32(0,true)).toBe(0x04034b50)
  expect(read.getUint16(6,true)).toBe(0x0800)
  const count=read.getUint16(26,true)
  expect(new TextDecoder().decode(zip.subarray(30,30+count))).toBe('正文.txt')
  expect([...zip.subarray(30+count,33+count)]).toEqual([1,2,3])
  expect(read.getUint32(33+count,true)).toBe(0x02014b50)
  expect(read.getUint32(33+count+16,true)).toBe(read.getUint32(14,true))
  expect(read.getUint32(zip.length-22,true)).toBe(0x06054b50)
})
