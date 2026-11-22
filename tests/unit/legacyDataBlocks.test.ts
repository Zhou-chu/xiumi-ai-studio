import { describe, expect, it } from 'vitest'
import { acceptsLegacyDataBlock } from '../../server/legacyDataBlocks'

describe('legacy data-only block admission', () => {
  it('admits empty editor states and variable-width rows as distinct values', () => {
    const budget = { characters: 0 }
    expect(acceptsLegacyDataBlock('timeline', { items: [] }, budget)).toBe(true)
    expect(acceptsLegacyDataBlock('table', { headers: [], rows: [['a', 'b'], ['c'], []], caption: '' }, budget)).toBe(true)
    expect(budget.characters).toBe(3)
  })

  it('rejects unexpected structures independently of the archive parser', () => {
    const test = (type: 'timeline' | 'table', props: Record<string, unknown>) => acceptsLegacyDataBlock(type, props, { characters: 0 })
    expect(test('timeline', { items: {} })).toBe(false)
    expect(test('timeline', { items: [null] })).toBe(false)
    expect(test('timeline', { items: [[]] })).toBe(false)
    expect(test('timeline', { items: [{ time: '', title: '', markers: '' }] })).toBe(false)
    expect(test('timeline', { items: [], source: '' })).toBe(false)
    expect(test('table', { headers: [], rows: 'rows', caption: '' })).toBe(false)
    expect(test('table', { headers: [], rows: Array(129).fill([]), caption: '' })).toBe(false)
    expect(test('table', { headers: [], rows: [{}], caption: '' })).toBe(false)
    expect(test('table', { headers: [], rows: [], description: '' })).toBe(false)
  })

  it('enforces a shared project text budget across types', () => {
    const budget = { characters: 0 }
    const cell = 'x'.repeat(2_000)
    const items = () => Array.from({ length: 42 }, () => ({ time: cell, title: cell, desc: cell }))
    expect(acceptsLegacyDataBlock('timeline', { items: items() }, budget)).toBe(true)
    expect(budget.characters).toBe(252_000)
    expect(acceptsLegacyDataBlock('table', { headers: [cell], rows: [[cell]], caption: '' }, budget)).toBe(true)
    expect(budget.characters).toBe(256_000)
    expect(acceptsLegacyDataBlock('table', { headers: ['x'], rows: [], caption: '' }, budget)).toBe(false)
  })
})
