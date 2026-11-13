import { describe, expect, it } from 'vitest'
import { normalizeOutline, parseArticle, sectionTables } from '../../src/core/outline'
describe('outline normalization and parsing boundaries',()=>{
 it('falls back for absent, empty and malformed sections',()=>{
  const fallback=parseArticle('# 标题\n\n## 章节\n\n这是正文。')
  for(const raw of [null,{}, {sections:[]},{sections:[null,{}, {heading:2}]}])expect(normalizeOutline(raw,fallback)).toBe(fallback)
 })
 it('normalizes malformed nested entries and retains valid table and people data',()=>{
  const fallback=parseArticle('# 标题\n\n## 章节\n\n这是正文。')
  const out=normalizeOutline({title:'',kicker:'',subtitle:2,meta:[],intro:[' intro ',false,''],highlights:['1','2','3','4','5',''],ending:{text:'',author:'',note:''},sections:[{heading:' section ',paragraphs:[' yes ',null,''],quotes:[null,{text:''},{text:' quote ',source:4}],timeline:[null,{title:''},{title:' step ',time:'09:00',desc:2}],people:[null,{name:''},{name:' Name ',role:2,bio:'bio'}],imageRefs:[' image ',null,''],table:{headers:[1,null],rows:[[2],false]},additionalTables:[null,{}, {headers:['A'],rows:[['B']]}]}]},fallback)
  expect(out.title).toBe(fallback.title);expect(out.kicker).toBe(fallback.kicker);expect(out.intro).toEqual(['intro']);expect(out.highlights).toHaveLength(4);expect(out.ending).toEqual(fallback.ending)
  expect(out.sections[0]).toMatchObject({heading:'section',paragraphs:['yes'],quotes:[{text:'quote',source:''}],timeline:[{title:'step',time:'09:00',desc:''}],people:[{name:'Name',role:'',bio:'bio'}],imageRefs:['image']})
  expect(sectionTables(out.sections[0])).toEqual([{headers:['1','null'],rows:[['2'],[]]},{headers:['A'],rows:[['B']]}])
  expect(normalizeOutline({sections:[{heading:'Only'}]},fallback).sections[0].paragraphs).toEqual([])
 })
 it('extracts plain heading numbering, quotes, time entries and credits',()=>{
  const o=parseArticle('文章标题\n这是一段很长的开篇文字，应该作为引言保存。\n1. 章节标题\n“这是一个没有署名的直接引用内容。”\n张老师说：“这是一段足够长的发言内容，需要保留原文同时提取引用。”\n09:00 开场\n10:00 演讲，嘉宾介绍\n文字：编辑部')
  expect(o.sections[0].heading).toBe('章节标题');expect(o.sections[0].quotes).toHaveLength(2);expect(o.sections[0].timeline).toHaveLength(2);expect(o.ending.author).toContain('编辑部')
 })
 it('rolls a single timeline item back into prose with and without description',()=>{
  for(const line of ['09:00 开场','09:00 开场，说明']){
   const o=parseArticle('标题\n一、章节\n'+line);expect(o.sections[0].timeline).toEqual([]);expect(o.sections[0].paragraphs[0]).toContain('09:00 开场')
  }
  expect(parseArticle('').title).toBeTruthy()
 })
 it('parses plain tables before and after headings, skips separators and keeps long numbered prose',()=>{
  const o=parseArticle('标题\n|A|B|\n|---|---|\n|1|2|\n2. 第二章节\n|C|D|\n|3|4|\n1. '+ '这是很长的正文内容，'.repeat(6))
  expect(o.sections[0].table?.rows).toEqual([['1','2']]);expect(o.sections[1].table?.headers).toEqual(['C','D']);expect(o.sections[1].paragraphs).toHaveLength(1)
 })
 it('handles markdown without H1, images and blockquotes before sections, lists and multiple tables',()=>{
  const a=parseArticle('![](https://example.com/a.jpg)');expect(a.title).toBeTruthy();expect(a.sections[0].imageRefs).toEqual(['https://example.com/a.jpg'])
  const b=parseArticle('前言标题\n\n![图](https://example.com/a.jpg) accompanying text\n\n> 引用无署名\n\n## 章节\n\n- 第一条\n- 第二条\n\n| A | B |\n|---|---|\n|1|2|\n\n| C |\n|---|\n|3|\n\n---')
  expect(b.title).toBe('前言标题');expect(b.sections[0].quotes[0].source).toBe('');expect(b.sections[1].paragraphs).toEqual(['第一条','第二条']);expect(sectionTables(b.sections[1])).toHaveLength(2)
  const c=parseArticle('# 标题\n\n> 引用 -- 作者\n\n## 空章节\n\n## 正文\n\n文本内容。');expect(c.sections[0].quotes[0].source).toBe('作者');expect(c.sections.some(s=>s.heading==='空章节')).toBe(false)
 })
})
