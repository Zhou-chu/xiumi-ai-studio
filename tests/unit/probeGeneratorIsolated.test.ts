import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { join } from 'node:path'
const h=vi.hoisted(()=>({files:new Map<string,string>(),writes:new Map<string,string>(),rm:vi.fn(),mkdir:vi.fn(),compile:vi.fn(),sharp:vi.fn(),fetch:vi.fn(()=>{throw Error('Unexpected network')})}))
vi.mock('node:fs',()=>({mkdirSync:h.mkdir,rmSync:h.rm,readdirSync:(path:string)=>{path=path.replaceAll('\\','/');if(path!=='/virtual/templates')throw Error('Unexpected fixture directory');return [...h.files.keys()]},readFileSync:(path:string)=>{path=path.replaceAll('\\','/');const name=path.split(/[\\/]/).at(-1)!;if(path!=='/virtual/templates/'+name)throw Error('Unexpected fixture path');const value=h.files.get(name);if(value===undefined)throw Error('Unexpected fixture read');return value},writeFileSync:(path:string,value:string)=>{const normalized=path.replaceAll('\\','/');if(!normalized.startsWith('/virtual/data/compat-probe/')||normalized.includes('..'))throw Error('Unexpected output path');h.writes.set(path,value)}}))
vi.mock('../../server/store',()=>({DATA:'/virtual/data',ROOT:'/virtual/root',DIRS:{templates:'/virtual/templates'}}))
vi.mock('../../src/core/compiler',()=>({compileDoc:h.compile}))
vi.mock('sharp',()=>({default:h.sharp}))
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();h.files.clear();h.writes.clear();vi.stubGlobal('fetch',h.fetch);vi.spyOn(console,'log').mockImplementation(()=>{})
 h.compile.mockImplementation((doc:{title:string})=>({html:`<p>compiled ${doc.title}</p>`}))
 h.sharp.mockImplementation(()=>{const chain={resize:vi.fn(),jpeg:vi.fn(),png:vi.fn(),gif:vi.fn(),clone:vi.fn(),ensureAlpha:vi.fn(),toBuffer:vi.fn(async()=>Buffer.from('SYNTHETIC'))};for(const name of ['resize','jpeg','png','gif','clone','ensureAlpha'] as const)chain[name].mockReturnValue(chain);return chain})
})
afterEach(()=>{try{expect(h.fetch).not.toHaveBeenCalled()}finally{vi.restoreAllMocks();vi.unstubAllGlobals()}})
const output=(name:string)=>h.writes.get(join('/virtual/data','compat-probe',name))
it('builds only original probes when no private templates exist, with virtual IO only',async()=>{
 await import('../../scripts/make-xiumi-probe')
 expect(h.rm).toHaveBeenCalledExactlyOnceWith(join('/virtual/data','compat-probe'),{recursive:true,force:true})
 expect(h.mkdir).toHaveBeenCalledExactlyOnceWith(join('/virtual/data','compat-probe'),{recursive:true})
 expect(h.writes.size).toBe(10)
 expect(output('03-imported-svg-private.html')).toBeUndefined();expect(output('04-imported-carousel-private.html')).toBeUndefined()
 expect(output('01-builtin-no-images.fragment.txt')).toBe('<p>compiled 探针 01</p>')
 expect(output('01-builtin-no-images.html')).toContain('meta name="referrer" content="no-referrer"')
 expect(h.compile.mock.calls[0][0].blocks.map((b:{type:string})=>b.type)).toEqual(['cover','heading','paragraph','card','quote','timeline','table','divider','ending'])
 expect(h.compile.mock.calls[1][0].blocks.map((b:{type:string})=>b.type)).toEqual(['image','imageText','gallery'])
 expect(h.compile.mock.calls[1][0].blocks[0].props.image.src).toBe('data:image/jpeg;base64,U1lOVEhFVElD')
 expect(output('06-image-matrix-private.fragment.txt')).toContain('data:image/png;base64,U1lOVEhFVElD')
 expect(output('07-large-image.fragment.txt')).toContain('B 内嵌大 JPG')
})
it('selects longest small SVG and shortest animated carousel from only synthetic templates',async()=>{
 const small='<svg><text>longer synthetic svg</text></svg>',short='<svg></svg>'
 const carousel=(text:string)=>'<section>'+text+'<svg><animate attributeName="opacity"/></svg>'+Array(6).fill('<div style="background-image:url(https://fixture.invalid/a)"></div>').join('')+'</section>'
 const a=carousel('A'),b=carousel('longer candidate')
 h.files.set('templates.json',JSON.stringify({blocks:[{type:'paragraph',props:{}},...[short,small,a,b].map(html=>({type:'html',props:{html}}))]}));h.files.set('ignored.txt','not JSON')
 await import('../../scripts/make-xiumi-probe')
 // The largest qualifying SVG candidate includes the longer carousel, exactly as the selector currently specifies.
 expect(output('03-imported-svg-private.fragment.txt')).toBe(b)
 expect(output('04-imported-carousel-private.fragment.txt')).toBe(a)
 expect(h.writes.size).toBe(14)
 expect(output('03-imported-svg-private.html')).toContain('私有数据，不要外传')
 expect(output('04-imported-carousel-private.html')).toContain('私有数据，不要外传')
})
it('retains synthetic source format choices without fetching their remote URLs',async()=>{
 const html=['jpg','png','gif'].map(ext=>`<img src="https://mmbiz.qpic.cn/sz_mmbiz_${ext}/synthetic-${ext}?wx_fmt=${ext}">`).join('')
 h.files.set('source.json',JSON.stringify({blocks:[{type:'html',props:{html}}]}));h.files.set('empty.json','{}')
 await import('../../scripts/make-xiumi-probe')
 const matrix=output('06-image-matrix-private.fragment.txt')!
 for(const label of ['E 微信图床 JPG','F 微信图床 PNG','G 微信图床 GIF','J 背景图：微信图床 JPG','L SVG 背景图：微信图床 JPG'])expect(matrix).toContain(label)
 expect(output('05-background-paste-test.fragment.txt')).toContain('A 微信图床背景')
 expect(h.compile).toHaveBeenCalledTimes(2)
})
