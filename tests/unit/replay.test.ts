// 编辑回放：光标、渲染、审核和导出的组合行为
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { paceTable } from '../../src/core/replay/pace'
import { renderScene } from '../../src/core/replay/render'
import {
  defaultReplay,
  makeItem,
  makeScene,
  normalizeReplay,
  planCursors,
  renderReplay,
  replayFinalTimes,
  sampleReplay,
  scheduleScene,
  type ReplayDoc,
} from '../../src/core/replay'
import { THEMES } from '../../src/core/themes'
import type { Doc } from '../../src/core/types'

const parse = (svg: string) => new JSDOM(`<body>${svg}</body>`).window.document
const scene0 = (doc: ReplayDoc, i = 0) => renderScene(doc.scenes[i], doc, { idsAllowed: doc.playback.trigger === 'tap', sid: 'rp0', warn: () => {} })

describe('光标分配', () => {
  const doc = sampleReplay()
  const checkPlan = (d: ReplayDoc, si: number) => {
    const tl = scheduleScene(d.scenes[si], d)
    const plan = planCursors(tl, d, d.scenes[si])
    const lead = paceTable(d.playback.pace).lead
    const seen = new Set<number>()
    for (const tr of plan.tracks) {
      let free = -Infinity
      for (const s of tr.stops) {
        // 同一光标的任务不重叠：上一个任务完成后才出发，且到达早于元素开始
        expect(s.depart).toBeGreaterThanOrEqual(free - 1e-6)
        expect(s.arrive).toBeGreaterThanOrEqual(s.depart)
        const ti = tl.items.find((x) => x.index === s.item)!
        expect(s.arrive).toBeCloseTo(ti.tStart - lead, 3)
        expect(s.act).toBe(ti.tStart)
        expect(seen.has(s.item)).toBe(false)
        seen.add(s.item)
        free = s.free
      }
    }
    return { tl, plan, seen }
  }
  it('示例模板：每个元素都分到光标，且没有冲突', () => {
    for (const si of [0, 1]) {
      const { tl, plan, seen } = checkPlan(doc, si)
      expect(plan.unassigned).toEqual([])
      expect(seen.size).toBe(tl.items.length)
    }
  })
  it('轮流分配：三个光标都参与', () => {
    const { plan } = checkPlan(doc, 0)
    expect(plan.tracks.filter((t) => t.stops.length > 0)).toHaveLength(3)
  })
  it('光标不够时元素照常排期，只是没有光标演示', () => {
    const d = structuredClone(doc)
    d.cursors.count = 1
    d.playback.pace = 'turbo'
    const { tl, plan } = checkPlan(d, 0)
    expect(plan.unassigned.length).toBeGreaterThan(0)
    expect(tl).toEqual(scheduleScene(doc.scenes[0], { ...doc, playback: { ...doc.playback, pace: 'turbo' } }))
  })
  it('收尾 swarm：所有出场的光标聚到焦点，绕圈（旋转 + 反向旋转保持朝向）后散开', () => {
    const out = scene0(doc, 1)
    expect(out.plan.swarm).not.toBeNull()
    expect(out.plan.swarm!.members).toHaveLength(3)
    expect(out.plan.swarm!.t).toBeGreaterThanOrEqual(out.end)
    expect(out.svg).toContain('type="rotate" begin="0s" dur=')
    expect(out.svg).toMatch(/values="0;0;360"/)
    expect(out.svg).toMatch(/values="0;0;-360"/)
    expect(scene0(doc, 0).plan.swarm).toBeNull()
  })
  it('指定光标在空闲时生效；action=none 不派光标', () => {
    const d = structuredClone(doc)
    d.scenes[0].items[0].cursor = { who: 2 }
    d.scenes[0].items[1].cursor = { action: 'none' }
    const { plan } = checkPlan(d, 0)
    expect(plan.tracks[2].stops[0].item).toBe(0)
    expect(plan.tracks.flatMap((t) => t.stops).some((s) => s.item === 1)).toBe(false)
  })
})

describe('与光标解耦', () => {
  it('元素层与光标无关：关掉光标层、改光标数量，元素输出完全一致', () => {
    const doc = sampleReplay()
    for (const si of [0, 1]) {
      const on = scene0(doc, si)
      const off = renderScene(doc.scenes[si], doc, { idsAllowed: false, sid: 'rp0', warn: () => {}, showCursors: false })
      const more = renderScene(doc.scenes[si], { ...doc, cursors: { ...doc.cursors, count: 6 } }, { idsAllowed: false, sid: 'rp0', warn: () => {} })
      expect(off.itemLayer).toBe(on.itemLayer)
      expect(more.itemLayer).toBe(on.itemLayer)
      expect(off.svg.length).toBeLessThan(on.svg.length)
      // 光标层在最上面（元素层之后的最后一层）
      expect(on.svg).toContain(`<g>${on.itemLayer}</g><g>`)
      expect(on.svg.endsWith('</g></svg>')).toBe(true)
      expect(off.svg.endsWith(`<g>${off.itemLayer}</g></svg>`)).toBe(true)
    }
  })
})

describe('schema', () => {

  it('作为文档模块加载时经过 schema 校验', () => {
    const [b] = normalizeBlocks([{ id: 'r1', type: 'replay', props: { scenes: [{ items: [{ type: 'stat', content: 42 }] }] } }])
    expect(b.type).toBe('replay')
    expect((b.props as ReplayDoc).scenes[0].items[0].content).toBe('42')
  })
})

describe('SMIL 输出', () => {

  it('变换动画不会覆盖所在元素的静态 transform（除非静态值就是动画终值）', () => {
    const doc = sampleReplay()
    doc.textMode = 'svg-text'
    for (const si of [0, 1]) {
      const d = parse(scene0(doc, si).svg)
      for (const a of d.querySelectorAll('animateTransform')) {
        const fixed = a.parentElement!.getAttribute('transform')
        if (!fixed) continue
        const last = a.getAttribute('values')!.split(';').pop()
        expect(fixed, `场景 ${si + 1}`).toBe(`${a.getAttribute('type')}(${last})`)
      }
    }
  })
  it('循环模式下一个场景的所有动画共用同一个周期', () => {
    const d = sampleReplay()
    d.playback.loop = { hold: 2 }
    const out = scene0(d)
    const durs = new Set([...out.svg.matchAll(/<(?:animate|animateTransform)\b[^>]*dur="([^"]+)"/g)].map((m) => m[1]))
    expect([...durs]).toEqual([`${out.cycle}s`])
  })
})

describe('wechat-svg-lint', () => {
  it('示例模板三种播放方式都零错误，只使用允许的标签', () => {
    const allowed = new Set(['svg', 'g', 'rect', 'path', 'circle', 'text', 'tspan', 'image', 'animate', 'animatetransform', 'set', 'defs', 'lineargradient', 'stop'])
    for (const patch of [{}, { loop: { hold: 2 } }, { trigger: 'tap' as const }]) {
      const d = sampleReplay()
      d.playback = { ...d.playback, ...patch }
      const r = renderReplay(d)
      expect(r.errors).toEqual([])
      const tags = new Set([...r.html.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1].toLowerCase()))
      tags.delete('section')
      for (const t of tags) expect(allowed.has(t)).toBe(true)
      if (!patch.trigger) {
        expect(r.html).not.toMatch(/\sid=|url\(#|\.click/)
      }
    }
  })

  it('超出体积预算时警告', () => {
    const d = sampleReplay()
    d.budget = { sceneKB: 5, totalKB: 10 }
    const r = renderReplay(d)
    expect(r.warnings.some((w) => w.includes('单场景预算'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('整体'))).toBe(true)
  })
  it('接入编译器：本机图片导出时报错，映射成微信地址后通过', () => {
    const d = sampleReplay()
    d.scenes[1].items[2].image = { src: '/media/abc.jpg', width: 1200, height: 800 }
    const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: normalizeBlocks([{ id: 'r', type: 'replay', props: d }]), createdAt: 0, updatedAt: 0 }
    expect(compileDoc(doc).warnings.some((w) => w.startsWith('编辑回放 ✕'))).toBe(true)
    const ok = compileDoc(doc, { mapImage: (u) => (u.startsWith('/media/') ? 'https://mmbiz.qpic.cn/mmbiz_jpg/x/0' : u) })
    expect(ok.warnings.some((w) => w.startsWith('编辑回放 ✕'))).toBe(false)
    expect(ok.html).toContain('href="https://mmbiz.qpic.cn/mmbiz_jpg/x/0"')
  })
})

describe('动画被过滤时退化为静态成稿', () => {
  /** 去掉全部动画后，没有被 opacity=0 隐藏的文字 */
  const visibleTexts = (svg: string) => {
    const d = parse(svg)
    d.querySelectorAll('animate, animateTransform, set').forEach((n) => n.remove())
    return [...d.querySelectorAll('text')].filter((t) => !t.closest('[opacity="0"]')).map((t) => t.textContent)
  }
  it('所有文案仍然可见，辅助图形（线框、尺寸标签、光标、过程数字）都隐藏', () => {
    const doc = sampleReplay()
    doc.textMode = 'svg-text'
    const out = scene0(doc)
    const texts = visibleTexts(out.svg).join('|')
    for (const it of doc.scenes[0].items) for (const line of [it.content, it.label ?? '']) for (const ch of line.replace(/\s/g, '').slice(0, 4)) expect(texts).toContain(ch)
    expect(texts).not.toMatch(/\d+ × \d+/)
    expect(texts).not.toContain('Ada')
    // 数字跳动只剩最终值
    expect(visibleTexts(out.svg).filter((t) => t === '12' || t === '48' || t === '3.6s')).toHaveLength(3)
  })
})

describe('画布定格时间', () => {
  it('等光标离场或 swarm 散开之后再定格，画面里不留光标', () => {
    const doc = sampleReplay()
    const finals = replayFinalTimes(doc)
    doc.scenes.forEach((_, i) => {
      const out = scene0(doc, i)
      expect(finals[i]).toBeGreaterThanOrEqual(out.plan.end)
      expect(finals[i]).toBeGreaterThanOrEqual(out.end)
    })
  })
})

describe('逐字打字的正文与关键词', () => {
  const body = () => {
    const d = defaultReplay()
    d.cursors.show = false
    d.textMode = 'svg-text'
    d.canvas.background = { type: 'color', value: '#ffffff' }
    d.scenes = [
      {
        ...makeScene([
          makeItem('text', { content: '第一段，讲**手感**为什么会消失，以及它和归属感的关系。', enter: 'type-on' }),
          makeItem('text', { content: '第二段，讲**难度**被一句话抹平之后，成就感去了哪里。', enter: 'type-on' }),
        ]),
        overlap: 1,
        padding: 24,
      },
    ]
    return d
  }

  it('开始时间让整段时间轴整体后移（多个回放接力）', () => {
    const d = body()
    const base = scheduleScene(d.scenes[0], d)
    d.playback.start = 12
    const later = scheduleScene(d.scenes[0], d)
    later.items.forEach((x, i) => expect(x.tStart).toBeCloseTo(base.items[i].tStart + 12, 3))
    const s = sampleReplay()
    s.playback.start = 5
    const plan = planCursors(scheduleScene(s.scenes[0], s), s, s.scenes[0])
    for (const tr of plan.tracks) if (tr.spawn) expect(tr.spawn.t).toBeGreaterThanOrEqual(5 - 0.5)
  })

  it('**关键词** 去掉标记，加粗变色，打字经过时划出荧光笔底纹并保留', () => {
    const d = body()
    const out = scene0(d)
    expect(out.svg).not.toContain('**')
    expect(out.svg).toContain(`<tspan font-weight="bold" fill="${d.theme.accent}">手感</tspan>`)
    const doc = parse(out.svg)
    const markers = [...doc.querySelectorAll('rect[fill-opacity="0.22"]')]
    expect(markers).toHaveLength(2)
    // 终态保留底纹，动画从 0 宽开始
    for (const m of markers) {
      expect(Number(m.getAttribute('width'))).toBeGreaterThan(20)
      expect(m.querySelector('animate')!.getAttribute('values')!.startsWith('0;0;')).toBe(true)
    }
    expect(renderReplay(d).errors).toEqual([])
  })
})

describe('导出给秀米', () => {
  it('编辑回放的文字改用 SVG 文字，不含内嵌图片（秀米会把内嵌图片丢掉，文字变空白）', async () => {
    const { setReplayEnv } = await import('../../src/core/replay')
    setReplayEnv({ rasterize: () => 'data:image/png;base64,AAAA' })
    try {
      const d = sampleReplay()
      const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: normalizeBlocks([{ id: 'r', type: 'replay', props: d }]), createdAt: 0, updatedAt: 0 }
      expect(compileDoc(doc).html).toContain('data:image/png')
      const xiumi = compileDoc(doc, { replaySvgText: true }).html
      expect(xiumi).not.toContain('data:image')
      expect(xiumi).toContain('>一篇推文，是这样被写')
    } finally {
      setReplayEnv({ rasterize: null })
    }
  })
})

describe('渐变背景上打字', () => {
  it('遮挡块按背景色带切段，每段颜色都和所在色带一致（不露暗边）', () => {
    const d = sampleReplay()
    d.textMode = 'svg-text'
    const svg = scene0(d).svg
    const doc = parse(svg)
    const bandColors = new Set([...doc.querySelectorAll('svg > rect')].map((r) => r.getAttribute('fill')))
    // 打字遮挡：有 x、width 两个动画的矩形
    const covers = [...doc.querySelectorAll('rect')].filter((r) => r.querySelector('animate[attributeName="x"]') && r.querySelector('animate[attributeName="width"]'))
    expect(covers.length).toBeGreaterThan(2)
    for (const c of covers) expect(bandColors.has(c.getAttribute('fill'))).toBe(true)
  })
})

describe('开始阅读统一触发、重播与特殊字体', () => {
  it('外部触发：动画挂在开始按钮上，不画自己的点击层，↻ 用负偏移从本模块开始时间重播', () => {
    const d = sampleReplay()
    d.textMode = 'svg-text'
    d.playback = { ...d.playback, trigger: 'tap', triggerId: 'tlgo', replay: true, start: 12 }
    const svg = renderScene(d.scenes[0], d, { idsAllowed: true, sid: 'rp0', warn: () => {} }).svg
    expect(svg).toContain('begin="tlgo.click;rp0r.click-12s"')
    expect(svg).toContain('<g id="rp0r">')
    expect(svg).not.toContain('end="rp0.click"')
    expect(svg).not.toContain('点击开始回放')
  })

  it('字形齐全时标题画成路径，缺字时回退为文字', () => {
    const d = defaultReplay()
    d.textMode = 'svg-text'
    d.glyphs = { zc: { 空: { d: 'M0 0L500 -700L1000 0Z', adv: 1000 }, 虚: { d: 'M0 0L1000 -700Z', adv: 1000 } } }
    d.scenes = [makeScene([makeItem('title', { content: '空虚', style: { face: 'zc' } }), makeItem('title', { content: '空白', style: { face: 'zc' } })])]
    const svg = scene0(d).svg
    expect(svg).toContain('d="M0 0L500 -700L1000 0Z"')
    expect(svg).toContain('>空白</text>')
    expect(normalizeReplay(d).glyphs?.zc['空'].adv).toBe(1000)
    expect(normalizeReplay({ ...d, glyphs: { zc: { 坏: { d: '<script>', adv: 1 } } } }).glyphs).toBeUndefined()
  })
})
