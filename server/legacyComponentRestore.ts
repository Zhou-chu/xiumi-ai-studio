import DOMPurify from 'isomorphic-dompurify'
import { COMPONENT_SCHEMA, makeDraft, validateDraft, type LibraryComponent } from '../src/core/components'
import { isRoleId } from '../src/core/roles'
import { splitDecls } from '../src/core/sanitize'
import type { Block } from '../src/core/types'
import type { collection } from './store'

export const COMPONENT_ENTRY = /^components\/([\w-]{1,64})\.json$/
const MEDIA = /^\/media\/([\w-]{1,64}\.(?:png|jpg))(?:\?gen=[a-f0-9]{64})?$/
const supportedStyles = new Set(['background-color', 'border', 'border-color', 'border-radius', 'color', 'display', 'font-size',
  'font-weight', 'height', 'letter-spacing', 'line-height', 'margin', 'max-width', 'padding', 'text-align', 'width'])
const allowedTags = ['body', 'section', 'p', 'span', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'img', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'figure', 'figcaption']
const allowedAttrs = ['src', 'alt', 'style', 'href']
export type ComponentCollection = Pick<ReturnType<typeof collection<LibraryComponent>>, 'restoreStatus' | 'withRestoreEntry'>
type Image = { id: string; src: string }
type ImageLookup = Pick<ReadonlyMap<string, Image>, 'get'>
type AdvisorySource = { kind: 'original' | 'wechat' | 'xiumi' | 'other'; title: string; account: string; url: string }
export type ComponentCandidate = { id: string; component: LibraryComponent; dependencies: Set<string>; missing: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const shortText = (v: unknown, n: number) => typeof v === 'string' ? v.slice(0, n) : ''
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

function validStyle(style: string) {
  if (!/^[\w #.,%:;+-]{1,1000}$/.test(style)) return false
  return splitDecls(style).every(decl => {
    const [key, value, ...extra] = decl.split(':')
    return !extra.length && supportedStyles.has(key.trim().toLowerCase()) && !!value?.trim() &&
      !/^(?:none|contents)$/i.test(value.trim())
  })
}

function advisorySource(value: unknown): AdvisorySource {
  const source = object(value) ? value : {}
  const kind = source.kind === 'original' || source.kind === 'wechat' || source.kind === 'xiumi' ? source.kind : 'other'
  return { kind, title: shortText(source.title, 120), account: shortText(source.account, 60), url: '' }
}

function isOrdinaryLink(href: string | null): boolean {
  if (href === null || href.length > 2048 || !/^https?:\/\/[^/]/i.test(href) || /[\p{Cc}\s\\]/u.test(href)) return false
  const url = URL.parse(href)
  return !!url?.hostname && !url.username && !url.password
}

function prepareHtml(html: string, images: ImageLookup) {
  const sanitized = DOMPurify.sanitize(html, { RETURN_DOM: true, ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: allowedAttrs, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false })
  if (sanitized.nodeType !== 1) return null
  const element = sanitized as HTMLElement
  if (DOMPurify.removed.length || element.attributes.length || !element.innerHTML.trim()) return null
  // Links are navigation only; keep other HTML and managed image checks intact.
  for (const node of element.querySelectorAll('a, [href]')) {
    if (node.localName !== 'a' || !isOrdinaryLink(node.getAttribute('href'))) return null
  }
  const dependencies = new Set<string>()
  let missing = false
  for (const node of element.querySelectorAll('[style], [src], img')) {
    const style = node.getAttribute('style')
    if (style !== null && !validStyle(style)) return null
    const src = node.getAttribute('src')
    if (node.tagName.toLowerCase() !== 'img') {
      if (src !== null) return null
      continue
    }
    const mediaFile = src && MEDIA.exec(src)?.[1]
    if (!mediaFile) return null
    const image = images.get(mediaFile)
    if (image) {
      if (src?.includes('?') && src !== image.src) return null
      dependencies.add(image.id)
      node.setAttribute('src', image.src)
    } else missing = true
  }
  return { element, dependencies, missing }
}

/** Narrow archive subset: restricted HTML, ordinary links and known managed images only. Trust is never imported. */
export function qualifyLegacyComponent(id: string, raw: unknown, images: ImageLookup): ComponentCandidate | null {
  if (!object(raw) || raw.id !== id || raw.schema !== COMPONENT_SCHEMA || !timestamp(raw.rev) || raw.rev < 1 ||
      !timestamp(raw.createdAt) || !timestamp(raw.updatedAt) || !object(raw.block) || raw.block.type !== 'html' ||
      typeof raw.block.id !== 'string' || !/^[\w-]{1,64}$/.test(raw.block.id) || !object(raw.block.props) ||
      Object.keys(raw.block.props).some(key => key !== 'html' && key !== 'label')) return null
  const html = raw.block.props.html
  if (typeof html !== 'string' || html.length > 64 * 1024 || (html.match(/</g)?.length ?? 0) > 500) return null
  const prepared = prepareHtml(html, images)
  if (!prepared) return null
  const { element, dependencies, missing } = prepared
  const block: Block = { id: raw.block.id, type: 'html', props: { html: element.innerHTML, label: shortText(raw.block.props.label, 160) } }
  const via = object(raw.origin) ? raw.origin.via : undefined
  const parsed = (markup: string) => {
    const doc = element.ownerDocument.implementation.createHTMLDocument('')
    doc.body.innerHTML = markup
    return doc
  }
  const draft = makeDraft({
    name: shortText(raw.name, 40), block, source: advisorySource(raw.origin),
    ...(isRoleId(raw.role) && { role: raw.role }),
    tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string') : [],
    via: via === 'fragment' || via === 'template' || via === 'import' ? via : 'block',
    attested: false,
  }, parsed)
  const validated = validateDraft({ ...draft, kind: raw.kind ?? draft.kind }, { requireHtmlAttestation: false }).draft
  if (!validated) return null
  return { id, dependencies, missing, component: {
    ...validated, origin: { ...validated.origin, redistributable: false }, id, schema: raw.schema,
    rev: raw.rev, createdAt: raw.createdAt, updatedAt: raw.updatedAt,
  } }
}

/** Discover decoded, managed img src filenames through the same inert qualifier. */
export function discoverLegacyComponentMedia(id: string, raw: unknown): string[] {
  const files = new Set<string>()
  const candidate = qualifyLegacyComponent(id, raw, {
    get(file) { files.add(file); return undefined },
  })
  return candidate ? [...files] : []
}

export function stageLegacyComponents(candidates: ComponentCandidate[], store: ComponentCollection) {
  const records = [...candidates].sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return {
    async preview(dependencies: (candidate: ComponentCandidate, existing: boolean) => Promise<boolean>) {
      const result = { add: [] as string[], conflicts: [] as string[], alreadyPresent: [] as string[], unresolved: [] as string[] }
      for (const { id, component, ...candidate } of records) {
        const status = await store.restoreStatus(component)
        if (status === 'conflict') result.conflicts.push(id)
        else if (candidate.missing || !(await dependencies({ id, component, ...candidate }, status === 'alreadyPresent'))) result.unresolved.push(id)
        else result[status === 'available' ? 'add' : status].push(id)
      }
      return result
    },
    async apply(dependencies: (candidate: ComponentCandidate, existing: boolean) => Promise<'ready' | 'unresolved' | 'failed'>) {
      const result = { restored: [] as string[], conflicts: [] as string[], alreadyPresent: [] as string[], unresolved: [] as string[], failed: [] as string[] }
      for (const candidate of records) {
        const { id, component } = candidate
        try {
          await store.withRestoreEntry(component, async (restore, status) => {
            const current = await status()
            if (current === 'conflict') result.conflicts.push(id)
            else {
              const outcome = candidate.missing ? 'unresolved' : await dependencies(candidate, current === 'alreadyPresent')
              if (outcome !== 'ready') result[outcome].push(id)
              else if (current === 'alreadyPresent') result.alreadyPresent.push(id)
              else {
                const saved = await restore()
                result[saved === 'conflict' ? 'conflicts' : saved].push(id)
              }
            }
          })
        } catch { result.failed.push(id) }
      }
      return result
    },
  }
}
