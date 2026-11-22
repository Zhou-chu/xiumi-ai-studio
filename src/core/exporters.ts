import { stripTagSpans } from './textLinear'
import { richToMarkdown } from './richtext'
import type { Block, Doc } from './types'

// Escape literal data before rendering trusted Markdown structure.
function markdownDataText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\\x60*_[\]{}()|~#+]/g, '\\$&')
    .replace(/\r\n|[\r\n]/g, '<br>')
}

function markdownDataTable({ headers, rows, caption }: Extract<Block, { type: 'table' }>['props']): string[] {
  // The native editor accepts uneven rows. Prevent GFM from dropping cells.
  const width = rows.reduce((size, row) => Math.max(size, row.length), headers.length)
  const formattedCaption = caption && `*${markdownDataText(caption)}*`
  if (!width) return formattedCaption ? [formattedCaption] : []
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`
  return [
    [row(headers.map(markdownDataText)), row(Array<string>(width).fill('---')), ...rows.map(cells => row(cells.map(markdownDataText)))].join('\n'),
    formattedCaption,
  ]
}

export function docToMarkdown(doc: Doc): string {
  const out: string[] = []
  const img = (src?: string, alt = '') => (src ? `![${alt}](${src})` : '')
  const pics = (list: { image?: { src: string }; caption: string }[], format: (text: string) => string = text => text) =>
    list.filter(x => x.image).flatMap(x => {
      const caption = format(x.caption)
      return [img(x.image!.src, caption), caption && `*${caption}*`]
    })
  const walk = (b: Block) => {
    const p: any = b.props
    switch (b.type) {
      case 'cover':
        out.push(`# ${markdownDataText(b.props.title)}`,
          b.props.subtitle && `> ${markdownDataText(b.props.subtitle)}`, markdownDataText(b.props.meta), img(b.props.image?.src))
        break
      case 'heading':
        out.push(`## ${p.index ? p.index + ' ' : ''}${p.title}`, p.subtitle)
        break
      case 'paragraph':
        out.push(richToMarkdown(p.content))
        break
      case 'card':
        out.push(p.title && `**${p.title}**`, richToMarkdown(p.content))
        break
      case 'quote':
        out.push(`> ${p.text}${p.source ? `\n>\n> —— ${p.source}` : ''}`)
        break
      case 'imageText':
        out.push(img(b.props.image?.src), b.props.title && `**${markdownDataText(b.props.title)}**`,
          richToMarkdown(b.props.content, markdownDataText))
        break
      case 'image':
        out.push(img(p.image?.src, p.caption), p.caption && `*${p.caption}*`)
        break
      case 'gallery':
        out.push(p.images.map((i: any) => img(i.src)).join('\n'), p.caption && `*${p.caption}*`)
        break
      case 'timeline':
        out.push(b.props.items.map(({ time, title, desc }) =>
          `- ${time ? `**${markdownDataText(time)}** ` : ''}${markdownDataText(title)}${desc ? `：${markdownDataText(desc)}` : ''}`).join('\n'))
        break
      case 'table':
        out.push(...markdownDataTable(b.props))
        break
      case 'profile':
        out.push(img(b.props.image?.src, markdownDataText(b.props.name)),
          `**${markdownDataText(b.props.name)}** · ${markdownDataText(b.props.role)}`, markdownDataText(b.props.bio))
        break
      case 'divider':
        out.push('---')
        break
      case 'html': {
        const imgs = [...String(p.html).matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)].map((m) => img(m[1].replace(/&amp;/g, '&')))
        const txt = stripTagSpans(String(p.html)
          .replace(/<\/(p|section|h\d|li|blockquote)>/gi, '\n')
          .replace(/<br\s*\/?>/gi, '\n'))
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/\n\s*\n+/g, '\n\n')
          .trim()
        out.push(txt, ...imgs)
        break
      }
      case 'ending':
        out.push('---', b.props.text && `**${markdownDataText(b.props.text)}**`,
          markdownDataText(b.props.note), markdownDataText(b.props.author))
        break
      case 'box':
        out.push(p.title && `### ${p.title}`)
        p.children.forEach(walk)
        break
      case 'carousel':
        out.push(...pics(b.props.pics))
        break
      case 'photos':
        out.push(...pics(b.props.pics.slice(0, b.props.count), markdownDataText))
        break
      case 'frame':
        out.push(img(p.image?.src, p.caption), p.caption && `*${p.caption}*`)
        break
    }
  }
  doc.blocks.forEach(walk)
  return out.filter(Boolean).join('\n\n') + '\n'
}
