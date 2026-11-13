import {expect,it} from 'vitest'
import {parseArticle} from '../../src/core/outline'
import {applyOps} from '../../src/core/ops'
import type {Doc,DocOp} from '../../src/core/types'
it('preserves highlight quantity grammar and existing eligibility',()=>{
 for(const value of ['参加3200余人次活动','组织了12 场活动','共12.5小时服务','收到2,300 多张照片','数量9没有单位','只有2人','共有3余 多人参与']) {
 const result=parseArticle('# 标题\n\n## 正文\n\n'+value)
 const expected=value.split(/[。！；，]/).filter(x=>/\d[\d,.]*\s*(余|多)?\s*(名|人次|人|场|件|张|个|小时|所|支|条|项|家|%)/.test(x)&&x.length>=6&&x.length<40).slice(0,4).map(x=>x.trim())
 expect(result.highlights).toEqual(expected)
 }
})
it('applies the reducer in order without leaking array callback arguments',()=>{
 const doc={id:'doc',title:'original',author:'author',blocks:[],themeId:'minimal-magazine'} as unknown as Doc
 const ops:DocOp[]=[{op:'setMeta',title:'one'},{op:'setMeta',title:'two',author:'updated'}]
 expect(applyOps(doc,ops)).toMatchObject({title:'two',author:'updated'});expect(doc.title).toBe('original');expect(applyOps(doc,[])).toBe(doc)
})
import {hasQuantity} from '../../src/core/editorialText'
it('matches old quantity recognition on mixed numeric and unit fragments',()=>{
 const chars=['a','1','12','.',',',' ','\n','余','多','人','小时','%','x'];let seed=9
 for(let i=0;i<4000;i++){let text='';for(let j=0;j<12;j++){seed=(seed*1664525+1013904223)>>>0;text+=chars[seed%chars.length]};expect(hasQuantity(text),text).toBe(/\d[\d,.]*\s*(余|多)?\s*(名|人次|人|场|件|张|个|小时|所|支|条|项|家|%)/.test(text))}
})
