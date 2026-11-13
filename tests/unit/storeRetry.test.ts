import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state=vi.hoisted(()=>({failures:[] as string[],calls:0,removed:[] as string[],observed:[] as string[]}))
vi.mock('node:fs/promises',async(importOriginal)=>{
 const fs=await importOriginal<typeof import('node:fs/promises')>()
 return {...fs,rename:async(from:string,to:string)=>{
  state.calls++;state.observed.push(await fs.readFile(to,'utf8').catch(()=>''))
  const code=state.failures.shift();if(code)throw Object.assign(new Error('injected '+code),{code})
  return fs.rename(from,to)
 },rm:async(path:string,opts:any)=>{state.removed.push(path);return fs.rm(path,opts)}}
})
import { writeJson } from '../../server/store'
const dirs:string[]=[]
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));state.failures=[];state.calls=0;state.removed=[];state.observed=[]})
async function target(){const d=await mkdtemp(join(tmpdir(),'xiumi-retry-'));dirs.push(d);const file=join(d,'state.json');await writeFile(file,'{"old":true}');return {d,file}}
describe('atomic replacement under transient Windows file locks',()=>{
 it.each(['EPERM','EACCES','EBUSY'])('retries %s without exposing incomplete data or deleting the destination',async(code)=>{
  const {d,file}=await target();state.failures=[code,code]
  await writeJson(file,{new:true});expect(state.calls).toBe(3);expect(state.observed).toEqual(Array(3).fill('{"old":true}'));expect(JSON.parse(await readFile(file,'utf8'))).toEqual({new:true});expect(state.removed).not.toContain(file);expect(await readdir(d)).toEqual(['state.json'])
 })
 it('bounds retries, preserves the old document and allows the next queued write',async()=>{
  const {d,file}=await target();state.failures=Array(6).fill('EPERM')
  const results=await Promise.allSettled([writeJson(file,{first:true}),writeJson(file,{second:true})]);expect(results[0]).toMatchObject({status:'rejected',reason:{code:'EPERM'}});expect(results[1].status).toBe('fulfilled');expect(state.calls).toBe(7);expect(state.observed.slice(0,7)).toEqual(Array(7).fill('{"old":true}'));expect(JSON.parse(await readFile(file,'utf8'))).toEqual({second:true});expect(state.removed).not.toContain(file);expect(await readdir(d)).toEqual(['state.json'])
 })
 it('does not retry permanent storage errors',async()=>{
  const {d,file}=await target();state.failures=['ENOSPC'];await expect(writeJson(file,{new:true})).rejects.toMatchObject({code:'ENOSPC'});expect(state.calls).toBe(1);expect(await readFile(file,'utf8')).toBe('{"old":true}');expect(state.removed).not.toContain(file);expect(await readdir(d)).toEqual(['state.json'])
 })
})
