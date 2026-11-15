import { expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { Request } from 'express'
import { boundedDiskStorage } from '../../server/uploadStorage'
it('clears concurrent pending buffers on aggregate overflow and calls each callback once',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request
 const streams=[new PassThrough(),new PassThrough()];const results:any[]=[]
 streams.forEach((stream,i)=>storage._handleFile(req,{stream} as unknown as Express.Multer.File,(error,info)=>results.push({i,error,info})))
 streams[0].write('123456');streams[1].write('78901');streams.forEach(s=>s.end())
 await vi.waitFor(()=>expect(results).toHaveLength(2));expect(results.every(r=>r.error?.status===413&&!r.info)).toBe(true)
})
it('settles an aborted upload without retaining data or leaking request listeners',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request,stream=new PassThrough();const results:any[]=[]
 storage._handleFile(req,{stream} as unknown as Express.Multer.File,(error,info)=>results.push({error,info}));stream.write('partial');req.emit('aborted');stream.end()
 await vi.waitFor(()=>expect(results).toHaveLength(1));expect(results[0].error).toBeTruthy();expect(req.listenerCount('aborted')).toBe(0)
})
it('propagates stream errors once and fails later files in the same failed request',async()=>{
 const storage=boundedDiskStorage(10),req=new EventEmitter() as Request,stream=new PassThrough();const results:any[]=[]
 storage._handleFile(req,{stream} as unknown as Express.Multer.File,error=>results.push(error))
 const error=Error('stream failed');stream.emit('error',error);stream.emit('error',error);stream.end()
 const later=new PassThrough();storage._handleFile(req,{stream:later} as unknown as Express.Multer.File,error=>results.push(error));later.end('x')
 await vi.waitFor(()=>expect(results).toEqual([error,error]));expect(req.listenerCount('aborted')).toBe(0)
})
