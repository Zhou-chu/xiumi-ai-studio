import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {collapseNewlineWhitespace,removeFirstImportant,removeParentheticalName} from '../../src/core/textLinear'
it('preserves whitespace, important and first parenthetical-name behavior',()=>{
 for(const text of ['','x y',' \t\n\u2028 \ny ',' \t x','1px  !important suffix !important','!IMPORTANT','name（one）（two）tail','bad（\nname（ok）end','x（）z','（unclosed']){
  expect(collapseNewlineWhitespace(text)).toBe(text.replace(/\s*\n+\s*/g,' '))
  expect(removeFirstImportant(text)).toBe(text.replace(/\s*!important/,''))
  expect(removeParentheticalName(text)).toBe(text.replace(/（.*）/,''))
 }
})
it.each(['collapseNewlineWhitespace','removeFirstImportant','removeParentheticalName'])('bounds %s on long failing suffixes',name=>{
 const char=name==='removeParentheticalName'?'（':' '
 const code=`import {${name}} from './src/core/textLinear.ts';const s='x'+${JSON.stringify(char)}.repeat(400000)+'y';if(${name}(s)!==s)throw Error('changed untouched text')`
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code.replace(';', ';const started=performance.now();') + ';if(performance.now()-started>1500)throw Error("algorithm exceeded 1500ms after imports")'],{encoding:'utf8',timeout:15000,cwd:process.cwd()})
 expect(result.error,result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
it('checks highlight eligibility before scanning an unbounded numeric paragraph',()=>{
 const code=`import {parseArticle} from './src/core/outline.ts';const result=parseArticle('# Title\\n\\n## Section\\n\\n'+'9'.repeat(200000)+'x');if(result.highlights.length)throw Error('ineligible highlight')`
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code.replace(';', ';const started=performance.now();') + ';if(performance.now()-started>1500)throw Error("algorithm exceeded 1500ms after imports")'],{encoding:'utf8',timeout:15000,cwd:process.cwd()})
 expect(result.error,result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
it('matches historical short-text semantics across deterministic mixed delimiters',()=>{
 const alphabet=['a',' ','\t','\n','\r','\u2028','（','）','!important'];let seed=17
 for(let i=0;i<3000;i++){let text='';for(let j=0;j<12;j++){seed=(seed*1664525+1013904223)>>>0;text+=alphabet[seed%alphabet.length]}
 expect(collapseNewlineWhitespace(text)).toBe(text.replace(/\s*\n+\s*/g,' '));expect(removeFirstImportant(text)).toBe(text.replace(/\s*!important/,''));expect(removeParentheticalName(text)).toBe(text.replace(/（.*）/,''))}
})
