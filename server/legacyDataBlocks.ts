// Legacy native data-only blocks. None of these properties are interpreted as
// markup, URLs, or media; the normal compiler escapes all displayed text.
const MAX_TIMELINE_ITEMS = 128
const MAX_TABLE_ROWS = 128
const MAX_TABLE_COLUMNS = 32
const MAX_FIELD_CHARACTERS = 2_000
const MAX_PROJECT_CHARACTERS = 256_000

export type LegacyDataBlockBudget = { characters: number }

function boundedField(value: unknown, budget: LegacyDataBlockBudget): boolean {
  if (typeof value !== 'string' || value.length > MAX_FIELD_CHARACTERS) return false
  budget.characters += value.length
  return budget.characters <= MAX_PROJECT_CHARACTERS
}

function timelineItem(value: unknown, budget: LegacyDataBlockBudget): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 3
    && boundedField(item.time, budget)
    && boundedField(item.title, budget)
    && boundedField(item.desc, budget)
}

function tableRow(value: unknown, budget: LegacyDataBlockBudget): boolean {
  return Array.isArray(value) && value.length <= MAX_TABLE_COLUMNS && value.every(cell => boundedField(cell, budget))
}

export function acceptsLegacyDataBlock(type: 'timeline' | 'table', props: Record<string, unknown>, budget: LegacyDataBlockBudget): boolean {
  if (type === 'timeline') {
    return Object.keys(props).length === 1
      && Array.isArray(props.items) && props.items.length <= MAX_TIMELINE_ITEMS
      && props.items.every(item => timelineItem(item, budget))
  }
  // The editor parses each row independently, so preserve irregular widths.
  return Object.keys(props).length === 3
    && tableRow(props.headers, budget)
    && boundedField(props.caption, budget)
    && Array.isArray(props.rows) && props.rows.length <= MAX_TABLE_ROWS
    && props.rows.every(row => tableRow(row, budget))
}
