import { expect, it } from 'vitest'
import { assemble, type Kit } from '../../src/core/assemble'
import { createBlock } from '../../src/core/blocks'
import type { Copy } from '../../src/core/copy'
it('a missing planned index is not a placed photo and cannot hide an unallocated-image warning', () => {
  const fixture: Copy = { title: 'Title', subtitle: '', items: [], credits: [] }
  const kit: Kit = { img1: { role: 'img1', from: 'fixture', block: createBlock('image') } }
  const images = [{ src: '/media/first.jpg' }, { src: '/media/second.jpg' }]
  const result = assemble(fixture, kit, images, [{ after: 'missing', photos: [4, 0] }])
  expect(result.doc.blocks.map(b => b.props)).toEqual([{ variant: 'full', caption: '', image: images[0] }])
  expect(result.warnings).toContain('有 1 张照片没有安排位置')
})

const copyFixture: Copy = { title: 'Title', subtitle: '', items: [], credits: [] }
const available = [{ src: '/media/a.jpg' }, { src: '/media/b.jpg' }, { src: '/media/c.jpg' }]
const coverKit: Kit = { cover: { role: 'cover', from: 'fixture', block: createBlock('cover') } }

it.each([-1, 1.5, Number.NaN, 99])('does not count non-photo index %s or double-count a valid duplicate', invalid => {
  const result = assemble(copyFixture, coverKit, available, [
    { after: 'cover', photos: [0] },
    { after: 'after-article', photos: [0, invalid] },
  ])
  expect(result.warnings.filter(w => w.includes('照片没有安排位置'))).toEqual(['有 2 张照片没有安排位置'])
})

it('keeps valid cover and article placements counted exactly once', () => {
  const result = assemble(copyFixture, coverKit, available, [
    { after: 'cover', photos: [0] },
    { after: 'after-article', photos: [0, 1, 2] },
  ])
  expect(result.doc.cover).toEqual(available[0])
  expect(result.warnings.filter(w => w.includes('照片没有安排位置'))).toEqual([])
})
