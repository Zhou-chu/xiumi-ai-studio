import { blockPhotos, type PhotoPos } from './photos'
import { findBlock, updateBlock } from './tree'
import type { Block, Doc } from './types'
import type { Parse } from './slots'
export const clampImageWidth = (width: number) => Math.max(10, Math.min(100, Math.round(width * 10) / 10))
/** Relative width in the existing layout cell. Source dimensions remain immutable. */
export function resizePhoto(doc: Doc, pos: PhotoPos, width: number, parse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')): Doc {
  if (!Number.isFinite(width)) return doc
  const block = findBlock(doc.blocks, pos.blockId)?.block
  if (!block || !blockPhotos(block, parse)[pos.index]) return doc
  const percent = clampImageWidth(width)
  let next: Block
  if (block.type === 'html') {
    const parsed = parse(block.props.html)
    const img = parsed.querySelectorAll('img')[pos.index]
    if (!img) return doc
    img.style.width = `${percent}%`
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    img.removeAttribute('height')
    img.removeAttribute('width')
    next = { ...block, props: { ...block.props, html: parsed.body.innerHTML } }
  } else {
    const photo = blockPhotos(block, parse)[pos.index]!
    const updated = { ...photo, displayWidth: percent }
    if (block.type === 'gallery') next = { ...block, props: { ...block.props, images: block.props.images.map((p, i) => i === pos.index ? updated : p) } }
    else if (block.type === 'photos' || block.type === 'carousel') next = { ...block, props: { ...block.props, pics: block.props.pics.map((p, i) => i === pos.index ? { ...p, image: updated } : p) } } as Block
    else next = { ...block, props: { ...block.props, image: updated } } as Block
  }
  return { ...doc, blocks: updateBlock(doc.blocks, pos.blockId, () => next) }
}
/** Apply only validated sizes to generated images. No editor controls enter output. */
export function applyImageWidths(html: string, block: Block): string {
  if (block.type === 'html' || block.type === 'box') return html
  const photos = blockPhotos(block)
  let index = 0
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const width = photos[index++]?.displayWidth
    if (typeof width !== 'number' || !Number.isFinite(width)) return tag
    const size = `width:${clampImageWidth(width)}%;max-width:100%;height:auto;`
    return tag.replace(/\s(?:width|height)="[^"]*"/gi, '').replace(/style="([^"]*)"/i, (_m, s: string) => `style="${s.replace(/(?:^|;)\s*(?:width|max-width|height)\s*:[^;]*/gi, '')};${size}"`)
  })
}
