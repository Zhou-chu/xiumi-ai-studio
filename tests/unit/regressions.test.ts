// 用户反馈问题的回归测试
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { compileBlock, compileDoc } from '../../src/core/compiler'
import { applyOps, validateOp } from '../../src/core/ops'
import { THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'
import { articleToHtmlBlocks, extractArticle } from '../../src/core/wxImport'
import { page } from './wxSvgRegressionFixture'

const doc = (blocks: Block[]): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks, createdAt: 0, updatedAt: 0 })

describe('AI 修改字段类型错误导致白屏', () => {
  it('insert heading with numeric index is coerced to string and renders', () => {
    const r = validateOp(doc([]), { op: 'insert', index: 0, block: { type: 'heading', props: { index: 1, title: '有鸢千里来相会', subtitle: null, variant: 'fancy' } } })
    const b = r.op!.op === 'insert' ? r.op!.block : null
    expect(b?.props).toMatchObject({ index: '1', title: '有鸢千里来相会', subtitle: '', variant: 'auto' })
    expect(() => compileBlock(b!, THEMES[0])).not.toThrow()
  })
  it('update with wrong shapes keeps the block renderable', () => {
    const base = doc(normalizeBlocks([{ id: 't1', type: 'timeline', props: {} }, { id: 'g1', type: 'gallery', props: {} }]))
    const ops = [
      validateOp(base, { op: 'update', id: 't1', props: { items: '09:00 签到' } }).op!,
      validateOp(base, { op: 'update', id: 'g1', props: { columns: '3', images: 'x', bogus: 1 } }).op!,
    ]
    const next = applyOps(base, ops)
    expect(Array.isArray((next.blocks[0].props as any).items)).toBe(true)
    expect((next.blocks[1].props as any).columns).toBe(3)
    expect((next.blocks[1].props as any).bogus).toBeUndefined()
    expect(compileDoc(next).warnings.filter((w) => w.includes('数据异常'))).toEqual([])
  })
  it('repairs a document saved with the broken block', () => {
    const saved = [{ id: 'x', type: 'heading', props: { index: 1, title: '有鸢千里来相会', subtitle: '能源44-计46联合主题团日', variant: 'auto' } }, { id: 'y', type: 'nope', props: {} }]
    const blocks = normalizeBlocks(saved)
    expect(blocks).toHaveLength(1)
    expect((blocks[0].props as any).index).toBe('1')
    expect(compileDoc(doc(blocks)).html).toContain('有鸢千里来相会')
  })

})

describe('链接导入后标题丢失', () => {
  // 结构仿照秀米 SVG 版式：标题文字在 foreignObject 内的 HTML 中，整篇包在带背景色的外壳里

  const a = extractArticle(new JSDOM(page).window.document)

  it('splits inside the background wrapper and re-applies it to each piece', () => {
    const blocks = articleToHtmlBlocks(a.root) as Block<'html'>[]
    expect(blocks.length).toBeGreaterThanOrEqual(3)
    for (const b of blocks) expect(b.props.html).toContain('background-color: rgb(245, 254, 241)')
    // 上内边距只在第一块、下内边距只在最后一块
    expect(blocks[0].props.html).toContain('padding-top: 20px')
    expect(blocks[1].props.html).toContain('padding-top: 0')
    expect(blocks.at(-1)!.props.html).toContain('padding-bottom: 20px')
    const html = compileDoc(doc(blocks)).html
    expect(html).toContain('齐鲁文化谈')
    expect(html).toContain('纸鸢梦工坊')
  })
})
