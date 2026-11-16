import { readFileSync, existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'

it.each(['light', 'dark'])('uses a blue selection outline without layout changes through the actual %s stylesheet cascade', mode => {
  const dom = new JSDOM(`<html data-color-mode="${mode}"><head></head><body><div class="canvas-wrap"><div class="article"><div class="block selected editing" data-block-id="fixture">测试<div class="block-html"><div class="block selected" data-block-id="author">正文</div></div></div></div></div></body></html>`)
  try {
    const main = readFileSync('src/main.tsx', 'utf8')
    for (const match of main.matchAll(/import ['"]\.\/(.*?\.css)['"]/g)) {
      const path = `src/${match[1]}`
      expect(existsSync(path)).toBe(true)
      const style = dom.window.document.createElement('style')
      style.textContent = readFileSync(path, 'utf8')
      dom.window.document.head.append(style)
    }
    const block = dom.window.document.querySelector('.block')!
    const style = dom.window.getComputedStyle(block)
    expect(style.outlineStyle).toBe('solid')
    expect(dom.window.getComputedStyle(dom.window.document.querySelector('[data-block-id=author]')!).outlineColor).not.toBe(style.outlineColor)
    expect(style.outlineWidth).toBe('2px')
    expect(style.outlineColor).toBe(mode === 'dark' ? 'rgb(96, 165, 250)' : 'rgb(37, 99, 235)')
    block.classList.remove('selected')
    expect(dom.window.getComputedStyle(block).borderWidth).toBe(style.borderWidth)
  } finally { dom.window.close() }
})
