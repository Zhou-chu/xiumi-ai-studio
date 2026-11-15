import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Embedded = {read:(encoding:string)=>Promise<string>;contentType?:string}
type Handler = (image:Embedded)=>Promise<{src:string}>
type Conversion = (input:{buffer:Buffer},opts:{externalFileAccess:boolean;convertImage:Handler})=>Promise<{value:string}>
const h=vi.hoisted(()=>{
 const unexpected=()=>{throw Error('unexpected Word import boundary')}
 return {unexpected,budget:vi.fn<(buf:Buffer)=>Promise<void>>(unexpected),convert:vi.fn<Conversion>(unexpected),
   save:vi.fn<(data:Buffer,name:string)=>Promise<{id:string;file:string;size?:number}>>(unexpected),remove:vi.fn<(id:string)=>Promise<void>>(unexpected)}
})
vi.mock('mammoth',()=>({default:{convertToHtml:h.convert,images:{imgElement:(fn:Handler)=>fn}}}))
vi.mock('../../server/docxBudget',()=>({validateDocxArchive:h.budget}))
vi.mock('../../server/assets',()=>({saveAsset:h.save,deleteAsset:h.remove}))
import { importFile } from '../../server/importer'

const input=Buffer.from('synthetic in-memory receipt, not an archive')
const embed=(payload:string, contentType?:string)=>({contentType,read:vi.fn(async()=>Buffer.from(payload).toString('base64'))})
const error=(message:string,status:number)=>Object.assign(Error(message),{status})
beforeEach(()=>{
 for(const fn of [h.budget,h.convert,h.save,h.remove])fn.mockReset().mockImplementation(h.unexpected)
 vi.stubGlobal('fetch',vi.fn(h.unexpected))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

it.each([400,413])('checks the archive boundary before conversion and keeps its resource status %s',async status=>{
 const refusal=error('synthetic archive refusal',status)
 h.budget.mockRejectedValueOnce(refusal)
 const result=await importFile(input,'fixture.docx').catch(cause=>cause)
 if(status===413) expect(result).toBe(refusal)
 else expect(result).toMatchObject({status:400,message:expect.stringContaining('无法读取这个 Word 文件')})
 expect(h.budget).toHaveBeenCalledExactlyOnceWith(input)
 expect(h.convert).not.toHaveBeenCalled();expect(h.save).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled()
})

it('passes each in-memory image receipt in order and keeps an actual existing heading',async()=>{
 h.budget.mockResolvedValueOnce(undefined)
 const a=embed('pixel A'),b=embed('pixel B','image/webp')
 h.save.mockResolvedValueOnce({id:'a',file:'receipt-a.png'}).mockResolvedValueOnce({id:'b',file:'receipt-b.webp',size:8})
 h.convert.mockImplementationOnce(async ({buffer},options)=>{
  expect(buffer).toBe(input);expect(options.externalFileAccess).toBe(false)
  const p=await options.convertImage(a),q=await options.convertImage(b)
  return {value:`<h1>Heading</h1><p>A<img src="${p.src}"></p><p>B<img src="${q.src}"></p>`}
 })
 const result=await importFile(input,'CASE.DOCX')
 expect(h.save.mock.calls).toEqual([[Buffer.from('pixel A'),'word-image-1.png'],[Buffer.from('pixel B'),'word-image-2.webp']])
 expect(a.read).toHaveBeenCalledExactlyOnceWith('base64');expect(b.read).toHaveBeenCalledExactlyOnceWith('base64')
 expect(result).toEqual({
  text:'# Heading\n\nA\n\n![](/media/receipt-a.png)\n\nB\n\n![](/media/receipt-b.webp)',
  assets:[{id:'a',file:'receipt-a.png'},{id:'b',file:'receipt-b.webp',size:8}],
 })
 expect(h.budget.mock.invocationCallOrder[0]).toBeLessThan(h.convert.mock.invocationCallOrder[0])
 expect(h.remove).not.toHaveBeenCalled()
})

it('latches an image budget refusal even when the converter catches it and returns partial markup',async()=>{
 h.budget.mockResolvedValueOnce(undefined)
 const first=embed('created'),second=embed('refused'),later=embed('must not read')
 const refusal=error('synthetic image capacity',429)
 const warn=vi.spyOn(console,'warn').mockImplementation(h.unexpected)
 h.save.mockResolvedValueOnce({id:'owned',file:'same.jpg',size:9}).mockRejectedValueOnce(refusal)
 h.remove.mockRejectedValueOnce(Error('synthetic rollback denial'))
 h.convert.mockImplementationOnce(async (_input,{convertImage})=>{
  expect(await convertImage(first)).toEqual({src:'/media/same.jpg'})
  await expect(convertImage(second)).rejects.toBe(refusal)
  await expect(convertImage(later)).rejects.toBe(refusal)
  return {value:'<h1>Partial result</h1>'}
 })
 warn.mockImplementation(()=>{})
 await expect(importFile(input,'fixture.docx')).rejects.toBe(refusal)
 expect(refusal).toMatchObject({status:429,cleanupFailures:1})
 expect(later.read).not.toHaveBeenCalled();expect(h.save).toHaveBeenCalledTimes(2)
 expect(h.remove).toHaveBeenCalledExactlyOnceWith('owned')
 expect(warn).toHaveBeenCalledExactlyOnceWith('Word import rollback failed for 1 newly created assets')
})

it('allows an ordinary per-image failure to be handled by the converter without invalidating other images',async()=>{
 h.budget.mockResolvedValueOnce(undefined)
 const refusal=error('synthetic unsupported image',415)
 h.save.mockRejectedValueOnce(refusal).mockResolvedValueOnce({id:'kept',file:'kept.jpg',size:7})
 h.convert.mockImplementationOnce(async (_input,{convertImage})=>{
  await expect(convertImage(embed('unsupported'))).rejects.toBe(refusal)
  const good=await convertImage(embed('retained','image/jpeg'))
  return {value:`<p>Title</p><p><img src="${good.src}"></p>`}
 })
 expect(await importFile(input,'fixture.docx')).toEqual({text:'# Title\n\n![](/media/kept.jpg)',assets:[{id:'kept',file:'kept.jpg',size:7}]})
 expect(h.remove).not.toHaveBeenCalled()
})
