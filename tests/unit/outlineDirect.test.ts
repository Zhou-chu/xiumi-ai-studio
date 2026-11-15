import { expect,it } from 'vitest'
import { normalizeOutline,parseArticle,type Outline } from '../../src/core/outline'

const fallback=():Outline=>({
  title:'原始标题',subtitle:'原副题',kicker:'原栏目',meta:'原元信息',intro:['原导语'],sections:[],
  highlights:['原亮点'],ending:{text:'原结语',author:'原创者',note:'原注'},
})

it('normalizes only useful typed section material and leaves inputs unchanged',()=>{
  const input={
    title:'  方案标题  ',subtitle:false,kicker:'',meta:'新信息',
    intro:['  第一段 ',5,''],highlights:['a','b','c','d','e'],
    sections:[
      null,{heading:'   '},{heading:' 正文标题 ',paragraphs:[null,' 原文一 ',6,'  '],
        quotes:[{text:' 保留引句 ',source:' 来源'},{text:''}],timeline:[{time:' 10:00 ',title:' 主题',desc:1},{title:''}],
        people:[{name:' 作者 ',role:' 编辑',bio:null},{name:7}],imageRefs:[' /media/synthetic.jpg ',0,''],
        table:{headers:['字段',2],rows:[['内容',5],42]},
      },
    ],
    ending:{text:' ',author:' 新作者 ',note:undefined},
  }
  const snapshot=structuredClone(input), seed=fallback()
  expect(normalizeOutline(input,seed)).toEqual({
    title:'方案标题',subtitle:'原副题',kicker:'原栏目',meta:'新信息',intro:['第一段'],highlights:['a','b','c','d'],
    sections:[{heading:'正文标题',paragraphs:['原文一'],quotes:[{text:'保留引句',source:'来源'}],
      timeline:[{time:'10:00',title:'主题',desc:''}],people:[{name:'作者',role:'编辑',bio:''}],imageRefs:['/media/synthetic.jpg'],
      table:{headers:['字段','2'],rows:[['内容','5'],[]]},
    }],
    ending:{text:'原结语',author:'新作者',note:'原注'},
  })
  expect(input).toEqual(snapshot)
  expect(seed).toEqual(fallback())
})

it('returns the fallback by identity if no valid section survives',()=>{
  const current=fallback()
  for(const candidate of [null,{}, {sections:'not list'}, {title:'不应换稿',sections:[{heading:2},null,{heading:'  '}]}]) {
    expect(normalizeOutline(candidate,current)).toBe(current)
  }
  const min=normalizeOutline({sections:[{heading:'简单标题',table:{headers:1,rows:[]}}]},current)
  expect(min.sections[0]).toMatchObject({heading:'简单标题',paragraphs:[],quotes:[],timeline:[],people:[],imageRefs:[],table:undefined})
  expect(min.ending).toEqual(current.ending)
})

it('uses one fallback title for an empty source and removes empty sections',()=>{
  expect(parseArticle('  \r\n ')).toMatchObject({title:'未命名推文',subtitle:'',sections:[],intro:[]})
  expect(parseArticle('稿名\n\n第一章 占位\n')).toMatchObject({title:'稿名',sections:[]})
})

it('normalizes CRLF, separates a short subtitle from introduction and recovers ordered credits',()=>{
  const source=['合成活动','副标题。','开场说明是保留在导语中的长句。','第一章 参会安排','正文原句应保留不丢失。','文字：测试编辑','摄影：候选志愿者'].join('\r\n')
  const parsed=parseArticle(source)
  expect(parsed).toMatchObject({
    title:'合成活动',subtitle:'副标题。',intro:['开场说明是保留在导语中的长句。'],
    sections:[{heading:'参会安排',paragraphs:['正文原句应保留不丢失。']}],
    ending:{author:'文字：测试编辑\n摄影：候选志愿者'},
  })
})

it('keeps multiple agenda entries structured and restores a lone agenda entry as prose in a subsequent section',()=>{
  const source=['合成活动','第一章 多项议程','09:00 开幕，主厅','10:15 分享，二厅','第二章 单项议程','11:30 午餐，自助区','活动说明保留。'].join('\n')
  const parsed=parseArticle(source)
  expect(parsed.sections[0]).toMatchObject({
    heading:'多项议程',timeline:[{time:'09:00',title:'开幕',desc:'主厅'},{time:'10:15',title:'分享',desc:'二厅'}],
  })
  expect(parsed.sections[1]).toMatchObject({heading:'单项议程',timeline:[],paragraphs:['11:30 午餐，自助区','活动说明保留。']})
})

it('preserves plain table cells and ignores its Markdown-style divider line',()=>{
  const parsed=parseArticle('合成标题\n| 项目 | 表值 |\n| --- | --- |\n| 甲 | 十二 |')
  expect(parsed.sections).toMatchObject([{heading:'正文',table:{headers:['项目','表值'],rows:[['甲','十二']]}}])
})

it('retains Markdown section contents, quote attribution, links to images and tables',()=>{
  const source=[
    '# 合成标题','', '引言说明。', '', '## 内容章节','',
    '首段说明。 ![](/media/synthetic.jpg)','',
    '> “保持原始引用内容” -- 测试作者','',
    '- 列表第一项','- 列表第二项','',
    '| 项目 | 数据 |','| --- | --- |','| 层级 | 三级 |',
  ].join('\n')
  const parsed=parseArticle(source)
  expect(parsed).toMatchObject({
    title:'合成标题',subtitle:'引言说明',intro:['引言说明。'],
    sections:[{heading:'内容章节',paragraphs:['首段说明。','列表第一项','列表第二项'],imageRefs:['/media/synthetic.jpg'],
      quotes:[{text:'保持原始引用内容',source:'测试作者'}],table:{headers:['项目','数据'],rows:[['层级','三级']]}}],
  })
})

it('collects at most four short quantity statements and not dates without units',()=>{
  const parsed=parseArticle([
    '# 合成量化摘要','','## 业务概况','',
    '参与者达到125人。获得奖项22项。服务80家学校。公开发布6件作品。追加数据100条。2026年11月。',
  ].join('\n'))
  expect(parsed.highlights).toEqual(['参与者达到125人','获得奖项22项','服务80家学校','公开发布6件作品'])
})

it.each([
  ['1. ', '开幕仪式'],
  ['12、', '合成标题'],
  ['4． ', '🚄出发'],
  ['第一章 ', '讨论环节'],
] as const)('keeps the first title character after %s in both Markdown and plain outlines', (marker, heading) => {
  const body='必须保留的段落内容。'
  const plain=parseArticle('合成标题\n'+marker+heading+'\n'+body)
  const markdown=parseArticle('# 合成标题\n\n## '+marker+heading+'\n\n'+body)
  expect(plain.sections).toMatchObject([{heading,paragraphs:[body]}])
  expect(markdown.sections).toMatchObject([{heading,paragraphs:[body]}])
})
