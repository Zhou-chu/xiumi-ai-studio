import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { compileDoc } from '../core/compiler'
import { describeOp } from '../core/ops'
import { extractSlots, readSlotNodes } from '../core/slots'
import { findBlock } from '../core/tree'
import { getProposalItemIssue, previewProposal } from './proposalSafety'
import { groupReviewMarkers, placeReviewBubble, selectReviewAnchor, reviewHeading, type ReviewPoint, type ReviewRect } from './inlineReviewGeometry'
import { PhonePreview } from './Toolbar'
import { useStore } from './store'
import './inline-review.css'

type Anchor = ReviewPoint & { rect: ReviewRect }
/** Review controls are siblings of the zoomed article, never part of its markup. */
export function InlineReview() {
  const proposal = useStore(s => s.proposal)
  const doc = useStore(s => s.doc)
  const [active, setActive] = useState<number | null>(null)
  const [activeSlot, setActiveSlot] = useState<string | null>(null)
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [clearance, setClearance] = useState(56)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [bubbleSize, setBubbleSize] = useState({ width: 310, height: 260 })
  const [preview, setPreview] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const targets = useRef(new Map<number, { element: Element; range?: Range; ranges?: Map<string, Range> }>())
  const { resolveProposal, clearProposal, notify } = useStore.getState()
  const measure = useCallback(() => {
    const shell = root.current?.parentElement
    const scroll = shell?.querySelector('.canvas-scroll')
    if (!shell || !scroll || !proposal) return
    const bounds = shell.getBoundingClientRect()
    const visible = scroll.getBoundingClientRect()
    const bar = root.current?.querySelector('.review-bar')?.getBoundingClientRect()
    const reserved = bar ? Math.ceil(bar.bottom - bounds.top + 8) : 56
    setClearance(reserved)
    setArea(old => old.width === bounds.width && old.height === bounds.height ? old : { width: bounds.width, height: bounds.height })
    targets.current.clear()
    const next: Anchor[] = []
    if (!bounds.width || !bounds.height || !shell.getClientRects().length) { setAnchors([]); return }
    proposal.items.forEach((item, index) => {
      if (item.status === 'accepted' || item.status === 'rejected') return
      const op = item.op
      const id = 'id' in op ? op.id : op.op === 'insert' ? doc.blocks[Math.min(op.index, doc.blocks.length - 1)]?.id : undefined
      const target = id ? shell.querySelector(`[data-block-id="${CSS.escape(id)}"]`) : shell.querySelector('.phone-head')
      if (!target) return
      targets.current.set(index, { element: target })
      let rects: Array<{ rect: DOMRect; slot?: string }> = []
      if (op.op === 'update' && op.slots && !getProposalItemIssue(proposal, doc, index)) {
        const block = findBlock(doc.blocks, op.id)?.block
        const html = target.querySelector(':scope > .block-html')
        if (block?.type === 'html' && html) {
          const nodes = readSlotNodes(html)
          const stored = extractSlots(block.props.html)
          // Scan correspondence, not a text search: repeated strings stay distinct.
          const matches = stored.length === nodes.length && stored.every((s, i) => s.kind === nodes[i].slot.kind && s.id === nodes[i].slot.id && (s.kind !== 'text' || (nodes[i].slot.kind === 'text' && s.text === nodes[i].slot.text)))
          if (matches) for (const slot of Object.keys(op.slots)) {
            const node = nodes.find(n => n.slot.id === slot && n.slot.kind === 'text')?.node
            if (!node) continue
            const range = document.createRange(); range.selectNodeContents(node)
            const measured = targets.current.get(index)!
            measured.range ??= range
            measured.ranges ??= new Map()
            measured.ranges.set(slot, range)
            const parts = [...range.getClientRects()]
            const rect = parts.find(r => r.bottom > visible.top + reserved && r.top < visible.bottom) ?? parts[0]
            if (rect) rects.push({ rect, slot })
          }
        }
      }
      if (!rects.length) rects = [{ rect: target.getBoundingClientRect() }]
      for (const { rect, slot } of rects) {
        if (!rect.width || rect.bottom < Math.max(visible.top, bounds.top) + reserved || rect.top > Math.min(visible.bottom, bounds.bottom) - 8 || rect.right < visible.left || rect.left > visible.right) continue
        const y = Math.max(reserved, rect.top - bounds.top)
        const x = Math.max(8, Math.min(bounds.width - 34, rect.right - bounds.left + 4))
        next.push({ index, slot, x, y, rect: { left: rect.left - bounds.left, right: rect.right - bounds.left, top: y, bottom: Math.min(bounds.height - 8, rect.bottom - bounds.top) } })
      }
    })
    setAnchors(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
  }, [proposal, doc])
  useLayoutEffect(() => {
    if (!proposal) return
    const shell = root.current?.parentElement
    if (!shell) return
    let frame = 0
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(shell)
    const bar = root.current?.querySelector('.review-bar')
    if (bar) resize.observe(bar)
    const phone = shell.querySelector('.phone')
    const mutations = new MutationObserver(schedule)
    if (phone) { resize.observe(phone); mutations.observe(phone, { attributes: true, childList: true, subtree: true, characterData: true }) }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    shell.addEventListener('load', schedule, true)
    document.fonts?.addEventListener('loadingdone', schedule)
    schedule()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); shell.removeEventListener('load', schedule, true); document.fonts?.removeEventListener('loadingdone', schedule) }
  }, [proposal, measure])
  useEffect(() => {
    setActive(null)
    if (proposal) window.dispatchEvent(new CustomEvent('workspace-view', { detail: 'canvas' }))
  }, [proposal?.base]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!bubble.current) return
    const ro = new ResizeObserver(entries => {
      const el = entries[0].target as HTMLElement
      setBubbleSize(old => old.width === el.offsetWidth && old.height === el.offsetHeight ? old : { width: el.offsetWidth, height: el.offsetHeight })
    })
    ro.observe(bubble.current)
    return () => ro.disconnect()
  }, [active, anchors.length])
  const focusOpen = () => root.current?.querySelector<HTMLButtonElement>('[data-testid="review-open"]')?.focus()
  const dismiss = () => { setActive(null); focusOpen() }
  useEffect(() => {
    if (!proposal) return
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      const menu = root.current?.querySelector<HTMLDetailsElement>('.review-menu[open]')
      if (menu) {
        e.preventDefault(); e.stopImmediatePropagation(); menu.open = false
        menu.querySelector<HTMLElement>('summary')?.focus()
        return
      }
      if (active !== null) { e.preventDefault(); e.stopImmediatePropagation(); dismiss() }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [active, proposal?.base]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!proposal) return null
  const pending = proposal.items.filter(i => i.status === 'pending')
  const groups = groupReviewMarkers(anchors)
  const open = (index: number, focusBubble = true, slot: string | null = null) => {
    window.dispatchEvent(new CustomEvent('workspace-view', { detail: 'canvas' }))
    setActive(index)
    setActiveSlot(slot)
    const target = targets.current.get(index)
    const scroll = root.current?.parentElement?.querySelector('.canvas-scroll')
    if (target && scroll) {
      const range = (slot ? target.ranges?.get(slot) : undefined) ?? target.range
      const rect = range ? [...range.getClientRects()][0] ?? range.getBoundingClientRect() : target.element.getBoundingClientRect()
      const viewport = scroll.getBoundingClientRect()
      const desired = Math.max(clearance + 16, (viewport.height - Math.min(rect.height, viewport.height)) / 2)
      scroll.scrollTo({ top: scroll.scrollTop + rect.top - viewport.top - desired, left: scroll.scrollLeft, behavior: 'instant' })
    } else if (!target) notify(getProposalItemIssue(proposal, doc, index) || '目标已不在当前文稿中，请重新生成建议。', 'error')
    requestAnimationFrame(() => { measure(); if (focusBubble) requestAnimationFrame(() => bubble.current?.focus()) })
  }
  const next = (direction: number) => {
    const indices = proposal.items.flatMap((p, i) => p.status === 'pending' || p.status === 'stale' ? [i] : [])
    if (!indices.length) { dismiss(); return }
    const at = active === null ? -1 : indices.indexOf(active)
    open(indices[(at + direction + indices.length) % indices.length])
  }
  const resolve = (status: 'accepted' | 'rejected') => {
    if (active === null) return
    resolveProposal(active, status, proposal)
    const updated = useStore.getState().proposal
    const following = updated?.items.findIndex((it, i) => i > active && it.status === 'pending') ?? -1
    const first = updated?.items.findIndex(it => it.status === 'pending') ?? -1
    if (following >= 0 || first >= 0) open(following >= 0 ? following : first)
    else dismiss()
  }
  const anchor = selectReviewAnchor(anchors, active, activeSlot)
  const item = active === null ? null : proposal.items[active]
  const issue = active === null ? null : getProposalItemIssue(proposal, doc, active)
  const missing = active !== null && !!item && (item.status === 'pending' || item.status === 'stale') && !targets.current.has(active)
  const description = item ? describeOp(proposal.base, item.op) : null
  let before = description?.before ?? ''
  let after = description?.after ?? ''
  if (item?.op.op === 'update' && item.op.slots) {
    const block = findBlock(proposal.base.blocks, item.op.id)?.block
    if (block?.type === 'html') {
      const slots = extractSlots(block.props.html)
      before = Object.keys(item.op.slots).map(id => { const s = slots.find(s => s.id === id); return s?.kind === 'text' ? s.text : '' }).join('\n\n')
      after = Object.values(item.op.slots).join('\n\n')
    }
  }
  const size = { width: Math.min(330, Math.max(0, area.width - 16)), height: Math.min(bubbleSize.height, Math.max(0, area.height - clearance - 16)) }
  const position = anchor ? placeReviewBubble(anchor.rect, area, size) : { left: 8, top: clearance }
  position.top = Math.max(clearance, position.top)
  return <div ref={root} className="inline-review" data-testid="proposal" role="region" aria-label="文中 AI 修改审阅" onKeyDown={e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation() } }} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    <div className="review-bar">
      <span className="review-summary" title={proposal.summary}>{proposal.summary}</span>
      <span data-testid="review-count">待审 {pending.length}</span>
      <button data-testid="review-open" onClick={() => next(1)}>定位建议</button>
      <details className="review-menu"><summary>批量与预览</summary><div>
        <button onClick={() => { try { setPreview(compileDoc(previewProposal(proposal, doc)).html) } catch { notify('部分建议已过期，请逐条检查。', 'error') } }}>预览效果</button>
        <button onClick={() => resolveProposal('all', 'rejected', proposal)} disabled={!pending.length}>全部拒绝</button>
        <button data-testid="accept-all" onClick={() => resolveProposal('all', 'accepted', proposal)} disabled={!pending.length}>全部接受（{pending.length}）</button>
        {proposal.errors.length > 0 && <div className="review-errors" role="status"><b>已忽略 {proposal.errors.length} 条无效操作</b>{proposal.errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
      </div></details>
      <button onClick={clearProposal} aria-label="结束修改审阅">结束</button>
      {proposal.errors.length > 0 && <span title={proposal.errors.join('；')}>无效 {proposal.errors.length}</span>}
    </div>
    {groups.map((group, n) => <button key={`${group.indices.join('-')}-${group.slot ?? n}`} className="review-marker" style={{ left: group.x, top: group.y }} data-testid={groups.findIndex(g => g.indices[0] === group.indices[0]) === n ? `review-marker-${group.indices[0]}` : undefined} data-review-indices={group.indices.join(',')} data-review-slot={group.slot} aria-label={`审阅第 ${group.indices.map(i => i + 1).join('、')} 条修改`} onClick={() => open(group.indices[0], true, group.slot ?? null)}>{group.indices.length > 1 ? `${group.indices[0] + 1}+${group.indices.length - 1}` : group.indices[0] + 1}</button>)}
    {item && (anchor || missing) && <div ref={bubble} className="review-bubble" data-testid="review-bubble" data-anchor-missing={missing || undefined} role="region" aria-label="修改详情" tabIndex={-1} style={{ ...position, width: size.width, maxHeight: Math.max(0, area.height - position.top - 8) }}>
      <header><b>{reviewHeading(item.op, active!, proposal.items.length)}</b><button data-testid="review-close" aria-label="收起修改详情" onClick={dismiss}>×</button></header>
      {missing && <p role="status" className="review-issue">原位置已不存在。以下为原建议记录，不代表当前文中位置；不能直接接受。</p>}
      {item.op.reason && <p className="review-reason">{item.op.reason}</p>}
      {before && <div className="review-diff"><b>修改前</b><p>{before}</p></div>}
      {after && <div className="review-diff"><b>修改后</b><p>{after}</p></div>}
      {issue && <p role="status" className="review-issue">{issue}</p>}
      <div className="review-actions"><button data-testid="review-prev" onClick={() => next(-1)}>上一条</button><button data-testid="review-next" onClick={() => next(1)}>下一条</button><button data-testid="reject-review" disabled={item.status !== 'pending'} onClick={() => resolve('rejected')}>拒绝</button><button data-testid="accept-review" disabled={item.status !== 'pending' || !!issue || missing} onClick={() => resolve('accepted')}>接受</button></div>
    </div>}
    {preview && <PhonePreview html={preview} title="AI 修改预览（未应用）" onClose={() => setPreview(null)} />}
  </div>
}
