import {expect,it,vi} from 'vitest'
import {EventEmitter} from 'node:events'
import type {Request,Response} from 'express'
import {createUploadGate} from '../../server/uploadGate'
const surface=()=>({req:Object.assign(new EventEmitter(),{resume:vi.fn()}) as unknown as Request,res:Object.assign(new EventEmitter(),{setHeader:vi.fn()}) as unknown as Response,next:vi.fn()})
it('ignores duplicate parser completion and retains admission until the one handler settles',async()=>{
 const gate=createUploadGate({concurrency:1});let settle!:()=>void;const handle=vi.fn(()=>new Promise<void>(resolve=>settle=resolve));const route=gate((_req,_res,next)=>{next();next()},handle),a=surface();
 route(a.req,a.res,a.next);expect(handle).toHaveBeenCalledTimes(1);a.res.emit('finish');a.res.emit('close');
 const blocked=surface();route(blocked.req,blocked.res,blocked.next);expect(blocked.next).toHaveBeenCalledWith(expect.objectContaining({status:429}));
 settle();await new Promise(resolve=>setImmediate(resolve));const b=surface();route(b.req,b.res,b.next);expect(handle).toHaveBeenCalledTimes(2);
 const stillBlocked=surface();route(stillBlocked.req,stillBlocked.res,stillBlocked.next);expect(stillBlocked.next).toHaveBeenCalledWith(expect.objectContaining({status:429}));
 b.res.emit('finish');settle();await new Promise(resolve=>setImmediate(resolve));
})
