// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block } from '../../src/core/types'
const h=vi.hoisted(()=>({compile:vi.fn(),finals:vi.fn(),seek:vi.fn(),pause:vi.fn(),blocks:[] as Block[]}))
vi.mock('../../src/core/compiler',()=>({compileReplay:h.compile,REPLAY_ERROR:'REPLAY_ERROR'}))
vi.mock('../../src/core/replay',async original=>({...await original<typeof import('../../src/core/replay')>(),replayFinalTimes:h.finals}))
vi.mock('../../src/editor/store',()=>({useStore:(select:(s:{doc:{blocks:Block[]}})=>unknown)=>select({doc:{blocks:h.blocks}})}))
vi.mock('../../src/editor/Modal',()=>({Modal:({children,onClose}:{children:ReactNode;onClose:()=>void})=>createElement('section',{role:'dialog'},children,createElement('button',{onClick:onClose,'data-close':true},'关闭'))}))
import { ReplayCanvasBody, ReplayPreviewModal, ReplayHost } from '../../src/editor/ReplayPreview'
let host:HTMLDivElement,root:Root,clock:number,next:number
const raf=new Map<number,FrameRequestCallback>()
const close=vi.fn(),fetchGuard=vi.fn(()=>{throw Error('Unexpected preview IO')})
const output=(over:Record<string,unknown>={})=>({html:'<svg data-root="first"></svg>',scenes:[{total:5,end:4,bytes:2048}],errors:[],warnings:[],...over})
const block=()=>({...createBlock('replay'),id:'replay-fixture'}) as Block<'replay'>
const el=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`[data-testid="${id}"]`)!
const click=(node:HTMLElement)=>act(()=>node.click())
const byText=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
function frame(ms:number){clock+=ms;const tasks=[...raf.values()];raf.clear();act(()=>tasks.forEach(cb=>cb(clock)))}
function mount(b=block()){act(()=>root.render(createElement(ReplayPreviewModal,{block:b,onClose:close})))}
const oldPause=Object.getOwnPropertyDescriptor(SVGElement.prototype,'pauseAnimations'),oldSeek=Object.getOwnPropertyDescriptor(SVGElement.prototype,'setCurrentTime')
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);fetchGuard.mockClear();vi.stubGlobal('fetch',fetchGuard)
 h.compile.mockReset().mockImplementation(()=>output());h.finals.mockReset().mockReturnValue([4]);h.seek.mockClear();h.pause.mockClear();h.blocks=[];close.mockClear()
 clock=0;next=0;raf.clear();vi.spyOn(performance,'now').mockImplementation(()=>clock)
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{const id=++next;raf.set(id,cb);return id})
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>raf.delete(id))
 Object.defineProperty(SVGElement.prototype,'pauseAnimations',{configurable:true,value:function(this:SVGElement){h.pause(this.getAttribute('data-root'))}})
 Object.defineProperty(SVGElement.prototype,'setCurrentTime',{configurable:true,value:function(this:SVGElement,t:number){h.seek(this.getAttribute('data-root'),t)}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{
 act(()=>root.unmount());host.remove();expect(fetchGuard).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks()
 for(const [name,descriptor] of [['pauseAnimations',oldPause],['setCurrentTime',oldSeek]] as const){if(descriptor)Object.defineProperty(SVGElement.prototype,name,descriptor);else Reflect.deleteProperty(SVGElement.prototype,name)}
})
it('freezes the canvas on final metadata without changing the user playback settings',()=>{
 const b=block();b.props.playback={...b.props.playback,trigger:'tap',loop:{hold:0}}
 const original=structuredClone(b)
 act(()=>root.render(createElement(ReplayCanvasBody,{block:b})))
 expect(h.compile.mock.calls[0][0].props.playback).toMatchObject({trigger:'auto',loop:undefined})
 expect(b).toEqual(original);expect(h.seek).toHaveBeenCalledExactlyOnceWith('first',4);expect(h.pause).toHaveBeenCalledExactlyOnceWith('first')
 const open=vi.fn(),bubble=vi.fn();window.addEventListener('open-replay',open);document.body.addEventListener('click',bubble)
 try {click(el('replay-open'));expect(open).toHaveBeenCalledOnce();expect((open.mock.calls[0][0] as CustomEvent).detail).toEqual({id:b.id});expect(bubble).not.toHaveBeenCalled()}
 finally {window.removeEventListener('open-replay',open);document.body.removeEventListener('click',bubble)}
})
it('treats nonfinite final metadata as zero rather than seeking an invalid time',()=>{
 h.finals.mockReturnValue([Number.NaN]);act(()=>root.render(createElement(ReplayCanvasBody,{block:block()})))
 expect(h.seek).toHaveBeenCalledExactlyOnceWith('first',0)
})
it('starts at the relay offset, reports scene size and converts tap preview only',()=>{
 const b=block();b.props.playback={...b.props.playback,start:1,trigger:'tap'};mount(b)
 expect(el('replay-time').textContent).toBe('1.00s / 5.00s');expect(host.textContent).toContain('场景 1：4.00s 完成 · 2.0 KB')
 expect(host.textContent).toContain('预览按点击后的时间计时');expect(h.compile.mock.calls[0][0].props.playback.trigger).toBe('auto')
 expect(b.props.playback.trigger).toBe('tap');expect(h.seek).toHaveBeenCalledWith('first',1)
 click(host.querySelector('[data-close]')!);expect(close).toHaveBeenCalledOnce()
})
it('advances by controlled frame deltas, pauses, resumes at half speed and stops at the end',()=>{
 mount();frame(1000);expect(el('replay-time').textContent).toBe('1.00s / 5.00s')
 click(el('replay-toggle'));expect(raf.size).toBe(0);frame(1000);expect(el('replay-time').textContent).toBe('1.00s / 5.00s')
 click(byText('0.5x'));click(el('replay-toggle'));frame(2000);expect(el('replay-time').textContent).toBe('2.00s / 5.00s')
 frame(10000);expect(el('replay-time').textContent).toBe('5.00s / 5.00s');expect(el('replay-toggle').textContent).toContain('播放');expect(raf.size).toBe(0)
 click(el('replay-toggle'));expect(el('replay-time').textContent).toBe('0.00s / 5.00s');expect(raf.size).toBe(1)
})
it('loops the preview cycle and explicit replay restores the configured start',()=>{
 h.compile.mockImplementation(()=>output({scenes:[{total:5,end:2,cycle:3,bytes:0}]}))
 const b=block();b.props.playback={...b.props.playback,start:1};mount(b)
 frame(2500);expect(el('replay-time').textContent).toBe('0.50s / 3.00s');expect(raf.size).toBe(1)
 click(byText('↺ 重播'));expect(el('replay-time').textContent).toBe('1.00s / 3.00s')
})
it('seeks through the test adapter with clamping and removes the adapter on unmount',()=>{
 mount();const w=window as unknown as {__replaySeek?:(t:number)=>void}
 act(()=>w.__replaySeek!(99));expect(el('replay-time').textContent).toBe('5.00s / 5.00s');expect(raf.size).toBe(0)
 act(()=>w.__replaySeek!(-10));expect(el('replay-time').textContent).toBe('0.00s / 5.00s')
 act(()=>root.render(null));expect(w.__replaySeek).toBeUndefined();expect(raf.size).toBe(0)
})
it('updates the visible cursor layer request and shows distinct warning/error descriptions',()=>{
 h.compile.mockImplementation(()=>output({warnings:['合成警告'],errors:['合成错误']}));mount()
 const initial=el<HTMLInputElement>('replay-cursors').checked;click(el('replay-cursors'))
 expect(h.compile.mock.calls.at(-1)![2]).toBe(!initial)
 expect(host.querySelector('.replay-issues .error')?.textContent).toContain('REPLAY_ERROR 合成错误')
 expect(host.querySelectorAll('.replay-issues p')).toHaveLength(2)
})
it('opens only an existing replay block from events and closes the host dialog',()=>{
 const b=block();h.blocks=[createBlock('paragraph'),b];act(()=>root.render(createElement(ReplayHost)))
 const open=(id:string)=>act(()=>window.dispatchEvent(new CustomEvent('open-replay',{detail:{id}})))
 open('missing');expect(host.querySelector('[role="dialog"]')).toBeNull()
 open(h.blocks[0].id);expect(host.querySelector('[role="dialog"]')).toBeNull()
 open(b.id);expect(host.querySelector('[role="dialog"]')).not.toBeNull();click(host.querySelector('[data-close]')!);expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('pauses when the visible slider seeks and keeps each scene on the same preview time',()=>{
 h.compile.mockImplementation(()=>output({html:'<svg data-root="first"></svg><svg data-root="second"></svg>',scenes:[{total:5,end:4,bytes:0},{total:3,end:2,bytes:0}]}));mount()
 const slider=el<HTMLInputElement>('replay-seek')
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'2.5');slider.dispatchEvent(new Event('input',{bubbles:true}))})
 expect(el('replay-time').textContent).toBe('2.50s / 5.00s');expect(el('replay-toggle').textContent).toContain('播放');expect(raf.size).toBe(0)
 expect(h.seek).toHaveBeenCalledWith('first',2.5);expect(h.seek).toHaveBeenCalledWith('second',2.5)
})
it('applies separate final timestamps to independent top-level scene roots',()=>{
 h.compile.mockImplementation(()=>output({html:'<svg data-root="first"></svg><svg data-root="second"></svg>'}));h.finals.mockReturnValue([2,4])
 act(()=>root.render(createElement(ReplayCanvasBody,{block:block()})))
 expect(h.seek.mock.calls).toEqual([['first',2],['second',4]])
})
