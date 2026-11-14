import { stripTagSpans } from './textLinear'
import { richToPlain } from './richtext'
import { findBlock, flatBlocks } from './tree'
import type { Block, Doc, DocOp } from './types'

/** Human-readable operation projections; never mutate or validate document data. */
export function describeOp(doc: Doc, op: DocOp): { title: string; before?: string; after?: string } {
  const label = (b?: Block) => (b ? `${b.type}「${summarize(b).slice(0, 18)}」` : '')
  switch (op.op) {
    case 'insert':
      return { title: `在第 ${op.index + 1} 位插入 ${op.block.type}`, after: summarize(op.block) }
    case 'update': {
      const b = findBlock(doc.blocks, op.id)?.block
      const after = b ? summarize({ ...b, props: { ...b.props, ...op.props } } as Block) : ''
      return { title: `修改 ${label(b)}`, before: b ? summarize(b) : '', after }
    }
    case 'remove': {
      const b = findBlock(doc.blocks, op.id)?.block
      return { title: `删除 ${label(b)}`, before: b ? summarize(b) : '' }
    }
    case 'move': {
      const b = doc.blocks.find((x) => x.id === op.id)
      return { title: `移动 ${label(b)} 到第 ${op.to + 1} 位` }
    }
    case 'setTheme':
      return { title: `切换主题为 ${op.themeId}` }
    case 'setMeta':
      return { title: '修改文章信息', after: [op.title, op.digest, op.author].filter(Boolean).join(' / ') }
  }
}

export function summarize(b: Block): string {
  const p: any = b.props
  switch (b.type) {
    case 'paragraph':
      return richToPlain(p.content)
    case 'card':
    case 'imageText':
      return [p.title, richToPlain(p.content)].filter(Boolean).join('：')
    case 'gallery':
      return `${p.images.length} 张图，${p.columns} 列 ${p.caption ?? ''}`
    case 'timeline':
      return p.items.map((i: any) => `${i.time} ${i.title}`).join('；')
    case 'table':
      return [p.headers.join(' | '), ...p.rows.map((r: string[]) => r.join(' | '))].join('\n')
    case 'image':
      return `图片 ${p.caption ?? ''}`
    case 'divider':
      return `分割 ${p.variant}`
    case 'box':
      return [p.title, ...flatBlocks(p.children).map(summarize)].filter(Boolean).join('；')
    case 'carousel':
      return `轮播 ${p.pics.filter((x: any) => x.image).length} 张图 ${p.pics.map((x: any) => x.caption).filter(Boolean).join(' / ')}`
    case 'photos':
      return `${p.count} 张图 ${p.pics.map((x: any) => x.caption).filter(Boolean).join(' / ')}`
    case 'frame':
      return `图片框 ${[p.caption, p.label].filter(Boolean).join(' · ')}`
    case 'html':
      return `${p.label}：${stripTagSpans(String(p.html), ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`
    default:
      return ['kicker', 'index', 'title', 'subtitle', 'text', 'source', 'name', 'role', 'bio', 'author', 'note', 'meta']
        .map((k) => p[k])
        .filter(Boolean)
        .join(' · ')
  }
}
