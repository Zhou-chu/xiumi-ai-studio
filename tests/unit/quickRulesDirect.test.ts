import {expect,it} from 'vitest'
import {createBlock} from '../../src/core/blocks'
import {richToPlain,textToRich} from '../../src/core/richtext'
import {QUICK_ACTIONS} from '../../src/core/quickActions'
import type {Block,Doc} from '../../src/core/types'
const doc=(blocks:Block[]):Doc=>({id:'fixture',title:'规则',author:'',digest:'',themeId:'default',blocks,createdAt:1,updatedAt:1})
const run=(id:string,blocks:Block[])=>QUICK_ACTIONS.find(a=>a.id===id)!.run(doc(blocks))
const paragraph=(text:string)=>createBlock('paragraph',{content:textToRich(text)})
it('splits each long single-line paragraph into complete sentence halves with sequential insertion positions',()=>{
 const sentence='长段落里的事实必须保留，所有字符都按原来的顺序出现。'
 const first=paragraph(sentence.repeat(10)),second=paragraph(sentence.repeat(12))
 const result=run('split-long',[first,second])
 expect(result.ops).toHaveLength(4);expect(result.summary).toContain('2 个')
 for(const [i,block] of [first,second].entries()){
  const a=result.ops[i*2],b=result.ops[i*2+1]
  expect(a.op).toBe('update');expect(b.op).toBe('insert')
  if(a.op!=='update'||b.op!=='insert'||b.block.type!=='paragraph')throw Error('invalid pair')
  expect(a.id).toBe(block.id);expect(b.index).toBe(i*2+1)
  expect(richToPlain(a.props.content)+richToPlain(b.block.props.content)).toBe(richToPlain(block.props.content))
 }
})
it('does not split short, multiline or non-paragraph modules',()=>{
 const result=run('split-long',[paragraph('短文'),paragraph('长'.repeat(210)+'\n第二行'),createBlock('heading',{title:'长'.repeat(250)})])
 expect(result.ops).toEqual([]);expect(result.summary).toBe('没有需要拆分的长段落')
})
it('deduplicates an identical quotation appearing in two paragraphs in the same proposal',()=>{
 const quote='同一条足够长的直接引语不应被重复提炼'
 const result=run('pull-quotes',[paragraph(`他说：“${quote}”`),paragraph(`又说：“${quote}”`)])
 expect(result.ops).toHaveLength(1)
})
it('keeps existing quotations and the four-quote limit while ignoring too-short quotes',()=>{
 const existing='已经展示的足够长引语不应该再重复'
 const blocks=[createBlock('quote',{text:existing}),paragraph(`“${existing}”`),paragraph('“太短”'),...Array.from({length:6},(_,i)=>paragraph(`“第${i}条不同而且足够长的直接引语内容”`))]
 const result=run('pull-quotes',blocks)
 expect(result.ops).toHaveLength(3);expect(result.summary).toBe('提炼 3 处引语')
 expect(result.ops.every(op=>op.op==='insert'&&op.block.type==='quote'&&op.block.props.text!==existing)).toBe(true)
})
it('only inserts dividers before later unseparated headings with sequential coordinates',()=>{
 const result=run('section-dividers',[createBlock('heading'),paragraph('甲'),createBlock('heading'),createBlock('divider'),createBlock('heading'),createBlock('heading')])
 expect(result.ops.map(op=>op.op==='insert'?op.index:null)).toEqual([2,6])
 expect(result.summary).toContain('2 个')
 expect(run('section-dividers',[paragraph('无标题')]).ops).toEqual([])
})
it('renumbers only numbered headings and preserves already-correct or unnumbered headings',()=>{
 const first=createBlock('heading',{index:'01'}),skip=createBlock('heading',{index:''}),wrong=createBlock('heading',{index:'09'})
 const result=run('renumber',[paragraph('正文'),first,skip,wrong])
 expect(result.ops).toEqual([{op:'update',id:wrong.id,props:{index:'02'},reason:'序号与顺序不一致'}])
 expect(run('renumber',[first,skip]).summary).toBe('章节序号已连续')
})
it('leaves a full quote set untouched and reports no suitable quote for plain text',()=>{
 const full:Block[]=Array.from({length:4},(_,i)=>createBlock('quote',{text:`已存在${i}条引言的完整内容`}));full.push(paragraph('“再有一句足够长但不应越过全篇上限的话”'))
 expect(run('pull-quotes',full).ops).toEqual([])
 expect(run('pull-quotes',[paragraph('没有引号的普通正文')]).summary).toBe('没有找到合适的引语')
})
