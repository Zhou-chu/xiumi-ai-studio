// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLOR_MODE_KEY, readColorMode, resolveColorMode, saveColorMode } from '../../src/editor/colorMode'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('local day/night boundaries', () => {
  it.each([
    [0, 0, 'dark'], [6, 59, 'dark'], [7, 0, 'light'],
    [18, 59, 'light'], [19, 0, 'dark'], [23, 59, 'dark'],
  ] as const)('uses local %i:%i as %s', (hour, minute, expected) => {
    expect(resolveColorMode('auto', new Date(2026, 10, 10, hour, minute))).toBe(expected)
  })

  it('keeps manual light and dark choices at the opposite time of day', () => {
    expect(resolveColorMode('light', new Date(2026, 10, 10, 23))).toBe('light')
    expect(resolveColorMode('dark', new Date(2026, 10, 10, 12))).toBe('dark')
  })

  it('rejects an invalid stored choice and defaults to local automatic mode', () => {
    expect(readColorMode()).toBe('auto')
    localStorage.setItem(COLOR_MODE_KEY, 'system')
    expect(readColorMode()).toBe('auto')
    localStorage.setItem(COLOR_MODE_KEY, 'dark')
    expect(readColorMode()).toBe('dark')
  })
})

it('writes only the preference key and reads it back without changing unrelated storage', () => {
  localStorage.setItem('unrelated-fixture', 'keep')
  saveColorMode('dark')
  expect(readColorMode()).toBe('dark')
  saveColorMode('auto')
  expect(readColorMode()).toBe('auto')
  expect(localStorage.getItem('unrelated-fixture')).toBe('keep')
})
it('returns automatic mode on a blocked read and does not throw or change persisted preference on a blocked write', () => {
  localStorage.setItem(COLOR_MODE_KEY, 'light')
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Storage blocked') })
  expect(readColorMode()).toBe('auto')
  read.mockRestore()
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage quota') })
  expect(() => saveColorMode('dark')).not.toThrow()
  expect(write).toHaveBeenCalledExactlyOnceWith(COLOR_MODE_KEY, 'dark')
  expect(readColorMode()).toBe('light')
})
it('uses the current local time when callers do not supply a clock', () => {
  const hour = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(22)
  expect(resolveColorMode('auto')).toBe('dark')
  hour.mockReturnValue(10)
  expect(resolveColorMode('auto')).toBe('light')
})
