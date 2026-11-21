import { isRoleId } from '../src/core/roles'
import { THEMES } from '../src/core/themes'
import type { collection, RestoreStatus } from './store'

type TemplateImage = { block: unknown }
type QualifyImage = (block: unknown) => TemplateImage | null
type DesignRecord = { id: string; [field: string]: unknown }
export type DesignCategory = 'themes' | 'templates'
export type DesignData = Record<DesignCategory, DesignRecord[]>
export type DesignCollections = Record<DesignCategory, Pick<ReturnType<typeof collection>, 'restoreStatus' | 'withRestoreEntry'>>
export const DESIGN_ENTRY = /^(templates|themes)\/([\w-]{1,64})\.json$/
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key))

const themeColorTokens = ['primary', 'primarySoft', 'accent', 'text', 'muted', 'bg', 'surface', 'border']
// Keep the directly configurable values in the editor's supported ranges.
const themeNumericRanges = {
  fontSize: [13, 18], h1Size: [18, 32], h2Size: [15, 24], smallSize: [8, 18],
  lineHeight: [1.4, 2.4], letterSpacing: [0, 2], paragraphSpacing: [6, 32],
  blockSpacing: [12, 48], radius: [0, 20], imageRadius: [0, 20],
}
const themeOptions = {
  headingVariant: ['number', 'bar', 'pill', 'underline'],
  quoteVariant: ['line', 'mark', 'center'],
  cardVariant: ['border', 'fill', 'accent'],
  dividerVariant: ['line', 'dots', 'ornament'],
  coverVariant: ['hero', 'band', 'minimal'],
}
const fonts = /^[\p{L}\p{N} ,'"-]{1,512}$/u
const hex = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/
const safeDesignId = /^[\w-]{1,64}$/
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
function validTheme(theme: Record<string, unknown>): boolean {
  const { id, name, description, colors, fontBody, fontHeading } = theme
  if (typeof id !== 'string' || !/^custom-[\w-]+$/.test(id) || !boundedText(name, 160) ||
      !boundedText(description, 2000) || !isObject(colors) || typeof fontBody !== 'string' ||
      typeof fontHeading !== 'string' || !fonts.test(fontBody) || !fonts.test(fontHeading)) return false
  if (!onlyKeys(theme, ['id', 'name', 'description', 'colors', 'fontBody', 'fontHeading',
    ...Object.keys(themeNumericRanges), ...Object.keys(themeOptions)]) || !onlyKeys(colors, themeColorTokens)) return false
  return themeColorTokens.every(k => typeof colors[k] === 'string' && hex.test(colors[k])) &&
    Object.entries(themeNumericRanges).every(([k, [min, max]]) => {
      const value = theme[k]
      return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    }) &&
    Object.entries(themeOptions).every(([k, choices]) => typeof theme[k] === 'string' && choices.includes(theme[k]))
}

const overrideRanges = new Map(Object.entries(themeNumericRanges))
function validOverrides(value: unknown): boolean {
  if (!isObject(value)) return false
  return Object.entries(value).every(([key, token]) => {
    if (key === 'colors') return isObject(token) && onlyKeys(token, themeColorTokens) &&
      Object.values(token).every(color => typeof color === 'string' && hex.test(color))
    const range = overrideRanges.get(key)
    return !!range && typeof token === 'number' && Number.isFinite(token) && token >= range[0] && token <= range[1]
  })
}

function validTemplateHeader(template: DesignRecord) {
  const { name, createdAt, themeId, themeOverrides } = template
  return onlyKeys(template, ['id', 'name', 'blocks', 'createdAt', 'themeId', 'themeOverrides', 'roles']) &&
    boundedText(name, 160) && typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt >= 0 &&
    (themeId === undefined || (typeof themeId === 'string' && safeDesignId.test(themeId))) &&
    (themeOverrides === undefined || (themeId !== undefined && validOverrides(themeOverrides)))
}

function templateBlockShape(block: unknown): block is { id: string; type: unknown; props: Record<string, unknown> } {
  return isObject(block) && onlyKeys(block, ['id', 'props', 'type']) && typeof block.id === 'string' &&
    safeDesignId.test(block.id) && isObject(block.props)
}

function qualifyTemplate(template: DesignRecord, imageBlock?: QualifyImage): DesignRecord | null {
  const { blocks, roles } = template
  if (!validTemplateHeader(template) || !Array.isArray(blocks) || blocks.length > 2000) return null
  const ids = new Set<string>()
  const canonical: unknown[] = []
  for (const block of blocks) {
    if (!templateBlockShape(block) || ids.has(block.id)) return null
    const qualified = block.type === 'image' ? imageBlock?.(block) : validTemplateBlock(block.type, block.props) && { block }
    if (!qualified) return null
    canonical.push(qualified.block)
    ids.add(block.id)
  }
  if (roles !== undefined && (!isObject(roles) || !Object.entries(roles).every(([id, role]) => ids.has(id) && isRoleId(role)))) return null
  return { ...template, blocks: canonical }
}

function validTemplateBlock(type: unknown, props: Record<string, unknown>): boolean {
  const { variant } = props
  if (typeof variant !== 'string') return false
  switch (type) {
    case 'heading':
      return onlyKeys(props, ['index', 'title', 'subtitle', 'variant']) && boundedText(props.index, 160) && boundedText(props.title, 2000) &&
        boundedText(props.subtitle, 2000) && (variant === 'auto' || themeOptions.headingVariant.includes(variant))
    case 'quote':
      return onlyKeys(props, ['text', 'source', 'variant']) && boundedText(props.text, 20_000) && boundedText(props.source, 2000) &&
        (variant === 'auto' || themeOptions.quoteVariant.includes(variant))
    case 'divider':
      return onlyKeys(props, ['variant']) && (variant === 'auto' || themeOptions.dividerVariant.includes(variant))
    default:
      return false
  }
}

const builtinDesignThemes = new Set(THEMES.map(({ id }) => id))
export function qualifyLegacyDesign(kind: DesignCategory, id: string, value: unknown, imageBlock?: QualifyImage): DesignRecord | null {
  if (!isObject(value) || value.id !== id) return null
  const record = { ...value, id }
  return kind === 'themes' ? validTheme(record) ? record : null : qualifyTemplate(record, imageBlock)
}
function templateTheme(template: DesignRecord): string | null {
  return typeof template.themeId === 'string' && !builtinDesignThemes.has(template.themeId) ? template.themeId : null
}
function byDesignId(a: DesignRecord, b: DesignRecord) { return a.id.localeCompare(b.id, 'en') }

/** Internal style-data stage over the same inspected archive as the project plan. */
export function stageLegacyDesign(design: DesignData, store: DesignCollections) {
  const archivedThemes = new Map([...design.themes].sort(byDesignId).map(theme => [theme.id, theme]))
  const archivedTemplates = [...design.templates].sort(byDesignId)
  let used = false
  return {
    async preview(assets?: (id: string, existing: boolean) => Promise<boolean>) {
      const statuses = new Map<string, RestoreStatus>()
      const themes = { add: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[] }
      const templates = { add: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[], unresolved: [] as string[] }
      for (const theme of archivedThemes.values()) {
        const status = await store.themes.restoreStatus(theme)
        statuses.set(theme.id, status)
        const destination = status === 'available' ? themes.add : status === 'conflict' ? themes.conflicts : themes.alreadyPresent
        destination.push(theme.id)
      }
      for (const template of archivedTemplates) {
        const depends = templateTheme(template)
        if (depends && (!statuses.has(depends) || statuses.get(depends) === 'conflict')) {
          templates.unresolved.push(template.id)
          continue
        }
        const status = await store.templates.restoreStatus(template)
        if (status !== 'conflict' && assets && !(await assets(template.id, status === 'alreadyPresent'))) {
          templates.unresolved.push(template.id)
          continue
        }
        const destination = status === 'available' ? templates.add : status === 'conflict' ? templates.conflicts : templates.alreadyPresent
        destination.push(template.id)
      }
      return { themes, templates }
    },
    async apply(assets?: (id: string, existing: boolean) => Promise<'ready' | 'failed' | 'unresolved'>) {
      if (used) throw new Error('恢复计划已使用')
      used = true
      const themes = { restored: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[], failed: [] as string[] }
      const templates = { restored: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[], unresolved: [] as string[], failed: [] as string[] }
      const accepted = new Set<string>()
      for (const theme of archivedThemes.values()) {
        try {
          const result = await store.themes.withRestoreEntry(theme, restore => restore())
          themes[result === 'conflict' ? 'conflicts' : result].push(theme.id)
          if (result !== 'conflict') accepted.add(theme.id)
        } catch { themes.failed.push(theme.id) }
      }
      for (const template of archivedTemplates) {
        const dependency = templateTheme(template)
        if (dependency && !accepted.has(dependency)) {
          templates.unresolved.push(template.id)
          continue
        }
        try {
          const saveTemplate = () => store.templates.withRestoreEntry(template, async (restore, status) => {
            const current = await status()
            if (current === 'conflict') { templates.conflicts.push(template.id); return }
            const dependencyState = await assets?.(template.id, current === 'alreadyPresent')
            if (dependencyState && dependencyState !== 'ready') {
              templates[dependencyState].push(template.id)
              return
            }
            const result = await restore()
            templates[result === 'conflict' ? 'conflicts' : result].push(template.id)
          })
          const theme = dependency ? archivedThemes.get(dependency) : undefined
          if (theme) {
            await store.themes.withRestoreEntry(theme, async (_restore, status) => {
              // Hold the dependency against normal writes while publishing the
              // template. Refuse a local theme edited since the earlier phase.
              if (await status() !== 'alreadyPresent') templates.unresolved.push(template.id)
              else await saveTemplate()
            })
          } else await saveTemplate()
        } catch { templates.failed.push(template.id) }
      }
      return { themes, templates }
    },
  }
}
