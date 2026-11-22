import { expect, it } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { parseCrossSvgPreview } from '../../src/core/crossSvgPreview'
import type { Doc } from '../../src/core/types'
import { assertReplayCanPublish, compileOfflineLinkedSvg, xiumiPackage } from '../../src/editor/wechatOutput'

it('exports typed links only into the dedicated no-network file with per-block reference scopes', async () => {
  const parsed = parseCrossSvgPreview([
    '<svg width="100" height="55" viewBox="0 0 100 55"><rect id="original_source" width="100" height="55" fill="navy"/><rect id="original_target" width="25" height="25" fill="orange"/></svg>',
    '<svg width="100" height="55" viewBox="0 0 100 55"><rect width="100" height="55" fill="purple"><set attributeName="opacity" to="0.3" begin="original_source.click" fill="freeze"/></rect><set href="#original_target" attributeName="opacity" to="0.4" begin="original_source.click" fill="freeze"/></svg>',
  ])!
  const { context, ...scene } = parsed
  expect(context).toBe(false)
  const doc: Doc = { id: 'typed', title: 'Typed scene', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: 1, updatedAt: 1,
    blocks: [{ id: 'repeat-id', type: 'linkedSvg', props: { scene } }, { id: 'repeat-id', type: 'linkedSvg', props: { scene: { ...scene, timing: 7 } } }] }
  expect(compileDoc(doc).html).not.toMatch(/href="#|<set|xiumi_proof_|original_source/)
  expect(() => assertReplayCanPublish(doc)).toThrow(/跨块 SVG/)
  await expect(xiumiPackage(doc)).rejects.toThrow(/跨块 SVG/)
  const html = await compileOfflineLinkedSvg(doc)
  expect(html).toContain("default-src 'none'")
  expect(html).toContain('to="0.3" begin="xiumi_proof_1_1.click"')
  expect(html).toContain('to="0.7" begin="xiumi_proof_2_1.click"')
  expect(html).toContain('href="#xiumi_proof_1_2"')
  expect(html).toContain('href="#xiumi_proof_2_2"')
  expect(html).not.toMatch(/original_source|original_target/)
})
