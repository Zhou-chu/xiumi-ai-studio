import { expect,it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {isDecorLabel,replaceFractionTotal,copyHeading,shortQuote,trimEdgePunctuation,markdownImages,markdownQuote} from '../../src/core/editorialText'
it('matches legacy grammar on deterministic mixed text',()=>{
 const chars=['a','ABC','1','002',' ','\t','\n','\u2028','#','—','–','-','!','[',']','(',')','/','·','。'];let seed=123
 for(let i=0;i<5000;i++){let t='';for(let j=0;j<10;j++){seed=(seed*1664525+1013904223)>>>0;t+=chars[seed%chars.length]}
 expect(hasMarkdownImageSyntax(t)).toBe(/!\[[^\]]*\]\([^)]+\)/.test(t));expect(stripMarkdownImageSyntax(t)).toBe(t.replace(/!\[[^\]]*\]\([^)]+\)/g,''))
 expect(isDecorLabel(t)).toBe(/[A-Za-z]{3,}.*[·|｜/]|[·|｜/].*[A-Za-z]{3,}/.test(t))
 expect(replaceFractionTotal(t,17)).toBe(t.replace(/(\d+)(\s*\/\s*)(\d+)/,(_m,a,s,b)=>a+s+String(17).padStart(b.length,'0')))
 const h=t.match(/^(#{1,4})\s+(.+)$/);expect(copyHeading(t)).toEqual(h?[h[1],h[2]]:null)
 const q=t.match(/^(.*?)\s*[—–]{1,2}\s*(.{1,30})$/);expect(shortQuote(t)).toEqual(q?[q[1],q[2]]:null)
 expect(trimEdgePunctuation(t)).toBe(t.replace(/^[，。！？；、,.!?;:：]+|[，。！？；、,.!?;:：]+$/g,''))
 expect(markdownImages(t)).toEqual([...t.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map(m=>m[1]))
 const m=t.match(/^(.*?)(?:\s*[—–-]{2}\s*(.+))?$/s)!;expect(markdownQuote(t)).toEqual([m[1],m[2]])
 }
})
it.each([
 ['isDecorLabel',"'A'.repeat(200000)"],['replaceFractionTotal',"'9'.repeat(200000)"],
 ['copyHeading',"'# '+' '.repeat(200000)+'x\\u2028y'"],['shortQuote',"'x'+' '.repeat(200000)+'—'+'a'.repeat(31)"],
 ['trimEdgePunctuation',"'x'+'.'.repeat(200000)+'y'"],['markdownImages',"'!['.repeat(200000)"],['markdownQuote',"'x'+' '.repeat(200000)+'y'"]
])('bounds %s independently of module startup',(name,input)=>{
 const code=`import {${name}} from './src/core/editorialText.ts';const t=performance.now();${name}(${input},17);if(performance.now()-t>1500)throw Error('algorithm budget exceeded')`
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),encoding:'utf8',timeout:15000})
 expect(result.error,result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
import {hasMarkdownImageSyntax,stripMarkdownImageSyntax} from '../../src/core/editorialText'
it.each(['hasMarkdownImageSyntax','stripMarkdownImageSyntax'])('bounds adjacent image syntax helper %s',name=>{
 const code=`import {${name}} from './src/core/editorialText.ts';const t=performance.now();${name}('!['.repeat(200000));if(performance.now()-t>1500)throw Error('algorithm budget exceeded')`
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:15000,cwd:process.cwd()})
 expect(result.error,result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
it('preserves broad image syntax separately from usable URL extraction',()=>{
 for(const s of ['![]( )','![]()','![a![b](x)','![x]no ![y](url title)','![](\n)','![x](x)tail','![x](x'] ) {
 expect(hasMarkdownImageSyntax(s)).toBe(/!\[[^\]]*\]\([^)]+\)/.test(s))
 expect(stripMarkdownImageSyntax(s)).toBe(s.replace(/!\[[^\]]*\]\([^)]+\)/g,''))
 }
})
it('preserves quote boundaries at 30 characters and mixed line separators',()=>{
 for(const prefix of ['', 'quote', 'quote\n', 'quote\nword', '  '])for(const dash of ['—','——','———','–','––','--'])for(const gap of ['', ' ', '\n', '\u2028'])for(const size of [0,1,29,30,31]) {
 const text=prefix+gap+dash+gap+'x'.repeat(size),short=text.match(/^(.*?)\s*[—–]{1,2}\s*(.{1,30})$/),long=text.match(/^(.*?)(?:\s*[—–-]{2}\s*(.+))?$/s)!
 expect(shortQuote(text)).toEqual(short?[short[1],short[2]]:null);expect(markdownQuote(text)).toEqual([long[1],long[2]])
 }
})
it('preserves headings including all-whitespace and embedded line-break cases',()=>{
 for(let n=0;n<7;n++)for(const gap of ['', ' ', '\t', '\n ', '\u2028 ', '  '])for(const body of ['', 'text', 'x\u2028y', 'x\ny', ' ']) {
 const text='#'.repeat(n)+gap+body,m=text.match(/^(#{1,4})\s+(.+)$/);expect(copyHeading(text)).toEqual(m?[m[1],m[2]]:null)
 }
})
it('preserves fraction separator bytes and zero-padded total width',()=>{
 for(const text of ['part 001 / 009 end','1\n/\t0003','12/no 42 / 6','x1/2/003','12/','0/0','1 / 2 3 / 4']) for(const total of [0,7,1000])expect(replaceFractionTotal(text,total)).toBe(text.replace(/(\d+)(\s*\/\s*)(\d+)/,(_m,a,s,b)=>a+s+String(total).padStart(b.length,'0')))
})
it('keeps nested malformed image prefixes and whitespace-only bodies distinct',()=>{
 for(const text of ['![a]( ![b](x))','![a]( ![b]( ) ![c](z))','![]()![x](a title)','![a![b](x)tail','![x]bad![ok](url)','![a](x\ny title)']){
 expect(markdownImages(text)).toEqual([...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map(m=>m[1]));expect(stripMarkdownImageSyntax(text)).toBe(text.replace(/!\[[^\]]*\]\([^)]+\)/g,''))
 }
})
