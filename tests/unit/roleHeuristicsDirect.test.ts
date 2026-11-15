// @vitest-environment jsdom
import {expect,it} from 'vitest'
import {createBlock} from '../../src/core/blocks'
import {guessRole,guessTemplateRoles,roleName,roleDef,rolesForPhotos,type RoleId} from '../../src/core/roles'
const html=(s:string,label='')=>createBlock('html',{html:s,label})
const photo=(name:string,style='')=>`<img src="/media/${name}.jpg" style="${style}">`
it('provides robust labels and exact photo alternatives for empty or invalid metadata',()=>{
 expect(roleName(undefined)).toBe('未分类');expect(roleName('')).toBe('未分类');expect(roleName('h1')).toBe('一级标题');expect(roleDef('invalid' as RoleId).id).toBe('other')
 expect(rolesForPhotos(1)).toEqual(['img1','imageText']);expect(rolesForPhotos(3)).toEqual(['img3big','img3row','carousel']);expect(rolesForPhotos(6)).toEqual(['multi','carousel'])
})
it.each([[4,'even','img4'],[3,'feature','img3big'],[3,'even','img3row'],[2,'feature','img2big'],[2,'even','img2lr']] as const)('classifies builtin photo count/layout %s/%s', (count,layout,want)=>{
 expect(guessRole(createBlock('photos',{count,layout}))).toBe(want)
})
it('classifies unmapped replay explicitly as other rather than a guessed picture role',()=>{expect(guessRole(createBlock('replay'))).toBe('other')})
it.each([
 ['<div style="display:flex">'+photo('a')+photo('b')+'</div>','img2lr'],
 ['<div>'+photo('a','width:500px')+photo('b','width:200px')+'</div>','img2big'],
 ['<div>'+photo('a','display:inline-block')+photo('b','display:inline-block')+'</div>','img2lr'],
 ['<div style="display:flex;flex-direction:column">'+photo('a')+photo('b')+'</div>','img2tb'],
 ['<div>'+photo('a','width:33%')+photo('b','width:33%')+photo('c','width:33%')+'</div>','img3row'],
 ['<div>'+photo('a')+photo('b')+photo('c')+'</div>','img3big'],
 ['<div style="overflow-x:auto">'+photo('a')+photo('b')+'</div>','carousel'],
] as const)('uses actual inherited width and scroll geometry to distinguish photo layouts', (s,want)=>{expect(guessRole(html(s))).toBe(want)})
it('distinguishes long editorial copy with a picture from an actual decorated container',()=>{
 const text='这是一段保留语义与阅读顺序的实际中文正文。'.repeat(4)
 expect(guessRole(html(photo('a')+'<p>'+text+'</p>'))).toBe('imageText')
 expect(guessRole(html('<section style="background:#eee">'+photo('a')+'<p>'+text+'</p></section>'))).toBe('container')
 expect(guessRole(html(photo('a')+photo('b')+'<p>'+text+'</p>'))).toBe('container')
})
it('recognizes quotations without turning long prose or credits into headings',()=>{
 expect(guessRole(html('<p>“这是引文”——作者</p>'))).toBe('quote')
 expect(guessRole(html('<p>摄影：同学</p>'))).toBe('ending')
 expect(guessRole(html('<p>这是一段没有边框的正文说明。</p>'))).toBe('body')
 expect(guessRole(html('<section style="border:1px solid #999"><p>这是一段正文说明。</p></section>'))).toBe('container')
})
it('keeps explicit roles, identifies leading decoration, and limits unnamed tail inference',()=>{
 const blocks=[html('<hr>'),html('<h1 style="font-size:24px">科技文化活动专刊</h1>'),html('<h2 style="font-size:18px">章节甲</h2>'),html('<p>结尾说明</p>')]
 expect(guessTemplateRoles(blocks)).toEqual(['topDecor','cover','h1','ending'])
 blocks[0]=html('<hr>','分割装饰');blocks[3]=html('<h2 style="font-size:18px">末尾标题</h2>','二级标题')
 expect(guessTemplateRoles(blocks)[0]).toBe('divider');expect(guessTemplateRoles(blocks)[3]).toBe('h2')
})
it('promotes only unnamed matching short headings when an explicit cover already exists',()=>{
 const blocks=[createBlock('cover'),html('<h2 style="font-size:18px">甲乙</h2>'),html('<h2 style="font-size:18px">丙丁</h2>'),createBlock('image')]
 expect(guessTemplateRoles(blocks)).toEqual(['cover','h1','h1','img1'])
 const named=[createBlock('cover'),html('<h2 style="font-size:18px">甲乙</h2>','二级标题'),html('<h2 style="font-size:18px">丙丁</h2>'),createBlock('image')]
 expect(guessTemplateRoles(named)).toEqual(['cover','h2','h1','img1'])
})
