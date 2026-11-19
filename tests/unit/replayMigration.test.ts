import { describe, expect, it } from 'vitest'
import { createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { defaultReplay, replayFinalTimes } from '../../src/core/replay'
import type { Doc } from '../../src/core/types'

describe('migrated editorial replay', () => {
  it('round-trips a replay block through the existing article model and compiles an SVG text article', () => {
    const props = defaultReplay()
    const blocks = normalizeBlocks(JSON.parse(JSON.stringify([{ id: 'replay-one', type: 'replay', props }])))
    expect(blocks).toHaveLength(1)
    const [block] = blocks
    expect(block.type).toBe('replay')
    if (block.type !== 'replay') throw new Error('not a replay')
    expect(replayFinalTimes(block.props).every(Number.isFinite)).toBe(true)
    const doc: Doc = { id: 'ordinary', title: '普通文章', blocks, themeId: 'modern', author: '', digest: '', createdAt: 0, updatedAt: 0 }
    const result = compileDoc(doc)
    expect(result.html).toContain('<svg')
    expect(result.html).toContain('<text')
    expect(result.html).toContain('<animate')
  })
})

it('does not offer unverified platform publishing for replay articles', async () => {
  const { assertReplayCanPublish, compileForWechat, xiumiPackage } = await import('../../src/editor/wechatOutput')
  const doc: Doc = { id: 'ordinary', title: '普通文章', blocks: [], themeId: 'modern', author: '', digest: '', createdAt: 0, updatedAt: 0 }
  expect(() => assertReplayCanPublish(doc)).not.toThrow()
  const replay = { ...doc, blocks: normalizeBlocks([{ id: 'replay-one', type: 'replay', props: defaultReplay() }]) }
  await expect(compileForWechat(replay, 'wechat')).rejects.toThrow('暂只支持本地 HTML')
  await expect(xiumiPackage(replay)).rejects.toThrow('暂只支持本地 HTML')
})


it('keeps replay top level without losing an existing box child', async () => {
  const { moveBlockTo, replaceBlockWith } = await import('../../src/core/tree')
  const child = createBlock('heading')
  const box = createBlock('box', { children: [child] })
  const replay = createBlock('replay')
  const blocks = [box, replay]
  expect(moveBlockTo(blocks, replay.id, box.id, 0)).toBe(blocks)
  expect(replaceBlockWith(blocks, child.id, [replay])).toBe(blocks)
})
