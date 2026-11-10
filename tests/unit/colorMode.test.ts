// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorModeControl, ColorModeProvider } from '../../src/editor/ColorModeControl'
import { COLOR_MODE_KEY, readColorMode, resolveColorMode } from '../../src/editor/colorMode'
import { readFileSync } from 'node:fs'

let root: Root | undefined
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 12))
  localStorage.clear()
  delete document.documentElement.dataset.colorMode
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount() {
  root = createRoot(host)
  act(() => root!.render(createElement(ColorModeProvider, null, createElement(ColorModeControl))))
}

function choose(value: string) {
  const select = host.querySelector('select')!
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

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

it('starts automatic, allows both manual choices, and restores a saved choice on remount', () => {
  mount()
  expect(host.querySelector('select')!.value).toBe('auto')
  expect(document.documentElement.dataset.colorMode).toBe('light')
  expect(host.querySelector('select')!.getAttribute('aria-label')).toBe('界面主题')
  choose('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark')
  choose('light')
  expect(document.documentElement.dataset.colorMode).toBe('light')
  choose('dark')
  act(() => root!.unmount())
  mount()
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('switches automatically across dawn and dusk while the page is open', () => {
  vi.setSystemTime(new Date(2026, 10, 10, 6, 59, 30))
  mount()
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('light')
  vi.setSystemTime(new Date(2026, 10, 10, 18, 59, 30))
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it.each(['focus', 'pageshow'])('rechecks local clock changes immediately on %s', (event) => {
  mount()
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => window.dispatchEvent(new Event(event)))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('rechecks on foreground visibility and keeps manual choices after clock changes', () => {
  mount()
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  choose('light')
  act(() => vi.advanceTimersByTime(120_000))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('light')
  choose('auto')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('uses fresh local wall time rather than a cached timezone or UTC hour', () => {
  mount()
  // Simulate the operating system changing its timezone while this tab remains open.
  vi.spyOn(Date.prototype, 'getHours').mockReturnValue(23)
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  vi.mocked(Date.prototype.getHours).mockReturnValue(8)
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('syncs preference changes from other tabs and resets when storage is cleared', () => {
  mount()
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: localStorage })))
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light', storageArea: localStorage })))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage })))
  expect(host.querySelector('select')!.value).toBe('auto')
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('ignores same-key changes from session storage', () => {
  mount()
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: sessionStorage })))
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('still renders and switches modes when browser storage is denied', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  expect(readColorMode()).toBe('auto')
  mount()
  choose('dark')
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('retains a manual choice for this page when saving it exceeds the storage quota', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
  mount()
  choose('dark')
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('removes timers and listeners on unmount', () => {
  mount()
  act(() => root!.unmount())
  root = undefined
  document.documentElement.dataset.colorMode = 'light'
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => {
    vi.advanceTimersByTime(120_000)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: localStorage }))
  })
  expect(document.documentElement.dataset.colorMode).toBe('light')
  expect(vi.getTimerCount()).toBe(0)
})

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
    const channels = [1, 3, 5].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

it.each(['light', 'dark'])('keeps %s shell text and action labels at WCAG AA contrast', (mode) => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles.css', 'utf8') + '\n' + readFileSync('src/color-mode.css', 'utf8')
  document.head.append(style)
  try {
    document.documentElement.dataset.colorMode = mode
    const css = getComputedStyle(document.documentElement)
    const color = (token: string) => { const value = css.getPropertyValue(token).trim(); expect(value, token).toMatch(/^#[0-9a-f]{3,6}$/i); return value }
    for (const foreground of ['--text', '--sub', '--faint', '--brand', '--danger', '--ok']) {
      expect(contrast(color(foreground), color('--panel')), `${mode}: ${foreground} on panel`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(color('--faint'), color('--bg')), `${mode}: hints on workspace`).toBeGreaterThanOrEqual(4.5)
    for (const background of ['--ui-primary', '--ui-primary-hover', '--ui-accent-start', '--ui-accent-end', '--ui-accent-hover-start', '--ui-accent-hover-end']) {
      expect(contrast('#ffffff', color(background)), `${mode}: white labels on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  } finally {
    style.remove()
  }
})

it('does not apply shell overrides to colliding classes in imported content or thumbnails', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/styles.css', 'utf8') + '\n' + readFileSync('src/color-mode.css', 'utf8')
  document.head.append(style)
  host.innerHTML = ['block-html', 'html-editor', 'mini-preview', 'comp-preview', 'paste-box'].map((surface) =>
    `<div class="${surface}"><button class="accent">Original</button><button class="primary">Action</button><span class="warn">Warning</span><span class="ok">Success</span><span class="toast">Note</span><div class="ai-box">Content</div></div>`).join('')
  const snapshot = () => [...host.querySelectorAll('button, span, .ai-box')].map((element) => {
    const css = getComputedStyle(element)
    return [css.backgroundColor, css.backgroundImage, css.color]
  })
  try {
    document.documentElement.dataset.colorMode = 'light'
    const original = snapshot()
    document.documentElement.dataset.colorMode = 'dark'
    expect(snapshot()).toEqual(original)
  } finally {
    style.remove()
  }
})
