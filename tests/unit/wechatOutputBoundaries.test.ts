// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {collectImageUrls,compileForWechat,copyRichText,standaloneHtml,download,xiumiPackage,xiumiUploaded} from '../../src/editor/wechatOutput'
import {createBlock} from '../../src/core/blocks'
import {emptyDoc} from '../../src/editor/store'
import {api} from '../../src/editor/api'
const documentOf=()=>({...emptyDoc(),title:'A & <Title>',author:'Author',blocks:[createBlock('image',{image:{src:'/media/a.png'}}),createBlock('image',{image:{src:'/media/b.jpg'}}),createBlock('image',{image:{src:'https://example.test/remote.jpg'}})]})
beforeEach(()=>{
 vi.useFakeTimers();vi.spyOn(api,'wechatUploadImages').mockImplementation(async urls=>Object.fromEntries(urls.map(u=>[u,'https://mmbiz.qpic.cn/'+u.split('/').at(-1)])))
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['fixture']),arrayBuffer:async()=>new ArrayBuffer(3)}))
 vi.stubGlobal('FileReader',class{result='data:image/png;base64,Zml4dHVyZQ==';onload:any;onerror:any;readAsDataURL(){this.onload?.()}})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect:vi.fn(),fillText:vi.fn()} as any);vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,YQ==')
 Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>true)});Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:fixture')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})})
it('real compiler maps local images according to embed, upload or absolute mode, preserving remote URLs',async()=>{
 const doc=documentOf(),progress=vi.fn();expect(collectImageUrls(doc)).toHaveLength(3)
 const embedded=await compileForWechat(doc,'embed',progress);expect(embedded.html).toContain('data:image/png');expect(embedded.html).toContain('https://example.test/remote.jpg');expect(fetch).toHaveBeenCalledTimes(2)
 const uploaded=await compileForWechat(doc,'wechat',progress);expect(uploaded.html).toContain('https://mmbiz.qpic.cn/');expect(uploaded.html).not.toContain('src="/media/')
 const absolute=await compileForWechat(doc,'absolute');expect(absolute.html).toContain(location.origin+'/media/');expect(progress).toHaveBeenCalled()
})
it('image fetch and FileReader errors reject compilation rather than pretending export succeeded',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);await expect(compileForWechat(documentOf(),'embed')).rejects.toThrow('图片加载失败')
 vi.stubGlobal('FileReader',class{onload:any;onerror:any;readAsDataURL(){this.onerror?.(new Error('Read failed'))}});await expect(compileForWechat(documentOf(),'embed')).rejects.toThrow('Read failed')
})
it('clipboard API receives rich and plain promises; rejection falls back to local execCommand safely',async()=>{
 let payload:Record<string,Promise<Blob>>={};vi.stubGlobal('ClipboardItem',class{constructor(data:any){payload=data}});const write=vi.fn(async()=>{await Promise.all(Object.values(payload))});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write}})
 expect(await copyRichText(Promise.resolve('<b>Only fixture text</b>'))).toBe('clipboard-api');expect(write).toHaveBeenCalled();expect((await payload['text/html']).type).toBe('text/html');expect((await payload['text/plain']).type).toBe('text/plain')
 write.mockRejectedValueOnce(new Error('Permission denied'));expect(await copyRichText(Promise.resolve('<p>Fallback fixture</p>'))).toBe('exec-command');expect(document.execCommand).toHaveBeenCalledWith('copy');expect(document.querySelector('[style*="-9999"]')).toBeNull()
})
it('clipboard without API reports a denied fallback and removes temporary DOM',async()=>{
 vi.mocked(document.execCommand).mockReturnValueOnce(false);await expect(copyRichText(Promise.resolve('<p>Fixture</p>'))).rejects.toThrow('拒绝写入剪贴板');expect(document.body.children).toHaveLength(0)
})
it('standalone output escapes metadata; downloads use isolated object URLs and revoke them',()=>{
 const doc=documentOf();expect(standaloneHtml(doc,'<p>Body</p>')).toContain('A &amp; &lt;Title>');expect(standaloneHtml({...doc,author:''},'<p>Body</p>')).toContain('<p>Body</p>')
 download('one.txt','fixture');download('two.bin',new Blob(['x']),'application/octet-stream');expect(URL.createObjectURL).toHaveBeenCalledTimes(2);vi.advanceTimersByTime(2000);expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})
it('Xiumi packages real image files and split text, and rejects failed download or upload maps',async()=>{
 const progress=vi.fn();const packaged=await xiumiPackage(documentOf(),progress);expect(packaged).toMatchObject({images:2,parts:1});expect(packaged.blob.type).toBe('application/zip');expect(progress).toHaveBeenCalledTimes(2)
 const uploaded=await xiumiUploaded(documentOf(),progress);expect(uploaded.images).toBe(0);expect(uploaded.blob.type).toContain('text/plain')
 vi.mocked(api.wechatUploadImages).mockResolvedValueOnce({});await expect(xiumiUploaded(documentOf())).rejects.toThrow('没有上传成功')
 vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);await expect(xiumiPackage(documentOf())).rejects.toThrow('读取失败')
 const short={...emptyDoc(),blocks:[createBlock('heading')]};expect((await xiumiPackage(short)).name).toMatch(/\.txt$/)
 const long={...short,blocks:[createBlock('html',{html:Array.from({length:180},()=>'<p>'+'x'.repeat(1000)+'</p>').join(''),label:'Long'})]};const split=await xiumiPackage(long);expect(split.parts).toBeGreaterThan(1);expect(split.blob.type).toBe('application/zip')
})
