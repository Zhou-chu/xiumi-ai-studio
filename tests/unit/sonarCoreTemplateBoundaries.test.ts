// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractSlots, fillSlots } from '../../src/core/slots'

it('ignores empty text containers and retains the longest styled text host when filling', () => {
  expect(extractSlots('<p><br><span> \u200b </span></p>')).toEqual([])
  const html = '<p><span style="color:red">A</span><span style="color:blue">Longer original text.</span></p>'
  const slots = extractSlots(html)
  expect(slots).toHaveLength(1)
  const output = new DOMParser().parseFromString(fillSlots(html, { t0: 'Replacement sentence.' }, { split: false }), 'text/html')
  expect(output.body.textContent).toBe('Replacement sentence.')
  expect(output.querySelector('span')?.style.color).toBe('blue')
})
it('keeps the first host when candidate text nodes have equal lengths', () => {
  const html = '<p><span style="color:red">Alpha</span><span style="color:blue">Bravo</span></p>'
  const output = new DOMParser().parseFromString(fillSlots(html, { t0: 'Same' }, { split: false }), 'text/html')
  expect(output.querySelector('span')?.style.color).toBe('red')
})
it('gives actual template specification tables row headers without pretending layout tables are data', () => {
  const doc = new DOMParser().parseFromString(readFileSync('templates/eea-germany/eea-germany-template.html', 'utf8'), 'text/html')
  const tables = doc.querySelectorAll('table.spec')
  expect(tables).toHaveLength(2)
  for (const table of tables) for (const row of table.querySelectorAll('tr')) {
    expect(row.firstElementChild?.tagName).toBe('TH')
    expect(row.firstElementChild?.getAttribute('scope')).toBe('row')
    expect(row.querySelectorAll('td')).toHaveLength(1)
  }
})
it('gives the imported article fixture an actual document language and title', () => {
  const doc = new DOMParser().parseFromString(readFileSync('tests/fixtures/wechat-article.html', 'utf8'), 'text/html')
  expect(doc.documentElement.lang).toBe('zh-CN')
  expect(doc.title.trim()).not.toBe('')
})
it('does not repeat CSS properties inside generated article inline declarations', () => {
  const doc = new DOMParser().parseFromString(readFileSync('templates/eea-germany/eea-germany-template.html', 'utf8'), 'text/html')
  for (const element of doc.querySelectorAll('[style]')) {
    const properties = (element.getAttribute('style') ?? '').split(';').filter(Boolean).map(decl => decl.split(':')[0].trim())
    expect(new Set(properties).size, element.outerHTML.slice(0, 200)).toBe(properties.length)
  }
})
