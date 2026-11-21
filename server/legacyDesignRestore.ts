import { isRoleId } from '../src/core/roles'
import { THEMES } from '../src/core/themes'
import type { collection, RestoreStatus } from './store'

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

function validTemplate(template: Record<string, unknown>): boolean {
  const { name, blocks, createdAt, themeId, themeOverrides, roles } = template
  // Only the text blocks proven renderable by this independent stage are
  // accepted. The remaining families stay in the explicit notRestored list.
  if (!onlyKeys(template, ['id', 'name', 'blocks', 'createdAt', 'themeId', 'roles']) || !boundedText(name, 160) || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) ||
      createdAt < 0 || (themeId !== undefined && (typeof themeId !== 'string' || !safeDesignId.test(themeId))) ||
      themeOverrides !== undefined || !Array.isArray(blocks) || blocks.length > 2000) return false
  const ids = new Set<string>()
  for (const block of blocks) {
    if (!isObject(block) || !onlyKeys(block, ['id', 'props', 'type']) || typeof block.id !== 'string' || !safeDesignId.test(block.id) ||
        ids.has(block.id) || !isObject(block.props) || !validTemplateBlock(block.type, block.props)) return false
    ids.add(block.id)
  }
  return roles === undefined || (isObject(roles) && Object.entries(roles).every(([id, role]) => ids.has(id) && isRoleId(role)))
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
export function qualifyLegacyDesign(kind: DesignCategory, id: string, value: unknown): DesignRecord | null {
  if (!isObject(value) || value.id !== id) return null
  const accepted = kind === 'themes' ? validTheme(value) : validTemplate(value)
  return accepted ? { ...value, id } : null
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
    async preview() {
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
        const destination = status === 'available' ? templates.add : status === 'conflict' ? templates.conflicts : templates.alreadyPresent
        destination.push(template.id)
      }
      return { themes, templates }
    },
    async apply() {
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
          const saveTemplate = () => store.templates.withRestoreEntry(template, async restore => {
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
