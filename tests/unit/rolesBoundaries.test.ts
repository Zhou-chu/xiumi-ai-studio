import { describe, expect, it, vi, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBlock } from '../../src/core/blocks'
import { guessRole, guessTemplateRoles, isRoleId, roleDef, roleFromLabel, roleName, rolesForPhotos, rolesPresent, ROLES } from '../../src/core/roles'
const parse=(s:string)=>new JSDOM(s).window.document
const html=(s:string,label='')=>createBlock('html',{html:s,label})
const img=(style='')=>`<img src="https://example.com/p.jpg" style="${style}">`
const body='这是一段超过四十个汉字的正文内容，负责验证图文组合能否正确识别为容器或者图文分栏，而不是误认为短小的图注。'
const guess=(s:string)=>guessRole(html(s),{parse})
afterEach(()=>vi.unstubAllGlobals())
describe('role inference boundary coverage',()=>{
 it('provides role metadata, validation and all documented label hints',()=>{
  expect(isRoleId(null)).toBe(false);expect(isRoleId('bad')).toBe(false);expect(isRoleId('cover')).toBe(true)
  expect(roleDef('bad' as any).id).toBe('other');expect(roleName(undefined)).toBeTruthy();expect(roleName('')).toBeTruthy();expect(roleName('cover')).toBe(roleDef('cover').name)
  for(const r of ROLES)expect(roleFromLabel(r.name+' extra')).toBe(r.id)
  for(const [label,role] of [['自选四宫格','img4'],['测试三图并排','img3row'],['测试一大二小','img3big'],['测试双图上下','img2tb'],['测试不对称','img2big'],['测试双图','img2lr'],['测试文本框','container'],['测试分隔','divider'],['测试署名','ending'],['测试封面','cover']] as const)expect(roleFromLabel(label)).toBe(role)
  expect(roleFromLabel('unrecognized')).toBeUndefined();expect(rolesPresent([{role:'other'},{role:'body'}])).toEqual(new Set(['body']))
  expect(rolesForPhotos(5)).toContain('multi');expect(rolesForPhotos(0)).toContain('img1')
 })
 it.each([[2,'feature','img2big'],[2,'grid','img2lr'],[3,'feature','img3big'],[3,'grid','img3row'],[4,'grid','img4']] as const)('maps %i builtin photos with %s layout', (count,layout,role)=>expect(guessRole(createBlock('photos',{count,layout} as any))).toBe(role))
 it('maps builtin types and explicit label overrides',()=>{
  for(const type of ['cover','heading','paragraph','card','quote','imageText','image','frame','gallery','carousel','box','timeline','table','divider','ending','profile'] as const)expect(isRoleId(guessRole(createBlock(type)))).toBe(true)
  expect(guessRole(createBlock('paragraph'),{label:'封面'})).toBe('cover')
  expect(guessRole({type:'unknown',props:{}} as any)).toBe('other')
 })
 it('uses default browser DOMParser when no parse option supplied',()=>{
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser)
  expect(guessRole(html('<p style="font-size:20px">标题文本</p>'))).toBe('h2')
  expect(guessTemplateRoles([])).toEqual([])
 })
 it('distinguishes text, quote, credits and decoration',()=>{
  expect(guess('<section></section>')).toBe('divider')
  expect(guess(`<p>${body}</p>`)).toBe('body')
  expect(guess(`<section style="background:#eee"><p>${body}</p></section>`)).toBe('container')
  expect(guess('<p>“这是一段引用中的文字内容，来自于某位老师的发言。”——老师</p>')).toBe('quote')
  expect(guess('<p>文字：作者</p>')).toBe('ending')
  expect(guess('<p>主持：张三</p><p>策展：李四</p>')).toBe('ending')
  expect(guess('<p>01</p>')).toBe('h1')
 })
 it('distinguishes image-text blocks, grids, rows and asymmetric widths',()=>{
  expect(guess(img()+`<p>${body}</p>`)).toBe('imageText')
  expect(guess(`<section style="border:1px solid #000">${img()}<p>${body}</p></section>`)).toBe('container')
  expect(guess(img()+img()+`<p>${body}</p>`)).toBe('container')
  expect(guess(img().repeat(4))).toBe('img4');expect(guess(img().repeat(5))).toBe('multi')
  expect(guess(img('width:320px')+img('width:160px'))).toBe('img2big')
  expect(guess(`<section style="display:inline-block">${img()}</section><section style="display:inline-block">${img()}</section>`)).toBe('img2lr')
  expect(guess(`<section style="display:flex;flex-direction:column">${img('width:800px')}${img('width:800px')}</section>`)).toBe('img2tb')
  expect(guess(`<section style="overflow:hidden">${img()}${img()}</section>`)).toBe('img2tb')
  expect(guess(`<section style="overflow:auto">${img()}${img()}</section>`)).toBe('carousel')
 })
 it('promotes unnamed template headings while respecting explicit names and trailing photos',()=>{
  const title=()=>html('<p style="font-size:20px">章节</p>')
  const cover=createBlock('cover')
  expect(guessTemplateRoles([cover,title(),title()],{parse})).toEqual(['cover','h1','h1'])
  expect(guessTemplateRoles([cover,title(),html('<p style="font-size:20px">章节</p>','二级标题')],{parse})).toEqual(['cover','h1','h2'])
  expect(guessTemplateRoles([createBlock('divider'),createBlock('profile'),cover,createBlock('paragraph')],{parse})).toEqual(['topDecor','topDecor','cover','ending'])
  expect(guessTemplateRoles([cover,createBlock('paragraph'),createBlock('paragraph'),createBlock('image')],{parse}).at(-1)).toBe('img1')
  expect(guessTemplateRoles([createBlock('paragraph'),title()],{parse})).toEqual(['body','h1'])
  expect(guessTemplateRoles([html('<p style="font-size:24px">这是文章封面标题</p>'),title()],{parse})[0]).toBe('cover')
  expect(guessTemplateRoles([cover,title(),html('<p style="font-size:20px;padding:10px;margin:10px;border:1px solid #000;background:#eee">另一节</p>')],{parse})[2]).toBe('h2')
 })
})
