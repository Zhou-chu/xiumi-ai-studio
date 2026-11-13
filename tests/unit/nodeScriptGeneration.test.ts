import {mkdtemp,cp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {afterEach,it,expect,vi} from 'vitest'
import sharp from 'sharp'
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();return {...fs,writeFileSync:vi.fn(fs.writeFileSync),mkdirSync:vi.fn(fs.mkdirSync),rmSync:vi.fn(fs.rmSync)}})
const roots:string[]=[]
async function sandbox(){const root=await mkdtemp(join(tmpdir(),'xiumi-script-test-'));roots.push(root);return root}
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it('legacy CLI generates samples and compatibility probes solely inside an isolated synthetic checkout',async()=>{
 const root=await sandbox();await mkdir(join(root,'server'));await cp(resolve('scripts'),join(root,'scripts'),{recursive:true});await cp(resolve('src/core'),join(root,'src/core'),{recursive:true});await cp(resolve('server/store.ts'),join(root,'server/store.ts'));await writeFile(join(root,'package.json'),'{"type":"module"}');await symlink(resolve('node_modules'),join(root,'node_modules'),'junction')
 const data=join(root,'test-data'),templates=join(data,'templates');await mkdir(templates,{recursive:true});await writeFile(join(templates,'synthetic.json'),JSON.stringify({blocks:[{type:'html',props:{html:'<svg><text>SYNTHETIC ONLY</text></svg>'}}]}))
 const run=(file:string)=>execFileSync(process.execPath,['--import',import.meta.resolve('tsx'),join(root,'scripts',file)],{cwd:root,env:{...process.env,DATA_DIR:data},encoding:'utf8',timeout:30000})
 run('make-sample.ts');const samples=join(root,'samples');expect((await readdir(samples)).sort()).toEqual(['activity.md','activity.txt',...Array.from({length:10},(_,i)=>`photo-${String(i+1).padStart(2,'0')}.jpg`)].sort());expect(await readFile(join(samples,'activity.md'),'utf8')).toMatch(/^# /);expect((await sharp(join(samples,'photo-03.jpg')).metadata()).height).toBe(1600)
 run('make-xiumi-probe.ts');const output=join(data,'compat-probe');expect(await readdir(output)).toHaveLength(12);expect(await readFile(join(output,'03-imported-svg-private.fragment.txt'),'utf8')).toContain('SYNTHETIC ONLY');expect(await readFile(join(output,'02-builtin-data-images.fragment.txt'),'utf8')).toContain('data:image/jpeg;base64,');expect(await readFile(join(output,'06-image-matrix-private.fragment.txt'),'utf8')).toContain('data:image/gif;base64,')
},30000)

async function inputs(root:string){
 const samplesDir=join(root,'samples'),templatesDir=join(root,'templates'),outputDir=join(root,'output');await mkdir(samplesDir);await mkdir(templatesDir)
 await Promise.all(Array.from({length:6},(_,i)=>sharp({create:{width:40,height:30,channels:3,background:'#223344'}}).jpeg().toFile(join(samplesDir,`photo-${String(i+1).padStart(2,'0')}.jpg`))))
 return {samplesDir,templatesDir,outputDir}
}
it('imports without file I/O, and generates the complete original sample with real JPEG metadata',async()=>{
 const fs=await import('node:fs');const write=vi.mocked(fs.writeFileSync),mkdir=vi.mocked(fs.mkdirSync),remove=vi.mocked(fs.rmSync);write.mockClear();mkdir.mockClear();remove.mockClear()
 const {generateSamples}=await import('../../scripts/make-sample');const {generateXiumiProbe}=await import('../../scripts/make-xiumi-probe');expect(typeof generateXiumiProbe).toBe('function');expect(write).not.toHaveBeenCalled();expect(mkdir).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();vi.restoreAllMocks();vi.spyOn(console,'log').mockImplementation(()=>{})
 const root=await sandbox();await generateSamples(root);const txt=await readFile(join(root,'activity.txt'),'utf8'),md=await readFile(join(root,'activity.md'),'utf8');expect(txt.length).toBeGreaterThan(2000);expect(md).toContain('## ');expect(md).toContain('| --- | --- |');expect(md).toContain('> ')
 for(let i=1;i<=10;i++){const meta=await sharp(join(root,`photo-${String(i).padStart(2,'0')}.jpg`)).metadata();expect(meta.format).toBe('jpeg');expect(meta.width).toBe(i%3===0?1200:1600);expect(meta.height).toBe(i%3===0?1600:1067)}
},30000)
it('explicit probe generation uses synthetic SVG/carousel and URL variants, resetting only its output',async()=>{
 vi.spyOn(console,'log').mockImplementation(()=>{});const {generateXiumiProbe}=await import('../../scripts/make-xiumi-probe');const root=await sandbox(),paths=await inputs(root)
 const svg='<svg><text>Synthetic</text></svg>';const carousel='<svg><animate/></svg>'+Array.from({length:6},()=>'<div style="background-image:url(https://mmbiz.qpic.cn/sz_mmbiz_jpg/synthetic)"></div>').join('');const urls='<img src="https://mmbiz.qpic.cn/sz_mmbiz_png/synthetic"><img src="https://mmbiz.qpic.cn/sz_mmbiz_gif/synthetic">'
 await writeFile(join(paths.templatesDir,'fixture.json'),JSON.stringify({blocks:[{type:'html',props:{html:svg}},{type:'html',props:{html:carousel+urls}},{type:'paragraph',props:{}}]}));await writeFile(join(paths.templatesDir,'empty.json'),'{}');await writeFile(join(paths.templatesDir,'ignore.txt'),'not json');await mkdir(paths.outputDir);await writeFile(join(paths.outputDir,'obsolete'),'old');await writeFile(join(root,'sentinel'),'keep')
 await generateXiumiProbe(paths);const files=await readdir(paths.outputDir);expect(files).toHaveLength(14);expect(files).not.toContain('obsolete');expect(await readFile(join(root,'sentinel'),'utf8')).toBe('keep');const result=await readFile(join(paths.outputDir,'06-image-matrix-private.fragment.txt'),'utf8');expect(result).toContain('sz_mmbiz_png/synthetic?wx_fmt=png');expect(result).toContain('sz_mmbiz_gif/synthetic?wx_fmt=gif');expect(await readFile(join(paths.outputDir,'04-imported-carousel-private.fragment.txt'),'utf8')).toBe(carousel+urls)
})
it('missing optional templates are skipped honestly and unsafe output paths cannot delete inputs',async()=>{
 vi.spyOn(console,'log').mockImplementation(()=>{});const {generateXiumiProbe}=await import('../../scripts/make-xiumi-probe');const root=await sandbox(),paths=await inputs(root)
 await generateXiumiProbe(paths);expect(await readdir(paths.outputDir)).toHaveLength(10);expect(console.log).toHaveBeenCalledWith(expect.stringContaining('03'));expect(console.log).toHaveBeenCalledWith(expect.stringContaining('04'))
 await expect(generateXiumiProbe({...paths,outputDir:root})).rejects.toThrow('must not contain');await expect(generateXiumiProbe({...paths,outputDir:paths.samplesDir})).rejects.toThrow('must not contain');expect(await readdir(paths.samplesDir)).toHaveLength(6)
})
it('filesystem and missing-image failures are observable rather than claimed successful',async()=>{
 vi.spyOn(console,'log').mockImplementation(()=>{});const {generateSamples}=await import('../../scripts/make-sample');const {generateXiumiProbe}=await import('../../scripts/make-xiumi-probe');const root=await sandbox();const file=join(root,'file');await writeFile(file,'sentinel');await expect(generateSamples(file)).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('sentinel')
 const paths=await inputs(root);await rm(join(paths.samplesDir,'photo-01.jpg'));await expect(generateXiumiProbe(paths)).rejects.toThrow();expect(await readdir(paths.templatesDir)).toEqual([])
})
