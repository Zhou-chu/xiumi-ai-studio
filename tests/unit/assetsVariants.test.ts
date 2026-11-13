import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const mock=vi.hoisted(()=>({root:'',dirs:{} as Record<string,string>,sharp:vi.fn(),metadata:vi.fn(),toFile:vi.fn(),toBuffer:vi.fn(),rotate:vi.fn(),resize:vi.fn(),png:vi.fn(),jpeg:vi.fn(),extract:vi.fn(),flatten:vi.fn()}))
vi.mock('sharp',()=>({default:Object.assign(mock.sharp,{strategy:{attention:'attention'}})}))
vi.mock('../../server/store',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../server/store')>()
  const {mkdtempSync,mkdirSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
  mock.root=mkdtempSync(join(tmpdir(),'xiumi-assets-unit-'));mock.dirs={assets:join(mock.root,'assets'),cache:join(mock.root,'cache')}
  Object.values(mock.dirs).forEach(p=>mkdirSync(p))
  return {...actual,DIRS:{...actual.DIRS,...mock.dirs}}
})
import { saveAsset, listAssets, deleteAsset, cropAsset, variantPath, wechatReady, cleanCache } from '../../server/assets'
beforeEach(async()=>{
  vi.clearAllMocks();mock.toBuffer.mockReset()
  const chain={metadata:mock.metadata,toFile:mock.toFile,toBuffer:mock.toBuffer,rotate:mock.rotate,resize:mock.resize,png:mock.png,jpeg:mock.jpeg,extract:mock.extract,flatten:mock.flatten}
  mock.sharp.mockReturnValue(chain)
  for(const fn of [mock.rotate,mock.resize,mock.png,mock.jpeg,mock.extract,mock.flatten]) fn.mockReturnValue(chain)
  mock.metadata.mockResolvedValue({format:'jpeg',hasAlpha:false})
  mock.toFile.mockImplementation(async(path:string)=>{await writeFile(path,'encoded');return {width:128,height:96,size:7}})
  mock.toBuffer.mockResolvedValue(Buffer.from('image'))
  await writeFile(join(mock.dirs.assets,'_index.json'),'{}')
  for(const file of await readdir(mock.dirs.cache)) await rm(join(mock.dirs.cache,file))
})
afterAll(async()=>{await rm(mock.root,{recursive:true,force:true})})
describe('asset variants and export size boundaries',()=>{
  it('normalizes alpha and opaque metadata, preserves source and deletes safely',async()=>{
    mock.metadata.mockResolvedValueOnce({format:'png',hasAlpha:true}).mockResolvedValueOnce({}).mockResolvedValue({format:'jpeg',hasAlpha:false})
    const alpha=await saveAsset(Buffer.from('source'),'alpha.png','https://img.xiumi.us/x')
    const opaque=await saveAsset(Buffer.from('source'),'opaque.jpg')
    expect(alpha.file).toMatch(/\.png$/);expect(alpha.sourceUrl).toBe('https://img.xiumi.us/x');expect(opaque.file).toMatch(/\.jpg$/)
    expect(mock.png).toHaveBeenCalledWith({compressionLevel:9});expect(mock.jpeg).toHaveBeenCalledWith({quality:86,mozjpeg:true})
    expect(await listAssets()).toHaveLength(2)
    await deleteAsset(alpha.id);expect(await listAssets()).toHaveLength(1)
    await deleteAsset('does-not-exist');await expect(deleteAsset('../bad')).rejects.toMatchObject({status:400})
  })
  it('crops to bounded dimensions and leaves the original index entry intact',async()=>{
    const source=await saveAsset(Buffer.from('image'),'source.png')
    const crop=await cropAsset(source.id,{x:-3,y:1.4,width:900,height:900})
    expect(mock.extract).toHaveBeenCalledWith({left:0,top:1,width:128,height:95})
    expect(crop.name).toBe('source-crop.png');expect(await listAssets()).toHaveLength(2)
    await expect(cropAsset('missing',{x:0,y:0,width:1,height:1})).rejects.toMatchObject({status:404})
  })
  it('validates paths, applies crop/default limits and reuses existing cached variants',async()=>{
    await expect(variantPath('../escape.png')).rejects.toMatchObject({status:400})
    await expect(variantPath('missing.png')).rejects.toMatchObject({status:404})
    await writeFile(join(mock.dirs.assets,'test.png'),'png');await writeFile(join(mock.dirs.assets,'test.jpg'),'jpg')
    expect(await variantPath('test.png',undefined,2400)).toBe(join(mock.dirs.assets,'test.png'))
    const cropped=await variantPath('test.png','2:1',400)
    expect(mock.resize).toHaveBeenLastCalledWith({width:400,height:200,fit:'cover',position:'attention'})
    const calls=mock.toFile.mock.calls.length
    expect(await variantPath('test.png','2:1',400)).toBe(cropped);expect(mock.toFile).toHaveBeenCalledTimes(calls)
    await variantPath('test.jpg','invalid',20);expect(mock.resize).toHaveBeenLastCalledWith({width:64,withoutEnlargement:true})
    await variantPath('test.jpg');expect(mock.resize).toHaveBeenLastCalledWith({width:1080,withoutEnlargement:true})
    expect(mock.jpeg).toHaveBeenCalledWith({quality:84,mozjpeg:true})
    await cleanCache();expect(await readdir(mock.dirs.cache)).toEqual([])
  })
  it.each(['png','jpg'])('returns small %s files without recompression',async ext=>{
    const path=join(mock.dirs.assets,`small.${ext}`);await writeFile(path,'image')
    const result=await wechatReady(path)
    expect(result).toEqual({buf:await readFile(path),mime:ext==='png'?'image/png':'image/jpeg',name:`small.${ext}`})
    expect(mock.sharp).not.toHaveBeenCalled()
  })
  it('tries progressively smaller encoding and fails when every variant stays oversized',async()=>{
    const path=join(mock.dirs.assets,'large.png');await writeFile(path,Buffer.alloc(1_000_001))
    const large=Buffer.alloc(1_000_001)
    mock.toBuffer.mockResolvedValueOnce(large).mockResolvedValueOnce(Buffer.from('small'))
    expect(await wechatReady(path)).toEqual({buf:Buffer.from('small'),mime:'image/jpeg',name:'image.jpg'})
    expect(mock.jpeg).toHaveBeenNthCalledWith(1,{quality:80,mozjpeg:true});expect(mock.jpeg).toHaveBeenNthCalledWith(2,{quality:72,mozjpeg:true})
    mock.toBuffer.mockReset().mockResolvedValue(large)
    await expect(wechatReady(path)).rejects.toThrow()
    expect(mock.resize).toHaveBeenLastCalledWith({width:900,withoutEnlargement:true})
  })
})
