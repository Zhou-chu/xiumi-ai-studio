// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { LinkedSvgScene } from '../../src/core/crossSvgPreview'
import { LinkedSvgCanvasBody, LinkedSvgFields } from '../../src/editor/LinkedSvgBlock'

it('edits only typed opacity values and uses an empty-permission canvas frame', () => {
  const box = { width: 100, height: 55, viewBox: [0, 0, 100, 55] as [number, number, number, number] }
  const rect = { width: 55, height: 35, x: 0, y: 0, fill: 'navy' }
  const scene: LinkedSvgScene = { timing: 3, target: 4, sourceBox: box, followerBox: box, sourceRect: rect, targetRect: rect, followerRect: rect }
  const host = document.createElement('div')
  const root = createRoot(host)
  const change = vi.fn()
  document.body.append(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  try {
    act(() => root.render(<><LinkedSvgFields scene={scene} onChange={change} /><LinkedSvgCanvasBody block={{ id: 'one', type: 'linkedSvg', props: { scene } }} /></>))
    const frame = host.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'")
    const edit = host.querySelector('select')!
    expect(edit.value).toBe('3')
    act(() => {
      edit.value = '7'
      edit.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(change).toHaveBeenCalledWith({ ...scene, timing: 7 }, 'timing')
    act(() => root.render(<><LinkedSvgFields scene={null} onChange={change} /><LinkedSvgCanvasBody block={{ id: 'invalid', type: 'linkedSvg', props: { scene: null } }} /></>))
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelectorAll('[role=status]')).toHaveLength(2)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
