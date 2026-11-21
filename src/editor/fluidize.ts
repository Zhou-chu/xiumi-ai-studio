// Clipboard-derived pixel widths can pin an otherwise fluid article to the
// source page. Work on the already-sanitized detached DOM, without mounting
// or measuring it (which could fetch article images a second time).
import { splitDecls } from '../core/sanitize'

const WIDTH = /^\s*width\s*:\s*(\d{1,4}(?:\.\d{1,8})?)px\s*$/i
const COLUMN_MIN = 320
const COLUMN_MAX = 1200
const MAX_WRAPPERS = 12
const MAX_CHILDREN = 300

function pixelWidth(decls: string[]): number | undefined {
  const widths = decls.filter(decl => /^\s*width\s*:/i.test(decl))
  const match = widths.length === 1 && WIDTH.exec(widths[0])
  return match ? Number(match[1]) : undefined
}

function replaceWidth(el: Element, decls: string[], percentage: number) {
  el.setAttribute('style', decls.map(decl => WIDTH.test(decl) ? `width: ${percentage}%` : decl.trim()).join('; '))
}

/** One unambiguous bounded HTML column and direct proportional section children. */
export function fluidizeArticle(root: Element): void {
  let parent = root
  for (let depth = 0; depth < MAX_WRAPPERS; depth++) {
    if (parent.children.length !== 1 || Array.from(parent.childNodes).some(node => node.nodeType === 3 && node.textContent?.trim())) return
    const column = parent.firstElementChild
    if (!column || column.localName !== 'section' || column.namespaceURI !== 'http://www.w3.org/1999/xhtml') return
    const decls = splitDecls(column.getAttribute('style') ?? '')
    const width = pixelWidth(decls)
    if (width === undefined) {
      parent = column
      continue
    }
    if (width < COLUMN_MIN || width > COLUMN_MAX || column.children.length > MAX_CHILDREN ||
        decls.some(decl => /^\s*(?:min-width|max-width|padding(?:-[\w-]+)?|border(?:-[\w-]+)?|grid-template-columns|position)\s*:/i.test(decl))) return
    const children: Array<{ el: Element; styles: string[]; percent: number }> = []
    for (const child of column.children) {
      if (child.localName !== 'section' || child.namespaceURI !== column.namespaceURI) continue
      const styles = splitDecls(child.getAttribute('style') ?? '')
      const pixels = pixelWidth(styles)
      if (pixels === undefined || pixels < 100 || pixels > width) continue
      const percent = pixels * 100 / width
      const fractionalPixels = Math.abs(pixels - Math.round(pixels)) > 0.02
      if (fractionalPixels || Math.abs(percent - Math.round(percent)) < 0.005) {
        children.push({ el: child, styles, percent: Number(percent.toFixed(4)) })
      }
    }
    if (children.length === 0) return
    replaceWidth(column, decls, 100)
    for (const child of children) replaceWidth(child.el, child.styles, child.percent)
    return
  }
}
