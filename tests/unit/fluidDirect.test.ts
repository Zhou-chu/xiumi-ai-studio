// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fluidizeTree, fluidStyle, sourceColumn, type BoxMetrics } from '../../src/core/fluid'

const box = (m: Partial<BoxMetrics> = {}): BoxMetrics => ({ cbw: 600, width: 0, height: 0, parentHeight: 0, parentDefinite: false, ...m })

describe('像素尺寸换回百分比', () => {
  it('converts fractional pixels and keeps authored integers', () => {
    const out = fluidStyle('box-sizing: border-box; width: 108.5px; margin-left: 491.5px; margin-top: 51.1875px; padding: 12px 32px 18px 22px; border-radius: 10px; font-size: 16.27px', box())
    expect(out).toContain('width: 18.0833%')
    expect(out).toContain('margin-left: 81.9167%')
    expect(out).toContain('margin-top: 8.5313%')
    expect(out).toContain('padding: 12px 32px 18px 22px')
    expect(out).toContain('border-radius: 10px')
    expect(out).toContain('font-size: 16.27px')
  })
  it('treats a full-width or round-percentage integer width as converted', () => {
    expect(fluidStyle('width: 600px', box())).toBe('width: 100%')
    expect(fluidStyle('width: 300px', box())).toBe('width: 50%')
    expect(fluidStyle('width: 40px; height: 6px', box())).toBe('width: 40px; height: 6px')
    expect(fluidStyle('width: 260px', box({ cbw: 634.547 }))).toBe('width: 260px')
  })
  it('converts shorthand components one by one and negative margins', () => {
    expect(fluidStyle('margin: 10px 0px 24.6px -34.4062px', box())).toBe('margin: 10px 0px 4.1% -5.7344%')
  })
  it('turns a derived height into a percentage of a definite parent, otherwise into an aspect ratio', () => {
    expect(fluidStyle('height: 144.25px', box({ parentDefinite: true, parentHeight: 400 }))).toBe('height: 36.0625%')
    expect(fluidStyle('height: 144.25px', box({ parentDefinite: true, parentHeight: 144.25 }))).toBe('height: 100%')
    expect(fluidStyle('width: 108.5px; height: 144.25px', box({ width: 108.5, height: 144.25 }))).toBe('width: 18.0833%; aspect-ratio: 108.5 / 144.25')
    expect(fluidStyle('height: 52px', box({ parentDefinite: true, parentHeight: 400 }))).toBe('height: 52px')
  })
  it('leaves a style without derived pixels untouched', () => {
    const st = 'box-sizing: border-box; width: 100%; margin: 0px; font-size: 15px'
    expect(fluidStyle(st, box())).toBe(st)
  })
})

it('follows the dominant content through a wrapper and ignores a narrow navigation element', () => {
  const host = document.createElement('div')
  host.innerHTML = '<aside style="width: 180px">导航</aside><section><article style="width: 620px">' + '正文'.repeat(30) + '</article></section>'
  expect(sourceColumn(host)).toEqual({ el: host.querySelector('article'), width: 620 })
  host.innerHTML = '<aside style="width:180px">导航</aside><div>正文不限制像素宽度</div>'
  expect(sourceColumn(host)).toBeNull()
})

it('chooses the most common fixed width when content is spread over comparable sections', () => {
  const host = document.createElement('div')
  host.innerHTML = '<section style="width:600px">标题甲</section><section style="width:650px">标题乙</section><section style="width:600px">标题丙</section>'
  expect(sourceColumn(host)).toEqual({ el: host.firstElementChild, width: 600 })
})

it('transforms percent-like pixels from injected DOM geometry without rewriting SVG internals', () => {
  const host = document.createElement('div')
  host.style.padding = '0'
  host.innerHTML = '<section style="width: 300px"><p style="margin-left: 30.5px">正文</p></section><svg style="width: 300px"><rect style="width: 108.5px"></rect></svg>'
  document.body.append(host)
  try {
    const section = host.querySelector('section')!
    Object.defineProperty(host,'clientWidth',{ value:600 })
    Object.defineProperty(section,'clientWidth',{ value:300 })
    const updated = fluidizeTree(host)
    expect(updated).toBe(3)
    expect(section.getAttribute('style')).toBe('width: 50%')
    expect(section.firstElementChild?.getAttribute('style')).toBe('margin-left: 10.1667%')
    expect(host.querySelector('svg')?.getAttribute('style')).toBe('width: 50%')
    expect(host.querySelector('rect')?.getAttribute('style')).toBe('width: 108.5px')
  } finally { host.remove() }
})
