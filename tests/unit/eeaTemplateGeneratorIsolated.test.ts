import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
const h=vi.hoisted(()=>({write:vi.fn(),fetch:vi.fn(()=>{throw Error('Unexpected template resource request')})}))
vi.mock('node:fs',()=>({writeFileSync:h.write}))
let html:string,dom:JSDOM,doc:Document
const ids=['m1','m2a','m2b','m2c','m2d','m2e','m3','m4','m5a','m5b','m6a','m6b','m7','m8','m9']
beforeAll(async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{})
  vi.stubGlobal('fetch',h.fetch)
  try {
    // The unchanged JS module has no declaration file; its only outputs are intercepted.
    // @ts-expect-error untyped deterministic template generator
    await import('../../templates/eea-germany/build.mjs')
    expect(h.write).toHaveBeenCalledTimes(1)
    const [path,content]=h.write.mock.calls[0]
    expect(basename(path)).toBe('eea-germany-template.html');expect(typeof content).toBe('string')
    html=content
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/15 modules\)$/))
    dom=new JSDOM(html);doc=dom.window.document // scripts/resources intentionally NOT enabled
  }finally{log.mockRestore()}
})
afterAll(()=>{try{dom?.window.close();expect(h.fetch).not.toHaveBeenCalled()}finally{vi.unstubAllGlobals()}})
const stage=(id:string)=>doc.querySelector<HTMLElement>('#'+id+' > .stage')!
it('preserves the committed deterministic template bytes without writing a file',()=>{
  expect(createHash('sha256').update(html).digest('hex')).toBe('c4a8fd87dcf7138f254d92b47d4745ddd63709d99715005bb86c2e1fb5f6cbf2')
})
it('generates the full ordered module catalogue and matches every navigation destination and copy action',()=>{
  expect(doc.documentElement.lang).toBe('zh-CN')
  expect(doc.querySelector('meta[name=referrer]')?.getAttribute('content')).toBe('no-referrer')
  expect([...doc.querySelectorAll('#article > .demo')].map(n=>n.id)).toEqual(ids)
  expect([...doc.querySelectorAll('.toc a')].map(n=>n.getAttribute('href'))).toEqual(ids.map(id=>'#'+id))
  for(const id of ids){
    const demo=doc.getElementById(id)!
    expect(demo.getAttribute('data-name')).toBeTruthy();expect(demo.querySelectorAll(':scope > .stage')).toHaveLength(1)
    expect(demo.querySelectorAll(':scope > .rail > button.copy')).toHaveLength(1)
    expect(stage(id).children.length).toBeGreaterThan(0)
  }
})
it('keeps copied stages self-contained with inline styles and no controls, scripts or SVG ID dependencies',()=>{
  for(const id of ids){
    const body=stage(id)
    expect(body.querySelector('script,style,button,link,defs,pattern,linearGradient,radialGradient,[id],[class]')).toBeNull()
    for(const node of body.querySelectorAll('[style]'))expect(node.getAttribute('style')).not.toMatch(/position\s*:\s*absolute|display\s*:\s*grid|url\(\s*#/i)
    for(const node of body.querySelectorAll('[href],[xlink\\:href]'))expect(node.getAttribute('href')??node.getAttribute('xlink:href')).not.toMatch(/^#/)
  }
})
it('retains each photo arrangement, caption and prescribed source dimensions',()=>{
  const dimensions:Record<string,[number,number][]>={m3:[[800,600],[800,600]],m4:[[1080,720]],m5a:[[960,720],[960,720]],m5b:[[800,1000],[600,800]],m6a:[[1280,720],[960,720],[960,720]],m6b:[[1000,1396],[960,640],[960,640]],m7:Array(4).fill([960,720]),m8:Array(5).fill([1080,720])}
  for(const [id,sizes] of Object.entries(dimensions)){
    const images=[...stage(id).querySelectorAll('img')]
    expect(images).toHaveLength(sizes.length)
    images.forEach((img,i)=>{
      const url=new URL(img.src);expect(url.hostname).toBe('images.unsplash.com')
      expect([Number(url.searchParams.get('w')),Number(url.searchParams.get('h'))]).toEqual(sizes[i])
      expect(img.alt).toContain('建议');expect(img.style.width).toBe('100%');expect(img.style.height).toBe('auto')
    })
    expect(stage(id).textContent).toMatch(/图｜|左｜|光伏电站/)
  }
})
it('preserves editorial content, self-sizing nested notes and a five-card horizontal track',()=>{
  expect(stage('m1').textContent).toContain('从二校门到勃兰登堡门')
  expect(stage('m2a').textContent).toContain('走进慕尼黑：工业 4.0 现场课')
  expect(stage('m3').textContent).toContain('能源转型不是某一项技术的胜利')
  expect((stage('m3').firstElementChild as HTMLElement).style.height).toBe('auto')
  const track=[...stage('m8').querySelectorAll<HTMLElement>('section')].find(n=>n.style.overflowX==='scroll')!
  expect(track).toBeTruthy();expect(track.children).toHaveLength(5)
  expect([...track.children].map(n=>(n as HTMLElement).style.width)).toEqual(Array(5).fill('85%'))
  expect(stage('m9').textContent).toContain('带队教师');expect(stage('m9').textContent).toContain('埃尔朗根')
})
it('produces finite standalone SVG geometry and explicit repeatable animation declarations',()=>{
  const svgs=doc.querySelectorAll('.stage svg');expect(svgs.length).toBeGreaterThan(20)
  for(const svg of svgs){
    const vb=svg.getAttribute('viewBox')!.split(' ').map(Number)
    expect(vb).toHaveLength(4);expect(vb.every(Number.isFinite)).toBe(true);expect(vb[2]).toBeGreaterThan(0);expect(vb[3]).toBeGreaterThan(0)
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity|undefined/)
  }
  const animations=doc.querySelectorAll('.stage animate,.stage animateTransform');expect(animations.length).toBeGreaterThan(5)
  for(const animation of animations){expect(animation.getAttribute('repeatCount')).toBe('indefinite');expect(animation.getAttribute('dur')).toMatch(/^\d+(\.\d+)?s$/)}
})
it('emits but does not execute clipboard script, and retains explicit compatibility caveats',()=>{
  expect(doc.querySelectorAll('script')).toHaveLength(1)
  expect(doc.querySelector('script')!.textContent).toContain("demo.querySelector('.stage').innerHTML.trim()")
  expect(doc.querySelector('script')!.textContent).toContain("'text/html': new Blob([html]")
  expect(doc.getElementById('copy-all')?.textContent).toContain('复制整篇')
  expect(doc.getElementById('toast')?.textContent).toBe('')
  expect(doc.querySelector('.note')?.textContent).toContain('尚未在公众号后台实测')
  expect(html).toContain('@media (max-width: 900px)')
})
