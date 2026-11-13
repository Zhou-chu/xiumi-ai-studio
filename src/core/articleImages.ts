import type { Doc } from './types'
import type { Parse } from './slots'
import { findBlock } from './tree'

/** An explicit library intent is a local command, not a document patch or an LLM tool grant. */
export function isImageLibraryRequest(text: string): boolean {
  return text.split(/[，。；！？,;!?\n]/).some(clause => {
    const action = '(?:加入|添加|保存|导入|收集|存入|转存|放进)'
    const negative = new RegExp('(?:不要|(?<!分)别|无需|不需要|不能).{0,24}' + action)
    return !negative.test(clause) && /(?:图片|图像|原图|照片)/.test(clause) && /(?:素材库|图片库|图库)/.test(clause) && new RegExp(action).test(clause)
  })
}

export function collectArticleImages(doc: Doc, selectedId?: string, parse: Parse = (s) => new DOMParser().parseFromString(s, 'text/html')): string[] {
  const urls = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    let url = value.trim()
    if (url.startsWith('/api/wx-image?')) url = new URLSearchParams(url.split('?')[1]).get('u') ?? url
    if (url.startsWith('//')) url = `https:${url}`
    urls.add(url)
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const record = value as Record<string, unknown>
    add(record.src)
    if (typeof record.html === 'string') {
      const root = parse(record.html)
      root.querySelectorAll('img').forEach(el => add(el.getAttribute('data-src') || el.getAttribute('src')))
      root.querySelectorAll('image').forEach(el => add(el.getAttribute('href') || el.getAttribute('xlink:href')))
      root.querySelectorAll('[style]').forEach(el => {
        for (const m of (el.getAttribute('style') ?? '').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(m[2])
      })
    }
    Object.values(record).forEach(visit)
  }
  if (selectedId) visit(findBlock(doc.blocks, selectedId)?.block)
  else { visit(doc.cover); visit(doc.blocks) }
  return [...urls]
}
