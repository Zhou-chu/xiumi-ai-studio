import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({convertToHtml:vi.fn(),saveAsset:vi.fn(),imageHandler:undefined as any}))
vi.mock('mammoth',()=>({default:{convertToHtml:mock.convertToHtml,images:{imgElement:(handler:any)=>{mock.imageHandler=handler;return handler}}}}))
vi.mock('../../server/assets',()=>({saveAsset:mock.saveAsset}))
import { importFile } from '../../server/importer'
beforeEach(()=>{vi.resetAllMocks();mock.saveAsset.mockImplementation(async(_data,name)=>({id:name,file:name}))})
describe('Word import file/image boundaries',()=>{
  it('collects embedded images with inferred and declared types and promotes the first paragraph',async()=>{
    mock.convertToHtml.mockImplementation(async()=>{
      const read=vi.fn().mockResolvedValue(Buffer.from('image').toString('base64'))
      expect(await mock.imageHandler({read})).toEqual({src:'/media/word-image-1.png'})
      expect(await mock.imageHandler({read,contentType:'image/jpeg'})).toEqual({src:'/media/word-image-2.jpeg'})
      expect(read).toHaveBeenCalledWith('base64')
      return {value:'<p>Title</p><p>Body</p>'}
    })
    const result=await importFile(Buffer.from('fake-docx'),'SOURCE.DOCX')
    expect(result.text).toBe('# Title\n\nBody');expect(result.assets).toHaveLength(2)
  })
  it('preserves an existing first-level heading instead of promoting another paragraph',async()=>{
    mock.convertToHtml.mockResolvedValue({value:'<h1>Heading</h1><p>Body</p>'})
    expect((await importFile(Buffer.from('x'),'source.docx')).text).toBe('# Heading\n\nBody')
  })
  it.each(['end of central directory','Corrupted zip','Invalid zip',"Can't find document",'Could not find file'])('classifies malformed Word content %s',async message=>{
    mock.convertToHtml.mockRejectedValue(Error(message))
    await expect(importFile(Buffer.from('x'),'source.docx')).rejects.toMatchObject({status:400})
  })
  it('propagates unknown errors instead of falsely labeling every importer failure as corrupt input',async()=>{
    const error=Error('database unavailable');mock.convertToHtml.mockRejectedValueOnce(error)
    await expect(importFile(Buffer.from('x'),'source.docx')).rejects.toBe(error)
    mock.convertToHtml.mockRejectedValueOnce('unexpected string')
    await expect(importFile(Buffer.from('x'),'source.docx')).rejects.toBe('unexpected string')
  })
  it.each(['x.txt','x.md','x.markdown'])('strips only leading BOM for %s and rejects unknown formats',async name=>{
    expect(await importFile(Buffer.from('\ufeffhello\ufeff'),name)).toEqual({text:'hello\ufeff',assets:[]})
    await expect(importFile(Buffer.from('x'),'file.exe')).rejects.toMatchObject({status:400})
  })
})
