import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { compileDoc } from '../core/compiler'
import { findBlock } from '../core/tree'
import { buildReviewDisplay, reviewInsertionAnchor } from './reviewDisplay'
import { getProposalItemIssue, previewProposal, rebaseProposalOp } from './proposalSafety'
import { PhonePreview } from './Toolbar'
import { useStore, type Proposal } from './store'
import fontFaces from '../theme/fonts/fonts.css?inline'
import './inline-review.css'

const unresolved = (status: string) => status === 'pending' || status === 'stale'
const stopKeys = (event: React.KeyboardEvent) => {
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation() }
}
/** Sandbox renders the complete compiled block, not a summary. No editing or scripts. */
function SuggestionFrame({ html, index }: { html: string; index: number }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)
  const cleanup = useRef<() => void>(() => {})
  const source = useMemo(() => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"><style>${fontFaces}\nhtml,body{margin:0;padding:0;background:#fff;overflow:hidden}body{display:flow-root}img,video{max-width:100%}a{pointer-events:none}</style></head><body>${html}</body></html>`, [html])
  const loaded = () => {
    cleanup.current()
    const frame = ref.current
    const body = frame?.contentDocument?.body
    if (!frame || !body) return
    let alive = true
    const measure = () => {
      if (!alive) return
      const next = Math.max(40, Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)))
      setHeight(old => old === next ? old : next)
    }
    let scheduled = 0
    const schedule = () => { if (alive && !scheduled) scheduled = window.setTimeout(() => { scheduled = 0; measure() }, 0) }
    const Observer = (frame.contentWindow as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver
    const resize = new Observer(schedule)
    resize.observe(body)
    body.addEventListener('load', schedule, true)
    void frame.contentDocument?.fonts.ready.then(schedule)
    measure()
    cleanup.current = () => { alive = false; clearTimeout(scheduled); resize.disconnect(); body.removeEventListener('load', schedule, true) }
  }
  useEffect(() => () => cleanup.current(), [])
  return <iframe ref={ref} title={`第 ${index + 1} 条完整修改建议`} data-testid={`review-suggestion-${index}`} sandbox="allow-same-origin" tabIndex={-1} className="review-suggestion-frame" style={{ height }} srcDoc={source} onLoad={loaded} />
}
function ReviewItem({ index, proposal, inBox = false, missing = false }: { index: number; proposal: Proposal; inBox?: boolean; missing?: boolean }) {
  const doc = useStore(s => s.doc)
  const item = proposal.items[index]
  const display = useMemo(() => buildReviewDisplay(proposal, doc, index, inBox), [proposal, doc, index, inBox])
  const { resolveProposal } = useStore.getState()
  const label = { update: '修改建议', remove: '删除建议', insert: '新增模块', move: '移动建议', setMeta: '文章信息建议', setTheme: '全文主题建议' }[item.op.op]
  const resolve = (status: 'accepted' | 'rejected') => {
    resolveProposal(index, status, proposal)
    requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>('[data-review-ui] [data-testid="accept-review"]:not(:disabled),[data-review-ui] [data-testid="reject-review"]:not(:disabled)')
      ;(next ?? document.querySelector<HTMLButtonElement>('[data-testid="review-open"]'))?.focus()
    })
  }
  return <section className="review-suggested" data-testid={`review-item-${index}`} data-review-index={index} aria-label={`${label} ${index + 1}`}>
    <header className="review-suggestion-header"><b className="review-label">{label} · {index + 1}/{proposal.items.length}</b>
      <div className="review-chat" data-testid="review-bubble" aria-label="接受或拒绝此建议">
        <button className="review-accept" data-testid="accept-review" disabled={!display.applicable || missing} onClick={() => resolve('accepted')}>接受</button>
        <button className="review-reject" data-testid="reject-review" disabled={item.status !== 'pending'} onClick={() => resolve('rejected')}>拒绝</button>
      </div>
    </header>
    {missing && <p className="review-proposal-note" role="status">原位置已不存在。以下是当时的建议记录，不能直接接受。</p>}
    {display.issue && <p className="review-proposal-note review-invalid" role="status">{display.issue}。此预览仅供核对，请重新生成建议。</p>}
    {item.op.reason && <p className="review-proposal-note">{item.op.reason}</p>}
    {item.op.op === 'move' && <p className="review-proposal-note">将此完整模块移动到第 {item.op.to + 1} 位；下方不是新增副本。</p>}
    {item.op.op === 'setTheme' && <p className="review-proposal-note">下方为全文样式预览，不表示删除原文。</p>}
    {display.html ? <div className="review-preview-surface"><SuggestionFrame html={display.html} index={index} /></div> : <p className="review-proposal-note">{item.op.op === 'remove' ? '接受后将删除上方标红的完整模块，不添加替代内容。' : '无法安全生成此建议的完整预览。'}</p>}
  </section>
}
/** Stable wrapper keeps the real editable block mounted throughout review. */
export function ReviewBlock({ blockId, children, inBox = false }: { blockId: string; children: ReactNode; inBox?: boolean }) {
  const proposal = useStore(s => s.proposal)
  const doc = useStore(s => s.doc)
  const parent = findBlock(doc.blocks, blockId)?.parent
  const parentCovered = parent && proposal?.items.some(item => unresolved(item.status) && 'id' in item.op && item.op.id === parent.id)
  const ownCovered = proposal?.items.some(item => unresolved(item.status) && 'id' in item.op && item.op.id === blockId)
  // Do not insert child suggestion frames inside a parent module's red original.
  const indices = parentCovered ? [] : proposal?.items.flatMap((item, i) => {
    if (!unresolved(item.status) || !('id' in item.op)) return []
    return item.op.id === blockId || (ownCovered && findBlock(doc.blocks, item.op.id)?.parent?.id === blockId) ? [i] : []
  }) ?? []
  const insertions = proposal && !inBox ? proposal.items.flatMap((item, i) => {
    if (!unresolved(item.status) || item.op.op !== 'insert' || getProposalItemIssue(proposal, doc, i)) return []
    const op = rebaseProposalOp(proposal, doc, i)
    return op.op === 'insert' && reviewInsertionAnchor(doc, op.index) === blockId ? [i] : []
  }) : []
  return <div className={`review-flow ${indices.length ? 'review-has-original' : 'review-idle'}`} data-review-ui="true" onKeyDown={event => { if ((event.target as Element).closest('.review-suggested')) stopKeys(event) }}>
    {proposal && insertions.map(i => <div key={i} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}><ReviewItem index={i} proposal={proposal} /></div>)}
    <div className="review-original" data-review-original={indices.length ? indices.join(',') : undefined} data-testid={indices.length ? `review-original-${indices[0]}` : undefined}>
      {indices.length > 0 && <div className="review-original-label">原模块 · 待{indices.some(i => proposal!.items[i].op.op === 'remove') ? '删除／修改' : '修改'}{indices.length > 1 ? ` · ${indices.length} 条独立建议（非合并预览）` : ''}</div>}
      {children}
    </div>
    {proposal && indices.map(i => <div key={i} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}><ReviewItem index={i} proposal={proposal} inBox={inBox || ('id' in proposal.items[i].op && !!findBlock(doc.blocks, (proposal.items[i].op as { id: string }).id)?.parent)} /></div>)}
  </div>
}
export function ReviewHeading({ children }: { children: ReactNode }) {
  const proposal = useStore(s => s.proposal)
  const indices = proposal?.items.flatMap((item, i) => unresolved(item.status) && (item.op.op === 'setMeta' || item.op.op === 'setTheme') ? [i] : []) ?? []
  return <div className={`review-flow ${indices.length ? 'review-has-original' : 'review-idle'}`} data-review-ui="true" onKeyDown={event => { if ((event.target as Element).closest('.review-suggested')) stopKeys(event) }}>
    <div className="review-original" data-review-original={indices.length ? indices.join(',') : undefined} data-testid={indices.length ? `review-original-${indices[0]}` : undefined}>{indices.length > 0 && <div className="review-original-label">当前文章信息／主题 · 非正文删除</div>}{children}</div>
    {proposal && indices.map(i => <div key={i} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}><ReviewItem index={i} proposal={proposal} /></div>)}
  </div>
}
export function ReviewDocumentEnd() {
  const proposal = useStore(s => s.proposal)
  const doc = useStore(s => s.doc)
  if (!proposal) return null
  const indices = proposal.items.flatMap((item, i) => {
    if (!unresolved(item.status)) return []
    if ('id' in item.op && !findBlock(doc.blocks, item.op.id)) return [i]
    if (item.op.op === 'insert') {
      if (getProposalItemIssue(proposal, doc, i)) return [i]
      const op = rebaseProposalOp(proposal, doc, i)
      if (op.op === 'insert' && !reviewInsertionAnchor(doc, op.index)) return [i]
    }
    return []
  })
  return <div className="review-flow" data-review-ui="true" onKeyDown={stopKeys} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>{indices.map(i => <ReviewItem key={i} index={i} proposal={proposal} missing={'id' in proposal.items[i].op && !findBlock(doc.blocks, (proposal.items[i].op as { id: string }).id)} />)}</div>
}
/** Only summary/batch controls live in the shell; every proposed module is already visible. */
export function InlineReview() {
  const proposal = useStore(s => s.proposal)
  const doc = useStore(s => s.doc)
  const [preview, setPreview] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (proposal) window.dispatchEvent(new CustomEvent('workspace-view', { detail: 'canvas' })) }, [proposal?.base]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      const menu = ref.current?.querySelector<HTMLDetailsElement>('details[open]')
      if (menu) { event.preventDefault(); event.stopImmediatePropagation(); menu.open = false; menu.querySelector('summary')?.focus() }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [])
  if (!proposal) return null
  const pending = proposal.items.filter(i => i.status === 'pending').length
  const { resolveProposal, clearProposal, notify } = useStore.getState()
  return <div ref={ref} className="review-summary-bar" data-review-ui="true" data-testid="proposal" role="region" aria-label="完整模块修改审阅" onKeyDown={stopKeys} onClick={e => e.stopPropagation()}>
    <span data-testid="review-count">待审 {pending}</span>
    <button data-testid="review-open" onClick={() => { window.dispatchEvent(new CustomEvent('workspace-view', { detail: 'canvas' })); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-review-ui] [data-review-index="${proposal.items.findIndex(item => unresolved(item.status))}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })) }}>定位建议</button>
    <details className="review-menu"><summary>批量与预览</summary><div className="review-batch-menu">
      <button onClick={() => { try { setPreview(compileDoc(previewProposal(proposal, doc)).html) } catch { notify('部分建议已变化，请逐条检查。', 'error') } }}>预览效果</button>
      <button disabled={!pending} onClick={() => resolveProposal('all', 'rejected', proposal)}>全部拒绝</button>
      <button data-testid="accept-all" disabled={!pending} onClick={() => resolveProposal('all', 'accepted', proposal)}>全部接受（{pending}）</button>
      {proposal.errors.map((error, i) => <p key={i}>{error}</p>)}
    </div></details>
    <button aria-label="结束修改审阅" onClick={clearProposal}>结束</button>
    {proposal.errors.length > 0 && <span>已忽略 {proposal.errors.length} 条无效操作</span>}
    {preview && <PhonePreview html={preview} title="AI 修改预览（未应用）" onClose={() => setPreview(null)} />}
  </div>
}
