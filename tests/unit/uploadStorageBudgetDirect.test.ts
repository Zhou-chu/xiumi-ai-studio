import { expect, it, vi } from 'vitest'
import type { Request } from 'express'
import { boundedDiskStorage } from '../../server/uploadStorage'
const deny=vi.hoisted(()=>(()=>{throw Error('Unexpected disk or gate call during a pure storage budget test')}))
vi.mock('node:fs',()=>({default:{createWriteStream:deny}}))
vi.mock('node:fs/promises',()=>({mkdtemp:deny,readFile:deny,unlink:deny,rmdir:deny}))
vi.mock('../../server/uploadGate',()=>({trackUpload:deny,uploadContext:deny}))
it('cleans completed files on removal and rejects invalid configured budgets',()=>{
 for(const value of [0,-1,Infinity,1.2])expect(()=>boundedDiskStorage(value)).toThrow(RangeError)
 const storage=boundedDiskStorage(10),file={buffer:Buffer.from('old')} as unknown as Express.Multer.File
 let removed=false;storage._removeFile({} as Request,file,error=>{expect(error).toBeNull();removed=true})
 expect(removed).toBe(true);expect(file.buffer).toBeUndefined()
})
