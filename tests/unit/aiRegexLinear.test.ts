import { afterEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chatJson, chatText } from '../../server/ai'
const profile = { id:'test',name:'test',provider:'openai' as const,baseUrl:'https://example.test/v1/',model:'test',apiKey:'fake',jsonMode:true }
afterEach(()=>vi.unstubAllGlobals())
it.each(['prefix ```json \n {"ok":true}\n``` suffix','``` {"ok":true} ```','```json {"ok":true}','{"ok":true}'])('keeps JSON extraction for %s',async text=>{
 vi.stubGlobal('fetch',async()=>Response.json({choices:[{message:{content:text}}]}))
 expect(await chatJson('s','u',{profile})).toEqual({ok:true})
})
it.each(['https://example.test/v1///','https://example.test/v1///x','https://example.test/v1/\n'])('preserves endpoint bytes %s',async baseUrl=>{
 let endpoint='';vi.stubGlobal('fetch',async(url:string)=>{endpoint=url;return Response.json({choices:[{message:{content:'ok'}}]})})
 await chatText('s','u',{profile:{...profile,baseUrl}})
 expect(endpoint).toBe(baseUrl.replace(/\/+$/, '')+'/chat/completions')
})
it.each(['endpoint','fence'])('bounds hostile %s parsing in an isolated process',kind=>{
 const source = `import {chatText,chatJson} from './server/ai.ts';
 const profile=${JSON.stringify(profile)};
 globalThis.fetch=async()=>Response.json({choices:[{message:{content: 'BACKTICKS'+' '.repeat(400000)+'{"ok":true}'}}]});
 if(${JSON.stringify(kind)}==='endpoint') {profile.baseUrl='https://example.test/'+'/'.repeat(200000)+'x';await chatText('s','u',{profile})}
 else await chatJson('s','u',{profile});`.replace('BACKTICKS',String.fromCharCode(96).repeat(3))
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source.replace(';', ';const started=performance.now();') + ';if(performance.now()-started>1500)throw Error("algorithm exceeded 1500ms after imports")'],{cwd:process.cwd(),encoding:'utf8',timeout:15000})
 expect(result.error, result.stderr).toBeUndefined();expect(result.status,result.stderr).toBe(0)
},20000)
import { trimTrailingSlashes } from '../../server/urlText'
it('matches historical suffix semantics including line terminators',()=>{
 for(const prefix of ['', '/', 'https://example.test/v1', 'x\ny', 'x\r\n']) {
  for(const suffix of ['', '/', '///', '/x', '/\n', '/\r', '/\u2028', '/\u2029']) {
   const value=prefix+suffix
   expect(trimTrailingSlashes(value)).toBe(value.replace(/\/+$/, ''))
  }
 }
})
it('retains first-fence, language and whitespace extraction semantics',async()=>{
 for(const text of ['`````` {"after":1}', '```json``` {"after":1}', '```JSON {"a":1}```', '```json\n{"a":1}``` ```{"b":2}```','```jsonjson {"a":1}```','``` \u2028 {"a":1} ```']) {
  const m=text.match(/```(?:json)?\s*([\s\S]*?)```/);const raw=m?m[1]:text
  const start=raw.search(/[[{]/),end=Math.max(raw.lastIndexOf('}'),raw.lastIndexOf(']'))
  vi.stubGlobal('fetch',async()=>Response.json({choices:[{message:{content:text}}]}))
  if(start<0||end<start) await expect(chatJson('s','u',{profile})).rejects.toThrow()
  else expect(await chatJson('s','u',{profile})).toEqual(JSON.parse(raw.slice(start,end+1)))
 }
})
