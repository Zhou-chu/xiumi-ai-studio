import { afterEach, expect, it } from 'vitest'
import express from 'express'
import multer from 'multer'
import { request, type Server } from 'node:http'
import { boundedDiskStorage } from '../../server/uploadStorage'
const servers: Server[]=[]
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))))})
async function endpoint(){
 const app=express(); const upload=multer({storage:boundedDiskStorage(10),limits:{fileSize:8,files:5}})
 app.post('/',upload.array('files'),(req,res)=>res.json((req.files as Express.Multer.File[]).map(f=>f.buffer.toString())))
 app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status??(err instanceof multer.MulterError?413:500)).json({error:err.message}))
 const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(r=>server.once('listening',r));return (server.address() as {port:number}).port
}
async function send(port:number,files:string[],chunked=false){
 const boundary='test-boundary';const body=files.map((s,i)=>`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${i}.txt"\r\nContent-Type: text/plain\r\n\r\n${s}\r\n`).join('')+`--${boundary}--\r\n`
 return new Promise<{status:number;body:any}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,method:'POST',path:'/',headers:{'content-type':`multipart/form-data; boundary=${boundary}`,...(!chunked?{'content-length':Buffer.byteLength(body)}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(raw)}))});req.on('error',reject);if(chunked){for(let i=0;i<body.length;i+=7)req.write(body.slice(i,i+7));req.end()}else req.end(body)})
}
it('accepts multiple files exactly at aggregate budget',async()=>{expect(await send(await endpoint(),['123456','7890'])).toEqual({status:200,body:['123456','7890']})})
it.each([false,true])('rejects cumulative bytes even without content length=%s and permits next request',async chunked=>{const port=await endpoint();const result=await send(port,['123456','78901'],chunked);expect(result.status).toBe(413);expect(result.body.error).toContain('upload');expect((await send(port,['ok'],chunked)).status).toBe(200)})
it('retains per-file limits',async()=>{expect((await send(await endpoint(),['123456789'])).status).toBe(413)})
it('recovers after a client interrupts a real chunked multipart request',async()=>{
 const port=await endpoint()
 await new Promise<void>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method:'POST',headers:{'content-type':'multipart/form-data; boundary=interrupted'}},res=>res.resume())
  req.on('error',()=>resolve());req.on('close',resolve)
  req.write('--interrupted\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\npartial',error=>{if(error)reject(error);else setTimeout(()=>req.destroy(),10)})
 })
 expect(await send(port,['ok'],true)).toEqual({status:200,body:['ok']})
})
