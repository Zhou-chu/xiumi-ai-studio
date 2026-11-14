import {expect,it} from 'vitest'
import {spawnSync} from 'node:child_process'
import {collectArticleImages} from '../../src/core/articleImages'
import type {Doc} from '../../src/core/types'
const collect=(style:string)=>collectArticleImages({blocks:[{id:'b',type:'html',props:{html:'html'}}]} as Doc,undefined,()=>({querySelectorAll:(selector:string)=>selector==='[style]'?[{getAttribute:()=>style}]:[]} as unknown as Document))
it('preserves legacy CSS URL capture and fallback semantics',()=>{
 const samples=[`background:url('a)b')`,`url('broken)`,`url( )`,`url( x\n)`,`url( x\ny)`,`url("a") url(b)`,`URL(//example.test/a)`,`url('a' x) url(z)`]
 const chars=['a','url(','URL(',')',"'",'"',' ','\n','\t','x'];let seed=7
 for(let i=0;i<4000;i++){let s='';for(let j=0;j<12;j++){seed=(seed*1664525+1013904223)>>>0;s+=chars[seed%chars.length]}samples.push(s)}
 for(const style of samples){const expected=[...new Set([...style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map(m=>m[2].trim()).filter(Boolean).map(u=>u.startsWith('//')?'https:'+u:u))];expect(collect(style),style).toEqual(expected)}
})
it('bounds real image collection on an unclosed CSS URL',()=>{
 const code=`import {collectArticleImages} from './src/core/articleImages.ts';const style='url('+' '.repeat(400000)+'x';const t=performance.now();const result=collectArticleImages({blocks:[{id:'b',type:'html',props:{html:'x'}}]},undefined,()=>({querySelectorAll:s=>s==='[style]'?[{getAttribute:()=>style}]:[]}));if(result.length||performance.now()-t>1500)throw Error('unexpected result or algorithm budget exceeded')`
 const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),encoding:'utf8',timeout:15000});expect(r.error,r.stderr).toBeUndefined();expect(r.status,r.stderr).toBe(0)
},20000)
