// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { richToPlain, textToRich } from '../../src/core/richtext'
import { slotRawTexts } from '../../src/core/slots'
import type { Block, Doc, DocOp } from '../../src/core/types'
import { prepareProposalItem, previewProposal, resolveProposalItems } from '../../src/editor/proposalSafety'
import type { Proposal } from '../../src/editor/store'

const para = (id: string, text: string) => ({ ...createBlock('paragraph', { content: textToRich(text) }), id })
const doc = (blocks: Block[] = [para('a', '甲'), para('b', '乙'), para('c', '丙')]): Doc => ({
  id: 'd', title: '标题', author: '作者', digest: '导读', themeId: 'thu-eea-de', blocks, createdAt: 0, updatedAt: 0,
})
const offer = (base: Doc, ...ops: DocOp[]): Proposal => ({
  base, summary: '建议', errors: [], selectionPolicy: 'filter', ignoredOps: 3,
  items: ops.map(op => ({ op, status: 'pending' })),
})
const update = (id: string, props: Record<string, unknown>): DocOp => ({ op: 'update', id, props })
const stale = '对应内容已变化，请重新生成修改建议'
const identity = '对应模块已删除、更换或标识重复'
const orderError = '文稿顺序已变化，请重新生成建议'
const ids = (d: Doc) => d.blocks.map(b => b.id)
const content = (d: Doc) => d.blocks.map(b => b.type === 'paragraph' ? richToPlain(b.props.content) : b.type)

it('does not prepare consumed, missing or different-document proposals', () => {
  const base = doc()
  const p = offer(base, update('a', { content: 'AI' }), update('b', { content: 'AI' }), update('c', { content: 'AI' }))
  p.items[1].status = 'accepted'
  p.items[2].status = 'rejected'
  for (const index of [-1, 0.5, 1, 2, 3]) expect(prepareProposalItem(p, base, index)).toEqual({ error: '此建议已处理或不存在' })
  expect(prepareProposalItem(p, { ...base, id: 'other' }, 0)).toEqual({ error: '当前文稿已切换' })
})

it('requires an unambiguous identity across descendants in both snapshots', () => {
  const child = para('target', '旧')
  const box = createBlock('box', { children: [child] })
  const base = doc([box])
  const op = update('target', { content: '建议' })
  const p = offer(base, op)
  expect(prepareProposalItem(p, base, 0).op).toMatchObject({ id: 'target', props: { content: textToRich('建议') } })
  expect(prepareProposalItem(p, { ...base, blocks: [] }, 0)).toEqual({ error: identity })
  expect(prepareProposalItem(p, { ...base, blocks: [box, child] }, 0)).toEqual({ error: identity })
  expect(prepareProposalItem(offer({ ...base, blocks: [box, child] }, op), base, 0)).toEqual({ error: identity })
  expect(prepareProposalItem(p, { ...base, blocks: [{ ...createBlock('divider'), id: child.id }] }, 0)).toEqual({ error: identity })
})

it('rebases nested object edits but rejects competing leaves and rich-text arrays atomically', () => {
  const image = { src: '/media/original.jpg', width: 400, height: 300, alt: 'old' }
  const block = createBlock('imageText', { image, content: textToRich('before') })
  const base = doc([block])
  const current = { ...base, blocks: [{ ...block, props: { ...block.props, image: { ...image, width: 640 } } }] }
  const p = offer(base, update(block.id, { image: { src: image.src, width: image.width, height: image.height, displayWidth: 70 } }))
  expect(prepareProposalItem(p, current, 0).op).toMatchObject({ props: { image: { src: image.src, width: 640, height: 300, displayWidth: 70 } } })
  expect((prepareProposalItem(p, current, 0).op as Extract<DocOp, { op: 'update' }>).props.image).not.toHaveProperty('alt')
  const conflict = { ...base, blocks: [{ ...block, props: { ...block.props, image: { ...image, alt: 'manual' } } }] }
  expect(prepareProposalItem(p, conflict, 0)).toEqual({ error: stale })
  const textConflict = { ...base, blocks: [{ ...block, props: { ...block.props, content: textToRich('before\nmanual') } }] }
  expect(prepareProposalItem(offer(base, update(block.id, { content: textToRich('AI\nbefore') })), textConflict, 0)).toEqual({ error: stale })
})

it('allows a no-op proposed field to retain an actual newer value and preserves unrelated document edits', () => {
  const block = para('a', '原文')
  block.props.align = 'left'
  const base = doc([block])
  const current = { ...base, title: '文档改名', blocks: [{ ...block, props: { ...block.props, content: textToRich('手写'), align: 'left' as const } }] }
  const result = resolveProposalItems(offer(base, update('a', { content: block.props.content, align: 'center' })), current, 0, 'accepted')
  expect(result.doc.title).toBe('文档改名')
  expect(content(result.doc)).toEqual(['手写'])
  expect(result.doc.blocks[0].props).toMatchObject({ align: 'center' })
})

it.each([{ op: 'remove', id: 'a' }, { op: 'move', id: 'a', to: 1 }] as const)('will not $op a block whose payload changed', op => {
  const base = doc()
  const p = offer(base, op)
  expect(prepareProposalItem(p, base, 0).op).toEqual(op)
  expect(prepareProposalItem(p, { ...base, blocks: [para('a', '手写'), ...base.blocks.slice(1)] }, 0)).toEqual({ error: stale })
})

it('checks only metadata fields touched by the proposal, including intentional empty values', () => {
  const base = doc()
  const title = offer(base, { op: 'setMeta', title: '' })
  expect(prepareProposalItem(title, { ...base, digest: '手写导读' }, 0).op).toEqual({ op: 'setMeta', title: '' })
  expect(prepareProposalItem(title, { ...base, title: '手写标题' }, 0)).toEqual({ error: stale })
  expect(prepareProposalItem(offer(base, { op: 'setMeta', author: 'AI作者' }), { ...base, author: '手写作者' }, 0)).toEqual({ error: stale })
  expect(prepareProposalItem(offer(base, { op: 'setMeta', digest: 'AI导读' }), { ...base, digest: '手写导读' }, 0)).toEqual({ error: stale })
})

it('guards theme identity and draft overrides while allowing unrelated content changes', () => {
  const base = { ...doc(), themeOverrides: { fontSize: 16 } }
  const op = { op: 'setTheme', themeId: 'minimal-magazine' } as const
  const p = offer(base, op)
  expect(prepareProposalItem(p, { ...base, title: '手写' }, 0).op).toEqual(op)
  expect(prepareProposalItem(p, { ...base, themeId: 'other' }, 0)).toEqual({ error: stale })
  expect(prepareProposalItem(p, { ...base, themeOverrides: { fontSize: 14 } }, 0)).toEqual({ error: stale })
})

const htmlBase = '<section><h2>标题</h2><p style="color:red">正文</p><img src="/media/p.jpg"></section>'
const htmlDoc = (html = htmlBase) => doc([{ ...createBlock('html', { html }), id: 'fragment' }])
const slots = (html: string) => {
  const pair = Object.entries(slotRawTexts(html)).find(([, text]) => text === '标题')
  if (!pair) throw Error('Expected a heading slot in the fixture')
  return { [pair[0]]: '建议标题' }
}

it('revalidates slot edits against current source and retains unrelated manual text and media', () => {
  const base = htmlDoc()
  const current = htmlDoc(htmlBase.replace('正文', '手写正文').replace('p.jpg', 'manual.jpg'))
  const op = { ...update('fragment', {}), slots: slots(htmlBase) } as DocOp
  const result = resolveProposalItems(offer(base, op), current, 'all', 'accepted')
  const b = result.doc.blocks[0]
  expect(b.type).toBe('html')
  expect(b.props).toMatchObject({ html: expect.stringContaining('建议标题') })
  expect(b.props).toMatchObject({ html: expect.stringContaining('手写正文') })
  expect(b.props).toMatchObject({ html: expect.stringContaining('/media/manual.jpg') })
  expect(result.proposal.items[0].status).toBe('accepted')
})

it('treats edited target slots, missing slots, and styling or topology changes as stale', () => {
  const base = htmlDoc()
  const op = { ...update('fragment', {}), slots: slots(htmlBase) } as DocOp
  const p = offer(base, op)
  for (const changedHtml of [htmlBase.replace('标题', '手写标题'), htmlBase.replace('red','blue'), htmlBase.replace('<h2>标题</h2>', '<p>标题</p>')]) {
    expect(prepareProposalItem(p, htmlDoc(changedHtml), 0)).toEqual({ error: stale })
  }
  expect(prepareProposalItem(offer(base, { ...op, slots: { missing: '不存在' } } as DocOp), base, 0)).toEqual({ error: stale })
})

it('blocks whole-fragment theme and layout operations when even untouched text has been manually changed', () => {
  const base = htmlDoc()
  const current = htmlDoc(htmlBase.replace('正文', '手写正文'))
  const theme = { ...update('fragment', {}), themeId: 'thu-eea-de' } as DocOp
  expect(prepareProposalItem(offer(base, theme), current, 0)).toEqual({ error: stale })
  const layout = { ...theme, layout: 'chapters' } as DocOp
  expect(prepareProposalItem(offer(base, layout), current, 0)).toEqual({ error: stale })
  expect(prepareProposalItem(offer(base, theme), base, 0).op).toMatchObject({ id: 'fragment', themeId: 'thu-eea-de' })
})

it('validates a pending anchored insert at its actual moved anchor but rejects ambiguous or removed anchors', () => {
  const base = doc()
  const op = { op: 'insert', index: 2, block: para('fixture-id', '新增'), anchor: { id: 'b', side: 'after' } } as const
  const p = offer(base, op)
  const moved = { ...base, blocks: [base.blocks[1], base.blocks[0], base.blocks[2]] }
  const result = resolveProposalItems(p, moved, 0, 'accepted')
  expect(content(result.doc)).toEqual(['乙','新增','甲','丙'])
  expect(prepareProposalItem(p, { ...base, blocks: [base.blocks[0]] }, 0).error).toContain('锚点')
  expect(prepareProposalItem(p, { ...base, blocks: [...base.blocks, base.blocks[1]] }, 0).error).toContain('锚点')
  expect(ids(result.doc)).not.toContain('fixture-id')
})

it('leaves unrelated edits intact through two inverse-order anchored acceptances', () => {
  const base = doc()
  const anchor = { id: 'b', side: 'before' } as const
  const p = offer(base,
    { op: 'insert', index: 1, block: para('fake-a', '新一'), anchor },
    { op: 'insert', index: 1, block: para('fake-b', '新二'), anchor },
  )
  const first = resolveProposalItems(p, base, 1, 'accepted')
  const second = resolveProposalItems(first.proposal, { ...first.doc, digest: '保留导读' }, 0, 'accepted')
  expect(content(second.doc)).toEqual(['甲','新一','新二','乙','丙'])
  expect(second.doc.digest).toBe('保留导读')
  expect(second.proposal.appliedStructure?.[1]).toMatchObject({ anchor: { id: first.doc.blocks[1].id, side: 'before' } })
  expect(second.proposal.items[0].op).toMatchObject({ anchor, block: { id: second.doc.blocks[1].id } })
})

it('replays accepted structure in acceptance order but does not absorb an external reorder', () => {
  const base = doc()
  const p = offer(base,
    { op: 'move', id: 'a', to: 2 }, { op: 'remove', id: 'b' },
    { op: 'insert', index: 1, block: para('fixture-id', '新增') },
  )
  const first = resolveProposalItems(p, base, 1, 'accepted')
  const second = resolveProposalItems(first.proposal, first.doc, 0, 'accepted')
  expect(ids(second.doc)).toEqual(['c','a'])
  expect(second.proposal.appliedStructure?.map(x => x.op)).toEqual(['remove','move'])
  expect(prepareProposalItem(second.proposal, { ...second.doc, blocks: [...second.doc.blocks].reverse() }, 2)).toEqual({ error: orderError })
  expect(content(previewProposal(second.proposal, second.doc))).toEqual(['丙','新增','甲'])
})

it('rejects stale items individually without mutating source snapshots or disturbing already rejected items', () => {
  const base = doc()
  const p = offer(base, update('a', { content: '过期' }), update('b', { content: '应保留' }), update('c', { content: '仍拒绝' }))
  p.items[2].status = 'rejected'
  p.errors = ['原始失败']
  const current = { ...base, blocks: [para('a','手写'), ...base.blocks.slice(1)] }
  const snapshot = JSON.stringify(p)
  const preview = previewProposal(p, current)
  const accepted = resolveProposalItems(p, current, 'all', 'accepted')
  expect(content(preview)).toEqual(['手写','应保留','丙'])
  expect(accepted.doc).toEqual(preview)
  expect(accepted.proposal.items.map(x => x.status)).toEqual(['rejected','accepted','rejected'])
  expect(accepted.proposal.errors).toEqual(['原始失败',stale])
  expect(accepted.proposal.ignoredOps).toBe(3)
  expect(JSON.stringify(p)).toBe(snapshot)
  expect(content(current)).toEqual(['手写','乙','丙'])
})

it('reject-all and reaccepting rejected or missing indices are content-free no-ops', () => {
  const base = doc()
  const p = offer(base, update('a', { content: '不应应用' }), { op: 'remove', id: 'c' })
  const denied = resolveProposalItems(p, base, 'all', 'rejected')
  const repeated = resolveProposalItems(denied.proposal, denied.doc, 0, 'accepted')
  const missing = resolveProposalItems(p, base, 9, 'accepted')
  expect(denied.doc).toBe(base)
  expect(repeated.doc).toBe(base)
  expect(missing.doc).toBe(base)
  expect(repeated.proposal.items.map(x => x.status)).toEqual(['rejected','rejected'])
  expect(missing.proposal.items.map(x => x.status)).toEqual(['pending','pending'])
  expect(denied.proposal.errors).toEqual([])
  expect(denied.proposal.appliedStructure).toEqual([])
})
