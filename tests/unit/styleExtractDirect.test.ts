import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { analyzeStyle, themeFromReport, type StyleReport } from '../../src/core/styleExtract'

const analyze = (html: string) => analyzeStyle(new JSDOM(html).window.document.body)
const report = (overrides: Partial<StyleReport> = {}): StyleReport => ({
  sampleCount: 0, colors: [], backgrounds: [], fontSizes: [], lineHeight: 1.75,
  letterSpacing: 0.5, paragraphSpacing: 16, radius: 4,
  traits: { borderLeft: 0, pill: 0, centered: 0, images: 0, tables: 0 },
  ...overrides,
})

it('reports defaults without styled elements while counting actual media elements', () => {
  expect(analyze('<p>plain</p><img><table><tr><td>one</td></tr></table><img>')).toEqual(
    report({ traits: { borderLeft: 0, pill: 0, centered: 0, images: 2, tables: 1 } }),
  )
})

it('weights text and font frequencies by bounded character counts, not unbounded long text', () => {
  const result = analyze(
    '<p style="color:#abc;font-size:1.2em">' + 'x'.repeat(420) + '</p>' +
    '<p style="COLOR: #aabbcc !important ;font-size:18px">cat</p>' +
    '<p style="color:rgb(17, 34, 51);font-size:1rem">dog</p>' +
    '<p style="color:rgba(3,4,5,0.1);font-size:49px">excluded</p>' +
    '<i style="color:#123;font-size:8px"></i>',
  )
  expect(result.colors).toEqual([{ color: '#aabbcc', count: 203 }, { color: '#112233', count: 4 }])
  expect(result.fontSizes).toEqual([{ size: 18, count: 303 }, { size: 15, count: 3 }])
})

it('summarizes numeric spacing medians and counts only qualifying style traits', () => {
  const data = analyze('<p style="font-size:12pt;line-height:24px;letter-spacing:1px;margin-bottom:11px;border-radius:2px;border-left:1px solid red;text-align:center">A</p>' +
    '<p style="font-size:16px;line-height:1.8;letter-spacing:2.25px;margin:1px 2px 22px 4px;border-radius:3px">B</p>' +
    '<p style="line-height:normal;letter-spacing:6px;margin-bottom:99px;border-radius:50px">C</p>' +
    '<div style="background:#fff;border-radius:9px">D</div><div style="background:#eef url(/missing);border-radius:100px">E</div>')
  expect(data).toMatchObject({
    sampleCount: 5, lineHeight: 1.8, letterSpacing: 2.3, paragraphSpacing: 22, radius: 3,
    backgrounds: [{ color: '#eeeeff', count: 1 }],
    traits: { borderLeft: 1, centered: 1, pill: 2 },
  })
})

it('builds a default independent theme with a deterministic ID under the supplied clock', () => {
  const date = vi.spyOn(Date, 'now').mockReturnValue(123456)
  try {
    expect(themeFromReport(report(), 'Original sample')).toMatchObject({
      id: 'custom-2n9c', name: 'Original sample', fontSize: 15, h1Size: 24, h2Size: 18,
      headingVariant: 'number', quoteVariant: 'mark', cardVariant: 'border', dividerVariant: 'line',
      coverVariant: 'minimal', colors: { primary: '#3A5BA0', text: '#2B2B2B' },
    })
  } finally { date.mockRestore() }
})

it.each([
  [{ pill: 3, borderLeft: 4, centered: 9 }, 'pill', 'line'],
  [{ pill: 0, borderLeft: 3, centered: 9 }, 'bar', 'line'],
  [{ pill: 0, borderLeft: 0, centered: 7 }, 'underline', 'center'],
] as const)('ranks competing decorative traits by precedence', (traits, headingVariant, quoteVariant) => {
  const data = report({
    colors: [{ color: '#2468aa', count: 6 }, { color: '#d88a20', count: 2 }, { color: '#181818', count: 1 }],
    backgrounds: [{ color: '#fcfcfc', count: 8 }, { color: '#eeeeee', count: 3 }],
    fontSizes: [{ size: 17, count: 50 }, { size: 35, count: 4 }, { size: 20, count: 7 }],
    lineHeight: 4, letterSpacing: 3, paragraphSpacing: 100, radius: 24,
    traits: { ...traits, tables: 0, images: 4 },
  })
  const snapshot = structuredClone(data)
  expect(themeFromReport(data, 'Staff')).toMatchObject({
    headingVariant, quoteVariant, cardVariant: 'fill', dividerVariant: 'ornament', coverVariant: 'hero',
    fontSize: 17, h2Size: 20, h1Size: 35, lineHeight: 2.2, letterSpacing: 2, paragraphSpacing: 32,
    blockSpacing: 40, imageRadius: 16, radius: 16, colors: { primary: '#2468aa', accent: '#d88a20', surface: '#fcfcfc' },
  })
  expect(data).toEqual(snapshot)
})
