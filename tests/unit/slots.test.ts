import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const SECTION = `<section style="background-color: #f5f0e6; padding: 16px">
  <section style="text-align: center"><span style="font-size: 12px; color: #999">PART 01</span></section>
  <p style="font-size: 20px"><strong><span style="color: #8a1c2b">【</span>开幕式<span style="color: #8a1c2b">】</span></strong></p>
  <p style="font-size: 15px; text-indent: 2em"><span style="color: #333">9 月 20 日上午，开幕式在大礼堂举行，</span><span style="color: #8a1c2b">320 名同学</span>参加。</p>
  <img src="https://mmbiz.qpic.cn/a/640?wx_fmt=jpeg" style="width: 100%">
  <p style="font-size: 12px; color: #999; text-align: center">▲ 开幕式现场</p>
  <img src="https://mmbiz.qpic.cn/icon/640?wx_fmt=png" style="width: 24px">
  <img src="https://mmbiz.qpic.cn/sticker/0?wx_fmt=gif">
</section>`

describe('AI edits on imported fragments', () => {
  // ops.ts 在浏览器中使用全局 DOMParser
  beforeEach(() => vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser))
  afterEach(() => vi.unstubAllGlobals())
  const block = { id: 'h1', type: 'html' as const, props: { html: SECTION, label: '开幕式' } }
  const doc = { id: 'd', title: 't', author: '', digest: '', themeId: 'x', blocks: [block], createdAt: 0, updatedAt: 0 }

  it('updates text slots and recomputes html from the current block', async () => {
    const { validateOp, applyOp } = await import('../../src/core/ops')
    const r = validateOp(doc, { op: 'update', id: 'h1', slots: { t1: '颁奖典礼', t9: 'x' }, props: { html: '<script>bad()</script>' } })
    expect(r.op).toMatchObject({ op: 'update', slots: { t1: '颁奖典礼' } })
    const next = applyOp(doc, r.op!)
    expect((next.blocks[0].props as any).html).toContain('<strong>颁奖典礼</strong>')
    expect((next.blocks[0].props as any).html).not.toContain('script')
    // 接受时按当前文档重新计算
    const again = validateOp(next, r.op)
    expect((again.op as any).props.html).toBe((next.blocks[0].props as any).html)
  })
  it('rejects raw html and unknown slots', async () => {
    const { validateOp } = await import('../../src/core/ops')
    expect(validateOp(doc, { op: 'update', id: 'h1', props: { html: '<p>x</p>' } }).error).toBeTruthy()
    expect(validateOp(doc, { op: 'update', id: 'h1', slots: { zz: 'x' } }).error).toBeTruthy()
    expect(validateOp(doc, { op: 'insert', index: 0, block: { type: 'html', props: { html: '<p>x</p>' } } }).error).toBeTruthy()
  })
  it('gives the model text slots instead of html', async () => {
    const { aiContext } = await import('../../src/core/quickActions')
    const ctx = aiContext(doc)
    expect(ctx.blocks[0].props).toMatchObject({ label: '开幕式', slots: [{ id: 't0', role: 'number' }, { id: 't1', role: 'title', text: '【开幕式】' }, { id: 't2' }, { id: 't3' }] })
    expect(JSON.stringify(ctx)).not.toContain('<section')
  })
})
