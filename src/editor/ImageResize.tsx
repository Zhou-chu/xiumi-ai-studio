import { useEffect, useRef, useState } from 'react'
import { clampImageWidth, resizePhoto } from '../core/imageResize'
import { findBlock } from '../core/tree'
import type { Block } from '../core/types'
import { useStore } from './store'
import './ImageResize.css'

/** Editor-only sibling of the article; drag previews never enter history or output. */
export function ImageResize() {
  const selected = useStore((s) => s.selectedId)
  const doc = useStore((s) => s.doc)
  const editing = useStore((s) => s.editingId || s.pickingId)
  const [target, setTarget] = useState<{ blockId: string; index: number } | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [width, setWidth] = useState(100)
  const handle = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ img: HTMLImageElement; original: string | null; block: Block; parentWidth: number; startX: number; startWidth: number; percent: number; pointer: number; docId: string } | null>(null)
  const image = () => target ? Array.from(document.querySelectorAll<HTMLElement>('.article [data-block-id]')).find((b) => b.dataset.blockId === target.blockId)?.querySelectorAll<HTMLImageElement>('.block-html img')[target.index] : null
  const cancel = () => {
    const d = drag.current
    if (d) { if (d.original === null) d.img.removeAttribute('style'); else d.img.setAttribute('style', d.original); drag.current = null }
  }
  useEffect(() => {
    const pick = (e: MouseEvent) => {
      const img = (e.target as Element).closest?.('.article .block-html img[data-photo]') as HTMLImageElement | null
      if (img) {
        const block = img.closest<HTMLElement>('[data-block-id]')!
        const imgs = Array.from(block.querySelectorAll('.block-html img'))
        setTarget({ blockId: block.dataset.blockId!, index: imgs.indexOf(img) })
      } else if (!(e.target as Element).closest?.('.image-resize-overlay')) { cancel(); setTarget(null) }
    }
    document.addEventListener('click', pick, true)
    return () => { document.removeEventListener('click', pick, true); cancel() }
  }, [])
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const img = image()
      if (!img || selected !== target?.blockId || editing) { cancel(); setRect(null) }
      else {
        const r = img.getBoundingClientRect()
        const parent = img.parentElement!.getBoundingClientRect()
        const scroll = img.closest('.canvas-scroll')!.getBoundingClientRect()
        const visible = r.bottom > scroll.top && r.top < scroll.bottom ? r : null
        setRect((old) => old?.left === visible?.left && old?.top === visible?.top && old?.width === visible?.width && old?.height === visible?.height ? old : visible)
        if (!drag.current) setWidth(clampImageWidth(r.width / parent.width * 100))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); cancel() }
  }, [target, selected, editing, doc]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (percent: number, expected: Block, docId: string) => {
    const s = useStore.getState()
    if (!target || s.doc.id !== docId || findBlock(s.doc.blocks, target.blockId)?.block !== expected) {
      s.notify('图片所在模块已变化，请重新选择后调整')
      return
    }
    s.commit(resizePhoto(s.doc, target, percent))
  }
  if (!rect || !target || selected !== target.blockId || editing) return null
  return <div className="image-resize-overlay" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} data-testid="image-resize-overlay" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <span className="image-resize-label" aria-live="polite">{width}% · 拖动缩放</span>
    <button ref={handle} className="image-resize-handle" aria-label="调整图片大小" title="拖动等比缩放；方向键调整，Shift加速，Esc取消" data-testid="image-resize-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        const img = image()
        const s = useStore.getState()
        const block = findBlock(s.doc.blocks, target.blockId)?.block
        if (!img || !block) return
        const r = img.getBoundingClientRect()
        const parentWidth = img.parentElement!.getBoundingClientRect().width
        if (!parentWidth) return
        drag.current = { img, original: img.getAttribute('style'), block, docId: s.doc.id, parentWidth, startX: e.clientX, startWidth: r.width, percent: width, pointer: e.pointerId }
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.pointer !== e.pointerId) return
        d.percent = clampImageWidth((d.startWidth + e.clientX - d.startX) / d.parentWidth * 100)
        d.img.style.width = `${d.percent}%`; d.img.style.maxWidth = '100%'; d.img.style.height = 'auto'
        setWidth(d.percent)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d || d.pointer !== e.pointerId) return
        const p = d.percent; cancel()
        if (Math.abs(p - d.startWidth / d.parentWidth * 100) > 0.05) commit(p, d.block, d.docId)
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); cancel(); setTarget(null); return }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const s = useStore.getState(); const block = findBlock(s.doc.blocks, target.blockId)?.block
        if (!block) return
        const step = e.shiftKey ? 10 : 1
        commit(e.key === 'Home' ? 10 : e.key === 'End' ? 100 : width + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : -step), block, s.doc.id)
      }}>↘</button>
  </div>
}
