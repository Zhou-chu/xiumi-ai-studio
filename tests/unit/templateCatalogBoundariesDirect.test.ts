// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { buildCatalog, guessKind, renumber, templateTheme, type TemplateLike } from '../../src/core/templateFill'
import type { Block } from '../../src/core/types'
const html=(value:string)=>createBlock('html',{html:value,label:'synthetic'})
const tpl=(blocks:Block[],extra:Partial<TemplateLike>={}):TemplateLike=>({id:'fixture',name:'Synthetic',blocks,...extra})
const own=(t:TemplateLike[])=>buildCatalog(t).filter(p=>!p.id.startsWith('b:'))

it.each([
 ['<section></section>','decor'],['<p>这是完整的合成正文句子。</p>','body'],
 ['<p>这是完整的合成正文句子。</p><img src="/media/a.jpg">','mixed'],
 ['<img src="/media/a.jpg">','image'],['<h2 style="font-size:20px">标题</h2>','heading'],
 ['<p>文字：作者</p>','ending'],['<p>扫码关注</p>','ending'],
] as const)('classifies a standalone part without assigning a positional cover (%s)',(source,kind)=>{
 expect(guessKind(html(source))).toBe(kind)
})

it('does not classify a long multi-section text as a tiny credit block just because it contains a credit word',()=>{
 const source='<p>来源：合成资料</p>'+Array.from({length:7},(_,i)=>'<p>这是合成正文句子第'+i+'段。</p>').join('')
 expect(guessKind(html(source))).toBe('body')
 expect(guessKind(createBlock('image',{}))).toBe('image')
})

it('keeps builtin catalog identity by variant and theme, while extracting rich text, timeline and table values',()=>{
 const blocks=[createBlock('gallery',{images:[]}),createBlock('gallery',{images:[{src:'/media/a.jpg'}]}),createBlock('timeline',{items:[{time:'t',title:'Title',desc:'Desc'}]}),createBlock('table',{headers:['A','B'],rows:[['C','D']]}),createBlock('heading',{title:'X'})]
 const a=tpl(blocks,{themeId:'first'}),b=tpl([blocks[4]],{id:'other',themeId:'second'})
 const rows=own([a,b])
 expect(rows.filter(x=>x.block.type==='gallery')).toHaveLength(1)
 expect(rows.find(x=>x.block.type==='gallery')).toMatchObject({photos:3,flexible:true})
 expect(rows.filter(x=>x.block.type==='heading')).toHaveLength(2)
 expect(rows.find(x=>x.block.type==='timeline')?.texts[0]).toMatchObject({text:'t | Title | Desc',role:'body',max:0})
 expect(rows.find(x=>x.block.type==='table')?.texts[0].text).toBe('A | B\nC | D')
 expect(own([tpl([createBlock('gallery',{images:[{src:'/media/a.jpg'}]})])])[0].photos).toBe(1)
})

it('treats first and last positional parts only in a multi-part template and shares identical HTML skeletons',()=>{
 const parts=own([tpl([html('<h2 style="font-size:20px">合成标题</h2>'),html('<p>正文完整句子。</p>'),html('<p>请关注我们</p>')])])
 expect(parts.map(x=>x.kind)).toEqual(['cover','body','ending'])
 const duplicate=own([tpl([html('<h2 style="font-size:20px">标题甲</h2>'),html('<h2 style="font-size:20px">标题乙</h2>')])])
 expect(duplicate).toHaveLength(1);expect(duplicate[0].kind).toBe('heading')
})

it('does not infer an imported theme from a minority of HTML and does not call a parser on a builtin-only branch',()=>{
 const refuse=vi.fn(()=>{throw Error('unexpected parse')})
 expect(templateTheme([],refuse)).toBeUndefined()
 expect(templateTheme([tpl([createBlock('paragraph')])],refuse)).toBeUndefined()
 const overrides={fontSize:19}
 expect(templateTheme([tpl([html('<h2>Not dominant</h2>'),createBlock('paragraph'),createBlock('image')],{themeId:'given',themeOverrides:overrides})],refuse)).toEqual({themeId:'given',themeOverrides:overrides})
 expect(refuse).not.toHaveBeenCalled()
})

it('keeps numbering style for Chinese and Roman fallbacks and defaults to two decimal digits',()=>{
 expect(renumber('第十章',11)).toBe('第11章')
 expect(renumber('Ⅹ',11)).toBe('11')
 expect(renumber('Part',3)).toBe('03')
 expect(renumber('001',12)).toBe('012')
})

it('extracts each reusable decorated frame once even when a template repeats it',()=>{
 const framed='<section><p>合成正文。</p><img src="/media/a.jpg" style="border:1px solid red"></section>'
 const parts=own([tpl([html(framed),html(framed)])])
 expect(parts.filter(p=>p.id.startsWith('f'))).toHaveLength(1)
 expect(parts.find(p=>p.id==='f0')).toMatchObject({kind:'image',photos:1,texts:[],block:{type:'html',props:{label:'图片框'}}})
 expect(parts.find(p=>p.id==='p0')).toMatchObject({kind:'mixed',photos:1})
})
