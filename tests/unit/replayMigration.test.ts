import { describe, expect, it, vi } from 'vitest'
import { createBlock, normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { defaultReplay, makeItem, replayFinalTimes } from '../../src/core/replay'
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
  const { assertReplayCanPublish, compileForWechat, xiumiUploaded } = await import('../../src/editor/wechatOutput')
  const doc: Doc = { id: 'ordinary', title: '普通文章', blocks: [], themeId: 'modern', author: '', digest: '', createdAt: 0, updatedAt: 0 }
  expect(() => assertReplayCanPublish(doc)).not.toThrow()
  const replay = { ...doc, blocks: normalizeBlocks([{ id: 'replay-one', type: 'replay', props: defaultReplay() }]) }
  await expect(compileForWechat(replay, 'wechat')).rejects.toThrow('公众号发布与上传秀米暂不可用')
  await expect(xiumiUploaded(replay)).rejects.toThrow('公众号发布与上传秀米暂不可用')
})

it('downloads eligible SVG-text replay to a Xiumi import file without uploading anything', async () => {
  const { xiumiPackage } = await import('../../src/editor/wechatOutput')
  const props = defaultReplay()
  const replay = createBlock('replay', props)
  const doc: Doc = { id: 'offline', title: 'Offline', blocks: [replay], themeId: 'modern', author: '', digest: '', createdAt: 0, updatedAt: 0 }
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is disabled'))
  try {
    const result = await xiumiPackage(doc)
    expect(result).toMatchObject({ images: 0, parts: 1 })
    const html = await result.blob.text()
    expect(html).toContain('<text')
    expect(html).toContain('<animate')
    expect(html).not.toMatch(/<image\b|data:image|\/media\//)
    // Replay SVG images cannot use ordinary Xiumi image placeholders.
    props.scenes[0].items.push(makeItem('image', { image: { src: '/media/replay-fixture.png' } }))
    doc.blocks = [createBlock('replay', props)]
    await expect(xiumiPackage(doc)).rejects.toThrow('秀米离线导出不支持回放内嵌图片')
    props.scenes[0].items.pop()
    props.canvas.background = { type: 'image', value: '', image: { src: '/media/replay-background.png' } }
    doc.blocks = [createBlock('replay', props)]
    await expect(xiumiPackage(doc)).rejects.toThrow('秀米离线导出不支持回放内嵌图片')
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
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
