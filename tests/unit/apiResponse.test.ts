import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
afterEach(()=>vi.unstubAllGlobals())
it('rejects an aborted successful response body instead of manufacturing an empty project',async()=>{
 const error=new DOMException('navigation interrupted body','AbortError')
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:()=>Promise.reject(error)}))
 await expect(api.project('existing')).rejects.toBe(error)
 await expect(api.projects()).rejects.toBe(error)
})
it('rejects malformed success JSON rather than treating it as an empty project list',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:()=>Promise.reject(new SyntaxError('invalid JSON'))}))
 await expect(api.projects()).rejects.toThrow('invalid JSON')
})
it('retains HTTP status when an error response is not JSON',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503,statusText:'Unavailable',json:()=>Promise.reject(new SyntaxError())}))
 await expect(api.projects()).rejects.toMatchObject({status:503,message:'503 Unavailable'})
})
