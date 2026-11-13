// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { styledSelectionHtml } from '../../src/editor/selectedTextStyle'

it.each(['fontSize', 'fontFamily'] as const)('preserves SVG typography when applying %s to surrounding text', property => {
  const host = document.createElement('div')
  host.innerHTML = '<p>before</p><svg style="font-size:30px"><text style="font-size:40px;font-family:Arial">LABEL</text><foreignObject><p style="font-size:18px;font-family:serif">caption</p></foreignObject></svg><p>after</p>'
  const originalSvg = host.querySelector('svg')!.outerHTML
  const range = document.createRange()
  range.selectNodeContents(host)
  const result = styledSelectionHtml(host, range, property, property === 'fontSize' ? '24px' : 'Arial, sans-serif')!
  const parsed = document.createElement('div')
  parsed.innerHTML = result
  expect(parsed.querySelector('svg')!.outerHTML).toBe(originalSvg)
  expect(parsed.querySelector('p > span')!.textContent).toBe('before')
  expect(host.querySelector('svg')!.outerHTML).toBe(originalSvg)
})