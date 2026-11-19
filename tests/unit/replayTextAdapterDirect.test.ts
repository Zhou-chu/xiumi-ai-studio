import { expect, it, vi } from 'vitest'
import { approxMeasure, baseline, canvasEnv, FONT_FAMILY, wrapText, type FontSpec, type RasterSpec } from '../../src/core/replay/text'

const font:FontSpec={size:10,weight:400,letterSpacing:2}
const spec:RasterSpec={...font,lines:['AB','C'],color:'#010203',lineHeight:20,width:30.1,height:39.7,align:'left'}
const surface=(context:object|null)=>({width:0,height:0,getContext:vi.fn(()=>context),toDataURL:vi.fn(()=> 'data:image/png;base64,synthetic')})
function virtualDocument(...canvases:ReturnType<typeof surface>[]) {
 const createElement=vi.fn((tag:string)=>{
  const found=canvases.shift()
  if(tag!=='canvas'||!found)throw Error('unexpected element')
  return found
 })
 return {createElement,doc:{createElement} as unknown as Document}
}

it('uses the no-canvas approximation for mixtures of wide, narrow, uppercase, numeric and ordinary glyphs',()=>{
 const {doc}=virtualDocument(surface(null))
 const result=canvasEnv(doc)
 expect(result.measure).toBe(approxMeasure);expect(result.rasterize).toBeNull()
 const linear=1+0.3+0.66+0.57+0.28+0.52
 expect(result.measure('中 A7ix',font)).toBeCloseTo(linear*10+12)
 expect(result.measure('中 A7ix',{...font,weight:700})).toBeCloseTo(linear*10*1.04+12)
})

it('caches measured widths by full font identity and accounts for Unicode cells',()=>{
 const measureText=vi.fn(()=>({width:20})), ctx={font:'',measureText}
 const {doc,createElement}=virtualDocument(surface(ctx))
 const measure=canvasEnv(doc).measure
 expect(measure('😀a',font)).toBe(24)
 expect(ctx.font).toBe('400 10px '+FONT_FAMILY)
 expect(measure('😀a',font)).toBe(24);expect(measureText).toHaveBeenCalledOnce()
 expect(measure('😀a',{...font,family:'Some Font',weight:700,letterSpacing:1})).toBe(22)
 expect(measureText).toHaveBeenCalledTimes(2);expect(ctx.font).toBe('700 10px Some Font')
 expect(createElement).toHaveBeenCalledExactlyOnceWith('canvas')
})

it.each([
 ['left',0,0],['center',8.05,12.55],['right',16.1,25.1],
] as const)('translates synthetic %s text rendering with segment colors and returns the same raster receipt from cache',(align,left,second)=>{
 const measure=surface({measureText:vi.fn((text:string)=>({width:text==='A'?3:text==='B'?7:3}))})
 const drawn:{text:string;x:number;y:number;font:string;color:string}[]=[]
 const ctx={scale:vi.fn(),font:'',fillStyle:'',textBaseline:'',letterSpacing:'',
  fillText:vi.fn((text:string,x:number,y:number)=>{drawn.push({text,x,y,font:ctx.font,color:ctx.fillStyle})})}
 const raster=surface(ctx), {doc,createElement}=virtualDocument(measure,raster)
 const render=canvasEnv(doc).rasterize!
 const input={...spec,align,family:'Synthetic Sans',segments:[[{text:'A',color:'#fedcba',weight:700 as const},{text:'B',color:'#abcdef',weight:400 as const}]]}
 expect(render(input)).toBe('data:image/png;base64,synthetic')
 expect(render({...input})).toBe('data:image/png;base64,synthetic')
 expect(createElement).toHaveBeenCalledTimes(2)
 expect(raster.toDataURL).toHaveBeenCalledExactlyOnceWith('image/png')
 expect([raster.width,raster.height]).toEqual([61,80]);expect(ctx.scale).toHaveBeenCalledExactlyOnceWith(2,2)
 expect(ctx.textBaseline).toBe('alphabetic');expect(ctx.letterSpacing).toBe('2px')
 expect(drawn.map(({x,...other})=>{expect(Number.isFinite(x)).toBe(true);return other})).toEqual([
  {text:'A',y:13.6,font:'700 10px Synthetic Sans',color:'#fedcba'},
  {text:'B',y:13.6,font:'400 10px Synthetic Sans',color:'#abcdef'},
  {text:'C',y:33.6,font:'400 10px Synthetic Sans',color:'#010203'},
 ])
 expect(drawn[0].x).toBeCloseTo(left);expect(drawn[1].x).toBeCloseTo(left+5);expect(drawn[2].x).toBeCloseTo(second)
})

it('returns null when the raster surface is unavailable after a valid measurement surface',()=>{
 const raster=surface(null), {doc}=virtualDocument(surface({measureText:vi.fn()}),raster)
 expect(canvasEnv(doc).rasterize?.({...spec,width:0,height:0})).toBeNull()
 expect([raster.width,raster.height]).toEqual([1,1])
 expect(raster.toDataURL).not.toHaveBeenCalled()
})

it('keeps prohibited leading punctuation and splits an overlong later word at glyph boundaries',()=>{
 const measure=(s:string)=>[...s].length
 expect(wrapText('中文，\n\nAB abcdef',font,3,measure)).toEqual(['中文，','','AB','abc','def'])
 expect(wrapText('文，后',font,1,measure)).toEqual(['文，','后'])
 expect(baseline(10,20)).toBe(13.6)
})

it.each(['abcdefgh','甲\nabcdefgh'])('breaks an overlong first token instead of producing an overfull plain line: %j',input=>{
 const lines=wrapText(input,font,3,text=>[...text].length)
 expect(lines).toEqual(input.includes('\n')?['甲','abc','def','gh']:['abc','def','gh'])
 expect(lines.every(line=>[...line].length<=3)).toBe(true)
})

it('splits numeric words but makes progress when even one glyph is wider than the available width',()=>{
 expect(wrapText('AB123-CD next',font,3,text=>[...text].length)).toEqual(['AB1','23-','CD','nex','t'])
 expect(wrapText('A中 B',font,1,text=>[...text].length*3)).toEqual(['A','中','B'])
 expect(wrapText('id X',font,3,text=>[...text].length)).toEqual(['id','X'])
})
