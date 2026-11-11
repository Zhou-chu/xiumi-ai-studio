// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CoverDesigner } from '../../src/editor/CoverDesigner'
import { api } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'

const hosts: HTMLElement[] = []
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const host of hosts.splice(0)) host.remove()
  vi.restoreAllMocks()
})

async function renderTitle(title: string) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(api, 'assets').mockResolvedValue([])
  const painted: string[] = []
  const ctx = {
    font: '', fillStyle: '',
    fillRect() { painted.length = 0 },
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s: string) => ({ width: s.length * Number(ctx.font.match(/(\d+)px/)?.[1] ?? 44) }),
    fillText: (s: string) => painted.push(s),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any)
  useStore.getState().load({ ...emptyDoc(), title })
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => { root.render(createElement(CoverDesigner, { onClose() {} })) })
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === '生成并设为封面')!
  return { painted, button, ctx }
}

it('blocks silently truncated cover generation and explains how to recover', async () => {
  const { button } = await renderTitle('长标题'.repeat(50) + 'XYZ987')
  expect(button.disabled).toBe(true)
  expect(document.body.textContent).toMatch(/标题.*过长|标题.*超出/)
  expect(document.body.textContent).toMatch(/缩短/)
})

it('fits a supported long title completely instead of dropping its final lines', async () => {
  const title = '完整长标题'.repeat(8)
  const { painted, button, ctx } = await renderTitle(title)
  expect(painted.join('')).toContain(title)
  expect(button.disabled).toBe(false)
  expect(Number(ctx.font.match(/(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
