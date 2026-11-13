import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { htmlToMarkdown } from '../../server/importer'
import { horizontalInset } from '../../src/core/fragments'
it.each(['<p>正文 <strong>bold</strong></p>','<p><<broken</p>','<p><>text</p>','<p>a<<b>c</p>'])('preserves importer text for %s',html=>{
 const inner=html.slice(3,-4)
 const expected=inner.replace(/<br\s*\/?>/gi,'\n').replace(/<\/?(strong|b)>/gi,'**').replace(/<[^>]+>/g,'').trim()
 expect(htmlToMarkdown(html)).toBe(expected)
})
it.each(['0px','-.5px','.5px','12px','12.5PX','12.px','-2px','+2px','1e2px'])('preserves horizontal inset parsing %s',value=>{
 const match=value.match(/^(-?\d*\.?\d+)px$/i),expected=Math.max(0,Math.round((match?Number.parseFloat(match[1]):0)*100)/100)
 expect(horizontalInset([{getAttribute:()=>`padding-left:${value}`} as unknown as Element])).toEqual([expected,0])
})
it.each(['tags','pixels'])('bounds hostile %s processing in a child',kind=>{
 const code=kind==='tags'?`import {htmlToMarkdown} from './server/importer.ts';if(htmlToMarkdown('<p>'+'<'.repeat(200000)+'</p>')!=='<'.repeat(200000))throw Error('text changed')`:
 `import {horizontalInset} from './src/core/fragments.ts'; const x=horizontalInset([{getAttribute:()=> 'padding-left:'+'9'.repeat(200000)+'!px'}]);if(x[0]!==0)throw Error('invalid CSS accepted')`
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code.replace(';', ';const started=performance.now();') + ';if(performance.now()-started>1500)throw Error("algorithm exceeded 1500ms after imports")'],{encoding:'utf8',timeout:15000,cwd:process.cwd()})
 expect(result.error,result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
import { stripTagSpans } from '../../src/core/textLinear'
it('preserves tag-span removal for malformed, nested and empty brackets',()=>{
 const alphabet=['<','>','a','\n'];let words=['']
 for(let n=0;n<7;n++) { words=words.flatMap(w=>alphabet.map(c=>w+c));for(const text of words)for(const replacement of ['', ' '])expect(stripTagSpans(text,replacement)).toBe(text.replace(/<[^>]+>/g,replacement)) }
})
