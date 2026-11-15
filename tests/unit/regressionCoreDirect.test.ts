import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { coerceProps, normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'
import { extractArticle } from '../../src/core/wxImport'
import { page } from './wxSvgRegressionFixture'
const doc = (blocks: Block[]): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks, createdAt: 0, updatedAt: 0 })
const a = extractArticle(new JSDOM(page).window.document)
it('compileDoc skips a corrupted block instead of throwing', () => {
    const bad = { id: 'b', type: 'table', props: { headers: null, rows: 5 } } as unknown as Block
    const r = compileDoc(doc([bad, ...normalizeBlocks([{ type: 'divider', props: {} }])]))
    expect(r.warnings[0]).toContain('数据异常')
  })
it('coerceProps keeps valid images and drops invalid ones on create', () => {
    expect(coerceProps('image', { image: { src: '/media/a.jpg', width: '100' } }).image).toEqual({ src: '/media/a.jpg', width: 100 })
    expect(coerceProps('image', { image: 'bad' }).image).toBeUndefined()
  })
it('keeps html headings inside svg foreignObject', () => {
    expect(a.root.textContent).toContain('齐鲁文化谈')
    expect(a.root.textContent).toContain('纸鸢梦工坊')
    expect(a.root.innerHTML).toMatch(/<foreignObject[^>]*><section/i)
  })
