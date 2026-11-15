import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { splitHtmlBlock } from '../../src/core/wxImport'
import { blocksOf, card, chapter, JPG, para, parse, pill, words } from './importCardFixture'
describe('sections that hold a whole chapter in one card (direct)', () => {
it('gives each carousel a block of its own, wrapped in the same shells', () => {
      const blocks = blocksOf(card(chapter))
      expect(blocks.map((b) => b.props.label)).toEqual(['风筝制作', '下面展示的是制作风筝的有', '轮播（2 张）', '风筝成果展示', '形态各异的风筝纷纷诞生。', '轮播（2 张）', '后记'])
      const [first, , car, , , last] = blocks.map((b) => b.props.html)
      expect(car).toContain('<svg')
      expect(words(car)).toBe('')
      for (const b of blocks.slice(0, 6)) {
        expect(b.props.html).toContain('repeat-y')
        expect(b.props.html).toContain('background-color: rgb(255, 255, 255)')
      }
      // 卡片的上内边距只留给第一块，下内边距只留给最后一块，拼起来和原来一样
      expect(first).toContain('padding-top: 20px')
      expect(first).toContain('padding-bottom: 0')
      expect(car).toContain('padding-top: 0; padding-right: 20px; padding-bottom: 0')
      expect(last).toContain('padding-bottom: 20px')
      expect(blocks.map((b) => words(b.props.html)).join('')).toBe(words(card(chapter)) + '后记')
    })
it('splits an already imported block on request, keeping its source', () => {
      const source = { kind: 'wechat' as const, title: '风筝', url: '', account: '' }
      const old = createBlock('html', { html: card(chapter), label: '大版块', source })
      const parts = splitHtmlBlock(old, parse)!
      expect(parts.map((b) => b.props.label)).toEqual(['风筝制作', '下面展示的是制作风筝的有', '轮播（2 张）', '风筝成果展示', '形态各异的风筝纷纷诞生。', '轮播（2 张）'])
      expect(parts.every((b) => b.props.source === source && b.id !== old.id)).toBe(true)
      expect(new Set(parts.map((b) => b.id)).size).toBe(parts.length)
      // 手动拆开时小卡片也拆；纯文字和拆不开的外壳不拆
      expect(splitHtmlBlock(createBlock('html', { html: card(`${pill('标题')}${para('正文')}`), label: 'x' }), parse)).toHaveLength(2)
      expect(splitHtmlBlock(createBlock('html', { html: '<p>一段</p><p>两段</p>', label: 'x' }), parse)).toBeNull()
      expect(splitHtmlBlock(createBlock('html', { html: card(chapter, 'display: inline-block; width: 100%; box-shadow: 0 0 4px #000'), label: 'x' }), parse)).toBeNull()
    })
it('splits a very large card even without a carousel', () => {
      const long = Array.from({ length: 70 }, (_, i) => `${pill(`小标题${i}`)}${para('正文'.repeat(40))}`).join('')
      expect(blocksOf(card(long)).length).toBeGreaterThan(100)
    })
it('keeps small cards, rows and shells that cannot be cut in one piece', () => {
      expect(blocksOf(card(`${pill('标题')}${para('正文')}`))).toHaveLength(2)
      // 固定高度、阴影、整张背景图的外壳拆开会变样
      for (const shell of ['display: inline-block; width: 100%; height: 900px', 'display: inline-block; width: 100%; box-shadow: 0 0 4px #000', `display: inline-block; width: 100%; background-image: url(&quot;${JPG(8)}&quot;); background-size: cover`]) {
        expect(blocksOf(card(chapter, shell))).toHaveLength(2)
      }
      // 横排的两栏
      expect(blocksOf(card(chapter, 'display: flex; flex-flow: row nowrap; width: 100%'))).toHaveLength(2)
    })
})
