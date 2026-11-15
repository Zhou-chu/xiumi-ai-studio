// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { resolveResizeTarget, resizePhoto } from '../../src/editor/imageResizeTarget'
import type { Block, Doc, ImageRef } from '../../src/core/types'

const a = { src: '/media/a.png?fit=4%3A3', assetId: 'a', width: 800, height: 600, alt: '保留' }
const b = { src: '/media/b.png' }
const asDoc = (...blocks: Block[]): Doc => ({ id: 'resize-fixture', title: '', author: '', digest: '', themeId: 'minimal-magazine', blocks, createdAt: 1, updatedAt: 1 })
function markup(block: Block, html: string) {
  const host = document.createElement('div')
  host.dataset.blockId = block.id
  host.innerHTML = `<div class="block-html">${html}</div>`
  return { host, images: [...host.querySelectorAll<HTMLImageElement>('img')] }
}
function img(src: string, index: number) {
  const node = document.createElement('img')
  node.setAttribute('src', src)
  node.dataset.photo = String(index)
  return node.outerHTML
}
const toDom = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const gallery = () => createBlock('gallery', { images: [a, b] })

it('resolves by verified local file and index while retaining full original media ref', () => {
  const block = gallery()
  const doc = asDoc(block)
  const { images } = markup(block, img('/media/a.png?fit=1:1&w=240', 0) + img('/media/b.png?w=240', 1))
  expect(resolveResizeTarget(images[0], doc)).toEqual({ img: images[0], pos: { blockId: block.id, index: 0 }, block, docId: 'resize-fixture' })
  expect(resolveResizeTarget(images[1], doc)?.pos.index).toBe(1)
  expect(block.props).toMatchObject({ images: [a, b] })
})
it('rejects a target whose indexed sibling does not match, even when its own source is correct', () => {
  const block = gallery()
  const { images } = markup(block, img(a.src, 0) + img('/media/shifted.png', 1))
  expect(resolveResizeTarget(images[0], asDoc(block))).toBeNull()
})
it.each(['', '-1', '0.0', 'a', '1', '100'])('rejects a nonmatching DOM index %j', (index) => {
  const block = gallery()
  const { images } = markup(block, img(a.src, 0) + img(b.src, 1))
  images[0].dataset.photo = index
  expect(resolveResizeTarget(images[0], asDoc(block))).toBeNull()
})
it('rejects unowned DOM, different nearest owners, missing data blocks and box/replay targets', () => {
  const block = gallery()
  const doc = asDoc(block)
  const { host, images } = markup(block, img(a.src, 0) + img(b.src, 1))
  expect(resolveResizeTarget(document.createElement('img'), doc)).toBeNull()
  expect(resolveResizeTarget(images[0], asDoc())).toBeNull()
  const wrapper = document.createElement('div')
  wrapper.dataset.blockId = block.id
  images[0].replaceWith(wrapper)
  wrapper.append(images[0])
  expect(resolveResizeTarget(images[0], doc)).toBeNull()
  expect(resolveResizeTarget(host.querySelector('img')!, doc)).toBeNull()
  for (const unsupported of [createBlock('box'), createBlock('replay')]) {
    const fixture = markup(unsupported, img(a.src, 0))
    expect(resolveResizeTarget(fixture.images[0], asDoc(unsupported))).toBeNull()
  }
})
it('indexes duplicate original HTML sources, but never inline SVG foreignObject images', () => {
  const block = createBlock('html', { html: '<svg><foreignObject><img src="/media/a.png"></foreignObject></svg><img src="/media/a.png"><img src="/media/a.png">' })
  const { images } = markup(block, block.props.html)
  const doc = asDoc(block)
  expect(resolveResizeTarget(images[0], doc)).toBeNull()
  expect(resolveResizeTarget(images[1], doc)?.pos.index).toBe(1)
  expect(resolveResizeTarget(images[2], doc)?.pos.index).toBe(2)
  images[1].remove()
  expect(resolveResizeTarget(images[2], doc)).toBeNull()
})
it('does not normalize away non-local query differences', () => {
  const block = createBlock('image', { image: { src: 'https://fixture.invalid/image.jpg?frame=1' } })
  const { images } = markup(block, img('https://fixture.invalid/image.jpg?frame=2', 0))
  expect(resolveResizeTarget(images[0], asDoc(block))).toBeNull()
})
it('only changes the targeted gallery image width and returns the same document for no-op and invalid coordinates', () => {
  const block = gallery()
  const untouched = createBlock('heading')
  const box = createBlock('box', { children: [block] })
  const doc = asDoc(box, untouched)
  const pos = { blockId: block.id, index: 0 }
  const next = resizePhoto(doc, pos, 1.2)
  expect(next.blocks[1]).toBe(untouched)
  expect((next.blocks[0] as Block<'box'>).props.children[0].props).toMatchObject({ images: [{ ...a, displayWidth: 10 }, b] })
  expect(block.props).toMatchObject({ images: [a, b] })
  expect(resizePhoto(next, pos, 10)).toBe(next)
  for (const [width, index] of [[NaN, 0], [Infinity, 0], [50, -1], [50, 0.5], [50, 999]]) {
    expect(resizePhoto(doc, { ...pos, index }, width)).toBe(doc)
  }
  expect(resizePhoto(doc, { ...pos, blockId: 'missing' }, 50)).toBe(doc)
})
it.each(['image', 'imageText', 'profile', 'cover', 'frame'] as const)('resizes an existing single %s image without changing pixels', (type) => {
  const block = createBlock(type, { image: a })
  const doc = asDoc(block)
  const next = resizePhoto(doc, { blockId: block.id, index: 0 }, 124)
  expect((next.blocks[0].props as { image?: ImageRef }).image).toEqual({ ...a, displayWidth: 100 })
  expect((block.props as { image?: ImageRef }).image).toEqual(a)
})
it.each(['photos', 'carousel'] as const)('preserves captions/empty slots and rounds a real %s image width', (type) => {
  const block = createBlock(type, { count: 2, pics: [{ caption: 'empty' }, { image: a, caption: 'keep' }] })
  const doc = asDoc(block)
  expect(resizePhoto(doc, { blockId: block.id, index: 0 }, 50)).toBe(doc)
  const next = resizePhoto(doc, { blockId: block.id, index: 1 }, 44.86)
  expect((next.blocks[0].props as Block<typeof type>['props']).pics).toEqual([{ caption: 'empty' }, { image: { ...a, displayWidth: 44.9 }, caption: 'keep' }])
})
it('rewrites only HTML size of the target, preserving its crop URL, visual style and sibling content', () => {
  const html = '<p><img src="/media/a.png?fit=4%3A3" width="800" height="600" style="border-radius:9px"><a href="https://fixture.invalid">link</a><img src="/media/b.png" width="64"></p>'
  const block = createBlock('html', { html })
  const doc = asDoc(block)
  const pos = { blockId: block.id, index: 0 }
  const next = resizePhoto(doc, pos, 60)
  const parsed = toDom((next.blocks[0] as Block<'html'>).props.html)
  const [first, sibling] = [...parsed.images]
  expect(first.getAttribute('src')).toBe('/media/a.png?fit=4%3A3')
  expect(first.getAttribute('width')).toBeNull()
  expect(first.getAttribute('height')).toBeNull()
  expect([first.style.width, first.style.height, first.style.maxWidth, first.style.borderRadius]).toEqual(['60%', 'auto', '100%', '9px'])
  expect(sibling.getAttribute('width')).toBe('64')
  expect(parsed.querySelector('a')?.getAttribute('href')).toBe('https://fixture.invalid')
  expect(resizePhoto(next, pos, 60)).toBe(next)
  expect(block.props.html).toBe(html)
})
it('does not address artwork nested in SVG or the unsupported ending image', () => {
  const artwork = createBlock('html', { html: '<svg><foreignObject><img src="/media/a.png"></foreignObject></svg>' })
  const ending = createBlock('ending', { image: a })
  const doc = asDoc(artwork, ending)
  for (const block of [artwork, ending]) expect(resizePhoto(doc, { blockId: block.id, index: 0 }, 30)).toBe(doc)
})
