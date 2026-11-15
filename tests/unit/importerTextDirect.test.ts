import { afterEach, expect, it, vi } from 'vitest'
import { htmlToMarkdown, importFile } from '../../server/importer'
const deny=vi.hoisted(()=>vi.fn(()=>{throw Error('Unexpected archive, converter or asset use')}))
vi.mock('../../server/docxBudget',()=>({validateDocxArchive:deny}))
vi.mock('mammoth',()=>({default:{convertToHtml:deny,images:{imgElement:deny}}}))
vi.mock('../../server/assets',()=>({saveAsset:deny,deleteAsset:deny}))
afterEach(()=>{try {expect(deny).not.toHaveBeenCalled()} finally {deny.mockClear()}})
// Existing test calls this validDocx; all bytes are opaque for the rejected extension.
const validDocx=Buffer.from('synthetic unread bytes')
it.each(['x.txt','x.md','x.markdown'])('strips only leading BOM for %s and rejects unknown formats',async name=>{
    expect(await importFile(Buffer.from('\ufeffhello\ufeff'),name)).toEqual({text:'hello\ufeff',assets:[]})
    await expect(importFile(validDocx,'file.exe')).rejects.toMatchObject({status:400})
  })
it('converts paragraphs, bold spans, breaks and entities while keeping image order within Word semantic output',()=>{
 const html='<h4>次级标题</h4><p>段前&nbsp;<strong>强调</strong><br>换行 &amp; &lt; &gt; &quot; <img src="/media/a.png"></p><p><img src="/media/b.png"></p>'
 expect(htmlToMarkdown(html)).toBe('## 次级标题\n\n段前 **强调**\n换行 & < > "\n\n![](/media/a.png)\n\n![](/media/b.png)')
})
it('keeps list and table structure, replacing a literal delimiter inside a table cell',()=>{
 const html='<li>第一项</li><table><tr><th>标题</th><th>另一列</th></tr><tr><td>A|B</td><td><b>数据</b></td></tr></table><table></table><p> </p>'
 expect(htmlToMarkdown(html)).toBe('- 第一项\n\n| 标题 | 另一列 |\n| --- | --- |\n| A/B | **数据** |')
})
