// 粘贴整页富文本：去掉来源页面的外框，把写死的像素尺寸换回百分比
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { sourceColumn } from '../../src/core/fluid'
import type { Block } from '../../src/core/types'
import { articleToHtmlBlocks, extractArticle } from '../../src/core/wxImport'

const page = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'pasted-reader-page.html'), 'utf8')
const parse = (s: string) => new JSDOM(s).window.document
describe('整页复制的阅读页', () => {
  const a = extractArticle(parse(page))
  const blocks = articleToHtmlBlocks(a.root) as Block<'html'>[]
  const html = blocks.map((b) => b.props.html).join('')

  it('keeps only the article body and reads the title from the page header', () => {
    expect(a.title).toBe('夏季运动会报名通知')
    expect(html).toContain('夏季运动会')
    expect(html).toContain('比赛项目包括')
    expect(html).not.toMatch(/投诉|阅读|2026-05-01|data:image/)
  })
  it('drops the negative margins of the page frame', () => {
    expect(html).not.toMatch(/margin-(left|right): -31px/)
    expect(html).not.toContain('padding-left: 16px')
  })
  it('finds the source column width', () => {
    expect(sourceColumn(a.root)?.width).toBe(600)
  })
  it('splits into modules and keeps the background shell around each without gaps', () => {
    expect(blocks.length).toBe(3)
    for (const b of blocks) {
      expect(b.props.html).toContain('background-color: rgb(238, 246, 255)')
      expect(b.props.html).toContain('display: flow-root')
    }
  })
  it('recognises the page frame without class names', () => {
    const bare = extractArticle(parse(page.replace(/ class="[^"]*"/g, '')))
    expect(bare.title).toBe('夏季运动会报名通知')
    const text = bare.root.textContent ?? ''
    expect(text).toContain('比赛项目包括')
    expect(text).not.toMatch(/投诉|2026-05-01/)
    expect(bare.root.innerHTML).not.toMatch(/data:image|margin-left: -31px/)
  })
  it('does not treat an ordinary pasted fragment as a page', () => {
    const plain = extractArticle(parse('<h2>标题</h2><p>第一段</p><p>第二段</p>'))
    expect(plain.root.textContent).toContain('标题')
    expect(plain.root.textContent).toContain('第二段')
  })
  it('drops an empty shell at the very beginning instead of making an empty module', () => {
    const doc = parse('<section style="box-sizing: border-box; font-size: 0px"><section style="box-sizing: border-box; width: 0px; height: 0px"></section></section><p>正文</p>')
    const list = articleToHtmlBlocks(extractArticle(doc).root) as Block<'html'>[]
    expect(list).toHaveLength(1)
    expect(list[0].props.html).toBe('<p>正文</p>')
  })
})

describe('复制时丢了动画的淡入图层', () => {
  const layer = (inner: string) =>
    `<section><svg viewBox="0 0 100 100"><svg width="20%" height="20%" x="0%" y="0%" opacity="0"><foreignObject width="100%" height="100%"></foreignObject>${inner}</svg><rect width="10" height="10" opacity="0"></rect></svg><p>正文</p></section>`
  it('shows a layer whose fade-in animation was lost, but leaves transparent hit areas alone', () => {
    const html = extractArticle(parse(layer(''))).root.innerHTML
    expect(html).toContain('<svg width="20%" height="20%" x="0%" y="0%">')
    expect(html).toContain('<rect width="10" height="10" opacity="0">')
  })
  it('keeps the starting state when the animation is still there', () => {
    const html = extractArticle(parse(layer('<animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"></animate>'))).root.innerHTML
    expect(html).toContain('y="0%" opacity="0"')
  })
})
