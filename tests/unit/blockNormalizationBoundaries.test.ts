import { expect, it } from 'vitest'
import { blockLabel, cloneBlock, coerceProps, createBlock, normalizeBlocks } from '../../src/core/blocks'

it('keeps valid image metadata, rejects invalid replacement and drops unknown fields', () => {
  const image = { src: '/media/a.jpg', assetId: 'asset-a', alt: '说明', width: '800', height: 600, displayWidth: 55, transient: 'discard' }
  expect(coerceProps('imageText', { image, imagePosition: 'right', unknown: true }, true)).toEqual({
    image: { src: '/media/a.jpg', assetId: 'asset-a', alt: '说明', width: 800, height: 600, displayWidth: 55 }, imagePosition: 'right',
  })
  expect(coerceProps('imageText', { image: { src: '' }, imagePosition: 'invalid' }, true)).toEqual({ imagePosition: 'left' })
})

it('normalizes a gallery without leaking invalid image entries or unrelated fields', () => {
  expect(coerceProps('gallery', { columns: -12, images: [null, { src: 5 }, { src: '/media/a.jpg', width: 0, height: -1, alt: 'A' }], caption: 42, notAField: 'drop' })).toEqual({
    columns: 1, images: [{ src: '/media/a.jpg', alt: 'A' }], caption: '42',
  })
})

it('retains HTML fragment attribution fields only while normalizing malformed optional fields', () => {
  expect(coerceProps('html', { source: { kind: 'legacy', title: 42, url: { invalid: true }, account: null, draft: true } }, true)).toEqual({
    source: { kind: 'other', title: '42', url: '', account: '' },
  })
  expect(coerceProps('html', { source: null }, true)).toEqual({})
})

it('normalizes table and timeline rows without sharing or mutating input', () => {
  const rows = [['一', 3, null], 'bad', [false, { label: 'object' }]]
  const before = structuredClone(rows)
  expect(coerceProps('table', { headers: ['列', 5], rows }, true)).toEqual({ headers: ['列', '5'], rows: [['一', '3', ''], ['false', '']] })
  expect(rows).toEqual(before)
  expect(coerceProps('timeline', { items: [null, { time: 9, title: '开场', desc: { nested: true }, extra: true }] }, true)).toEqual({
    items: [{ time: '9', title: '开场', desc: '' }],
  })
})

it('retains usable siblings and explicit IDs while dropping unknown and forbidden nested blocks', () => {
  expect(normalizeBlocks(null)).toEqual([])
  const blocks = normalizeBlocks([
    null, { id: 'unknown', type: 'not-a-block' },
    { id: 'outer', type: 'box', props: { children: [
      { id: 'inner', type: 'box', props: { children: [{ id: 'inside-inner', type: 'image', props: {} }] } },
      { id: 'replay', type: 'replay', props: {} },
      { id: 'keep', type: 'paragraph', props: { content: '正文', align: 'right' } },
      { id: '', type: 'image', props: { image: { src: '/media/article.jpg' } } },
    ] } },
  ])
  expect(blocks).toHaveLength(1)
  const outer = blocks[0]
  if (outer.type !== 'box') throw Error('box not recovered')
  expect(outer.id).toBe('outer')
  expect(outer.props.children).toMatchObject([
    { id: 'keep', type: 'paragraph', props: { content: { type: 'doc' }, align: 'right' } },
    { id: expect.any(String), type: 'image', props: { image: { src: '/media/article.jpg' } } },
  ])
  expect(outer.props.children[1].id).not.toBe('')
})

it('cloning a text box allocates independent child IDs and copies its image content', () => {
  const original = createBlock('box', { children: [createBlock('image', { image: { src: '/media/a.jpg' } })] })
  const clone = cloneBlock(original)
  expect(clone.id).not.toBe(original.id)
  expect(clone.props.children[0]).toMatchObject({ type: 'image', props: { image: { src: '/media/a.jpg' } } })
  expect(clone.props.children[0].id).not.toBe(original.props.children[0].id)
  expect(clone.props.children[0].props).not.toBe(original.props.children[0].props)
  expect(blockLabel(createBlock('html', { label: '原始模块' }))).toBe('原始模块')
})

it('caps carousel slots and normalizes their optional image and caption fields', () => {
  const pics = [{ image: { src: '/media/a.jpg', displayWidth: 44 }, caption: 42 }, { image: { src: '' } }, ...Array(35).fill({})]
  const result = coerceProps('carousel', { pics }, true).pics!
  expect(result).toHaveLength(30)
  expect(result.slice(0, 2)).toEqual([{ image: { src: '/media/a.jpg', displayWidth: 44 }, caption: '42' }, { caption: '' }])
})
