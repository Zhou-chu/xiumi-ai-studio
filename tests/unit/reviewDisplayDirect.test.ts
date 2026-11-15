// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { resolveTheme } from '../../src/core/themes'
import { boxTheme } from '../../src/core/kit'
import type { Block, Doc, DocOp } from '../../src/core/types'
import type { Proposal, ProposalItem } from '../../src/editor/store'
import { reviewItems } from '../../src/editor/reviewDisplay'

const h = vi.hoisted(() => ({ resolve: vi.fn(), block: vi.fn(), doc: vi.fn(), replay: vi.fn(), times: vi.fn() }))
vi.mock('../../src/editor/proposalSafety', () => ({ resolveProposalItems: h.resolve }))
vi.mock('../../src/core/compiler', () => ({ compileBlock: h.block, compileDoc: h.doc, compileReplay: h.replay }))
vi.mock('../../src/core/replay', () => ({ replayFinalTimes: h.times }))
const makeDoc = (...blocks: Block[]): Doc => ({ id: 'fixture', title: '旧标题', author: '旧作者', digest: '旧摘要', blocks, createdAt: 1, updatedAt: 2, themeId: 'minimal-magazine' })
const a = { ...createBlock('heading', { title: '标题甲' }), id: 'a' }
const b = { ...createBlock('heading', { title: '标题乙' }), id: 'b' }
const doc = makeDoc(a, b)
const spec = (base: Doc, ...ops: DocOp[]): Proposal => ({ base, items: ops.map(op => ({ op, status: 'pending' })), summary: '', errors: [], ignoredOps: 0, selectionPolicy: 'strict' })
function resolveFrom(base: Proposal, index: number, changed: Doc, op = base.items[index].op, status: ProposalItem['status'] = 'accepted', errors: string[] = []) {
  const items = base.items.slice()
  items[index] = { op, status }
  return { proposal: { ...base, items, errors }, doc: changed }
}
const unsupported = () => { throw Error('Unexpected isolated review renderer boundary') }
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset().mockImplementation(unsupported)
})
it('does not project non-pending items and uses the exact inserted identity the resolver returns', () => {
  const requested = { ...createBlock('paragraph'), id: 'request-id' }
  const result = { ...requested, id: 'resolved-id' }
  const plan = spec(doc, { op: 'remove', id: 'a' }, { op: 'insert', index: 1, block: requested }, { op: 'remove', id: 'b' })
  plan.items[0].status = 'accepted'
  plan.items[2].status = 'rejected'
  const resolvedDoc = { ...doc, blocks: [a, result, b] }
  h.resolve.mockReturnValue(resolveFrom(plan, 1, resolvedDoc, { op: 'insert', index: 1, block: result }))
  h.block.mockReturnValue('<p>新增投影</p>')
  const out = reviewItems(plan, doc)
  expect(h.resolve).toHaveBeenCalledExactlyOnceWith(plan, doc, 1, 'accepted')
  expect(h.block).toHaveBeenCalledExactlyOnceWith(result, resolveTheme(resolvedDoc))
  expect(out[0]).toMatchObject({ index: 1, kind: 'insert', beforeId: 'b', position: 2, html: '<p>新增投影</p>', projected: resolvedDoc })
  expect(out).toHaveLength(1)
  expect(plan.items[1].op).toMatchObject({ block: { id: 'request-id' } })
})
it('attaches nested projection to a separately targeted parent but uses its in-box rendering context', () => {
  const box = { ...createBlock('box', { children: [a] }), id: 'box' }
  const original = makeDoc(box, b)
  const plan = spec(original, { op: 'remove', id: 'box' }, { op: 'update', id: 'a', props: { title: '新标题' }, reason: '简化' })
  const newChild = { ...a, props: { ...a.props, title: '新标题' } }
  const updated = { ...original, blocks: [{ ...box, props: { ...box.props, children: [newChild] } }, b] }
  h.resolve.mockReturnValueOnce(resolveFrom(plan, 0, { ...original, blocks: [b] })).mockReturnValueOnce(resolveFrom(plan, 1, updated))
  h.block.mockReturnValue('<h1>新标题</h1>')
  const out = reviewItems(plan, original)
  expect(out[0]).toMatchObject({ index: 0, targetId: 'box', attachmentId: 'box', html: '' })
  expect(out[1]).toMatchObject({ index: 1, targetId: 'a', attachmentId: 'box', reason: '简化', html: '<h1>新标题</h1>' })
  expect(h.block).toHaveBeenCalledExactlyOnceWith(newChild, boxTheme(resolveTheme(updated)), { inBox: true })
})
it('keeps stale missing-block suggestions as visible orphans without rendering them', () => {
  const plan = spec(doc, { op: 'update', id: 'missing', props: {} }, { op: 'remove', id: 'missing2' })
  h.resolve.mockReturnValueOnce(resolveFrom(plan, 0, doc, undefined, 'rejected', ['更旧错误','文稿已变化']))
    .mockReturnValueOnce(resolveFrom(plan, 1, doc, undefined, 'rejected'))
  const out = reviewItems(plan, doc)
  expect(out.map(x => [x.targetId, x.beforeId, x.html, x.error])).toEqual([
    [undefined, undefined, '', '文稿已变化'], [undefined, undefined, '', '建议已过期'],
  ])
  expect(h.block).not.toHaveBeenCalled()
  expect(h.doc).not.toHaveBeenCalled()
})
it('prepares article metadata and renders two independently supplied theme previews', () => {
  const plan = spec(doc, { op: 'setMeta', title: '新标题' }, { op: 'setTheme', themeId: 'thu-eea-de' })
  const meta = { ...doc, title: '新标题' }
  const themed = { ...doc, themeId: 'thu-eea-de' }
  h.resolve.mockReturnValueOnce(resolveFrom(plan, 0, meta)).mockReturnValueOnce(resolveFrom(plan, 1, themed))
  h.doc.mockReturnValueOnce({ html: '<main>新主题</main>' }).mockReturnValueOnce({ html: '<main>旧主题</main>' })
  const out = reviewItems(plan, doc)
  expect(out[0]).toMatchObject({ beforeId: 'a', beforeMeta: '标题：旧标题\n作者：旧作者\n摘要：旧摘要', html: '', projected: meta })
  expect(out[1]).toMatchObject({ beforeId: 'a', beforeHtml: '<main>旧主题</main>', html: '<main>新主题</main>', projected: themed, original: doc })
  expect(h.doc.mock.calls).toEqual([[themed], [doc]])
})
it('uses the new top-level position for a move and marks an unavailable renderer without a partial preview', () => {
  const plan = spec(doc, { op: 'move', id: a.id, to: 1 }, { op: 'setTheme', themeId: 'thu-eea-de' })
  const moved = { ...doc, blocks: [b, a] }
  h.resolve.mockReturnValueOnce(resolveFrom(plan, 0, moved)).mockReturnValueOnce(resolveFrom(plan, 1, { ...doc, themeId: 'thu-eea-de' }))
  h.block.mockReturnValue('<p>已移动</p>')
  h.doc.mockReturnValueOnce({ html: '<p>新预览</p>' }).mockImplementationOnce(unsupported)
  const out = reviewItems(plan, doc)
  expect(out[0]).toMatchObject({ position: 2, html: '<p>已移动</p>' })
  expect(out[1]).toMatchObject({ beforeHtml: undefined, html: '', error: '建议无法安全预览，请重新生成' })
})
it('uses isolated replay tokens/final times and leaves the real document playback untouched', () => {
  const replay = createBlock('replay')
  replay.props.playback = { ...replay.props.playback, trigger: 'tap', loop: { hold: 1 } }
  const html = createBlock('html', { html: '<section data-review-freeze="arbitrary-fixture"><p>原文</p></section>' })
  const box = createBlock('box', { children: [html, replay] })
  const base = makeDoc(box)
  const plan = spec(base, { op: 'update', id: box.id, props: { title: '合成变更' } })
  const snapshot = structuredClone(base)
  h.resolve.mockReturnValue(resolveFrom(plan, 0, base))
  h.times.mockReturnValue([2.5])
  h.replay.mockReturnValue({ html: '<svg></svg>' })
  h.block.mockReturnValue('<p>静态预览</p>')
  const out = reviewItems(plan, base)
  const rendered = h.block.mock.calls[0][0] as Block<'box'>
  const shown = h.replay.mock.calls[0][0] as Block<'replay'>
  const token = out[0].replayFrames[0].token
  expect(out[0].replayFrames).toEqual([{ token, times: [2.5] }])
  expect(shown.props.playback).toMatchObject({ trigger: 'auto', loop: undefined })
  expect((rendered.props.children[0] as Block<'html'>).props.html).toBe('<section><p>原文</p></section>')
  expect((rendered.props.children[1] as Block<'html'>).props.html).toBe(`<section data-review-freeze="${token}"><svg></svg></section>`)
  expect(base).toEqual(snapshot)
})
it.each([-1, 86401, NaN])('does not generate replay HTML for invalid final time %s', (invalid) => {
  const replay = createBlock('replay')
  const base = makeDoc(replay)
  const plan = spec(base, { op: 'update', id: replay.id, props: {} })
  h.resolve.mockReturnValue(resolveFrom(plan, 0, base))
  h.times.mockReturnValue([invalid])
  expect(reviewItems(plan, base)[0]).toMatchObject({ html: '', replayFrames: [], error: '建议无法安全预览，请重新生成' })
  expect(h.replay).not.toHaveBeenCalled()
  expect(h.block).not.toHaveBeenCalled()
})
