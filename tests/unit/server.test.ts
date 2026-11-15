import { describe, expect, it, vi } from 'vitest'
import { htmlToMarkdown } from '../../server/importer'

vi.mock('mammoth', () => ({ default: { convertToHtml: () => { throw Error('Unexpected Word conversion') } } }))
vi.mock('../../server/docxBudget', () => ({ validateDocxArchive: () => { throw Error('Unexpected archive read') } }))
vi.mock('../../server/assets', () => ({
  saveAsset: () => { throw Error('Unexpected asset write') },
  deleteAsset: () => { throw Error('Unexpected asset delete') },
}))

describe('word import', () => {
  it('maps mammoth HTML to markdown', () => {
    const md = htmlToMarkdown('<h1>标题</h1><p>导语<strong>重点</strong></p><h2>章节</h2><ul><li>一</li></ul><table><tr><td>项目</td><td>数据</td></tr><tr><td>人数</td><td>30</td></tr></table><p><img src="/media/a.jpg" /></p>')
    expect(md).toBe('# 标题\n\n导语**重点**\n\n## 章节\n\n- 一\n\n| 项目 | 数据 |\n| --- | --- |\n| 人数 | 30 |\n\n![](/media/a.jpg)')
  })
})
