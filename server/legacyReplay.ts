// Admit the native text-only starter shape, with up to three independent automatic scenes.
// Do not normalize untrusted input here: admission must not silently drop data.
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const only = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).every(field => fields.includes(field))
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
const hex = (value: unknown): boolean => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
const integer = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
// Native replay normalization clamps delay to this range; reject values it would change.
const nativeDelay = (value: unknown) =>
  value === undefined || (typeof value === 'number' && value >= -5 && value <= 10)

function starterCanvas(value: unknown): boolean {
  if (!object(value) || !only(value, ['width', 'background']) || value.width !== 750) return false
  const { background } = value
  if (!object(background) || !only(background, ['type', 'value', 'grid']) || background.type !== 'color' ||
      !hex(background.value)) return false
  const { grid } = background
  return grid === undefined || (object(grid) && only(grid, ['color', 'size']) &&
    hex(grid.color) && integer(grid.size, 10, 300))
}

function starterTheme(value: unknown): boolean {
  if (!object(value) || !only(value, ['accent', 'inspector', 'alert', 'text', 'cursorPalette'])) return false
  const { accent, inspector, alert, text, cursorPalette } = value
  return [accent, inspector, alert, text].every(hex) && Array.isArray(cursorPalette) &&
    cursorPalette.length >= 1 && cursorPalette.length <= 8 && cursorPalette.every(hex)
}

const starterTypes = new Set<string>(['tag', 'title', 'text', 'button'])
function starterScene(value: unknown, budget: { remaining: number }, sceneIds: Set<string>): boolean {
  if (!object(value) || !only(value, ['id', 'layout', 'finale', 'items']) || !id(value.id) ||
      value.layout !== 'flow' || value.finale !== 'exit' || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > budget.remaining || sceneIds.has(value.id)) return false
  budget.remaining -= value.items.length
  sceneIds.add(value.id)
  const ids = new Set<string>()
  for (const item of value.items) {
    if (!object(item) || !only(item, ['id', 'type', 'content', 'delay']) || !id(item.id) ||
        typeof item.type !== 'string' || !starterTypes.has(item.type) || typeof item.content !== 'string' ||
        item.content.length > 600 || !nativeDelay(item.delay) || ids.has(item.id)) return false
    ids.add(item.id)
  }
  return true
}

function starterPreferences(value: Record<string, unknown>): boolean {
  const { playback, textMode, cursors, budget } = value
  return (textMode === 'image' || textMode === 'svg-text') &&
    object(playback) && only(playback, ['trigger', 'pace']) && playback.trigger === 'auto' && playback.pace === 'fast' &&
    object(cursors) && only(cursors, ['count', 'show']) && integer(cursors.count, 1, 6) && typeof cursors.show === 'boolean' &&
    object(budget) && only(budget, ['sceneKB', 'totalKB']) && budget.sceneKB === 80 && budget.totalKB === 400
}

function starterScenes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return false
  // The original eight-item budget applies across all scenes, not per scene.
  const budget = { remaining: 8 }
  const sceneIds = new Set<string>()
  return value.every(scene => starterScene(scene, budget, sceneIds))
}

export function acceptsLegacyStarterReplay(value: unknown): boolean {
  return object(value) && only(value, ['canvas', 'playback', 'textMode', 'theme', 'cursors', 'budget', 'scenes']) &&
    starterCanvas(value.canvas) && starterTheme(value.theme) && starterPreferences(value) &&
    starterScenes(value.scenes)
}
