import { JSDOM } from 'jsdom'
import type { Block } from '../../src/core/types'
import { articleToHtmlBlocks } from '../../src/core/wxImport'
export const parse = (s: string) => new JSDOM(s).window.document
export const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 857 1142" style="width: 100%; background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
const carousel = (a: number, b: number) => `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0px"><section style="display: inline-block; width: 100%; background-color: rgb(236, 246, 228); padding: 10px 30px"><section style="display: inline-block; width: 100%; border-style: dashed; border-width: 3px"><svg viewBox="0 0 857 1142" style="display: block">${slide(a)}${slide(b)}${slide(a)}<rect width="857" height="1142" fill="transparent"></rect></svg></section></section></section>`
export const pill = (t: string) => `<section style="text-align: center; margin: 10px 0px"><section style="display: inline-block; width: 180px; background-color: #9cc393"><p><b>${t}</b></p></section></section>`
export const para = (t: string) => `<section style="font-size: 14px; padding: 0px 5px"><p>${t}</p></section>`
export const card = (inner: string, shell = 'display: inline-block; width: 100%; background-color: rgb(255, 255, 255); padding: 20px; height: auto') =>
      `<section style="background-color: rgb(245, 254, 241); font-size: 16px"><section style="display: flex; flex-flow: row nowrap; width: 100%; background-repeat: repeat-y; padding: 0px 15px; background-image: url(&quot;${JPG(9)}&quot;)"><section style="display: flex; flex-flow: row nowrap; width: 100%"><section style="${shell}">${inner}</section></section></section></section>`
export const chapter = `${pill('风筝制作')}${para('下面展示的是制作风筝的有趣瞬间。')}${carousel(1, 2)}${pill('风筝成果展示')}${para('形态各异的风筝纷纷诞生。')}${carousel(3, 4)}`
export const blocksOf = (html: string) => articleToHtmlBlocks(parse(`<body><div id="r">${html}<p>后记</p></div></body>`).getElementById('r')!) as Block<'html'>[]
export const words = (html: string) => (parse(`<body>${html}</body>`).body.textContent ?? '').replace(/\s/g, '')
