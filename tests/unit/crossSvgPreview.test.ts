import { expect, it } from 'vitest'
import { decodeCrossSvgPreview, parseCrossSvgPreview, renderCrossSvgPreview } from '../../src/core/crossSvgPreview'

it('does not accept non-integer opacity parameters or unreviewed response fields', () => {
  for (const value of [null, { timing: 3.4, target: 4 }, { timing: 0, target: 4 }, { timing: 3, target: 10 }, { timing: '3', target: 4 }, { timing: 3, target: 4, source: 'other' }]) {
    expect(decodeCrossSvgPreview(value)).toBeNull()
  }
  expect(renderCrossSvgPreview({ timing: 3, target: 10 } as Parameters<typeof renderCrossSvgPreview>[0])).toBeNull()
  expect(parseCrossSvgPreview([])).toBeNull()
  expect(parseCrossSvgPreview(['a'.repeat(1025), '', '', '', ''])).toBeNull()
})

it('does not project an unsupported action, dangling target, missing fragment, or reused source name', async () => {
  const { nativeSvgFixture, nativeSvgProjectId } = await import('../fixtures/legacy-native-svg')
  const { readFile } = await import('node:fs/promises')
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(await readFile(nativeSvgFixture))
  const doc = JSON.parse(await archive.file(`projects/${nativeSvgProjectId}.json`)!.async('string'))
  const fragments: string[] = doc.blocks.map((block: { props: { html: string } }) => block.props.html)
  expect(parseCrossSvgPreview(fragments)).toMatchObject({ timing: 3, target: 4, context: true })
  const varied = parseCrossSvgPreview(fragments.slice(2, 4).map(value => value.replaceAll('width="100"', 'width="80.5"').replaceAll('fill="navy"', 'fill="#abcdef"')))
  expect(varied).toMatchObject({ context: false, sourceBox: { width: 80.5 }, sourceRect: { width: 80.5, fill: '#abcdef' } })
  expect(renderCrossSvgPreview(varied!)).toContain('width="80.5"')
  expect(decodeCrossSvgPreview({ ...varied, sourceRect: { ...varied!.sourceRect, fill: 'other' } })).toBeNull()
  const mutations = [
    [3, 'art_explicit_target', 'unmatched'],
    [3, 'art_trigger.click', 'unmatched.click'],
    [3, 'attributeName="opacity"', 'attributeName="visibility"'],
    [2, 'art_explicit_target', 'art_trigger'],
    [0, 'width="100"', 'width="99"'],
  ] as const
  for (const [index, from, to] of mutations) {
    expect(parseCrossSvgPreview(fragments.map((value, i) => i === index ? value.replace(from, to) : value))).toBeNull()
  }
})
