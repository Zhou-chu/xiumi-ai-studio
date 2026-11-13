import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../core/types'
import { collectArticleImages } from '../core/articleImages'
import { api } from './api'
import type { ArticleImageResult } from '../../server/articleImages'
import { Modal } from './Modal'
import { useStore } from './store'

/** Snapshot-only library operation: never patches the document, even if the user navigates away. */
export function ArticleImageImport({ doc, selectedId, onClose }: { doc: Doc; selectedId?: string | string[]; onClose: () => void }) {
  const [snapshot] = useState(doc)
  const [scopeId] = useState(selectedId)
  const [urls] = useState(() => collectArticleImages(doc, selectedId))
  const [chosen, setChosen] = useState(() => new Set(urls))
  const [results, setResults] = useState<ArticleImageResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelled = useRef(false)
  const running = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])
  const close = () => { cancelled.current = true; onClose() }
  const run = async () => {
    if (running.current) return
    if (useStore.getState().doc !== snapshot) { setError('文稿已变化，请关闭后重新收集图片。'); return }
    running.current = true; cancelled.current = false; setBusy(true); setError('')
    // One image per request provides visible progress and stops remaining downloads on dismissal.
    const done = new Set(results.filter(r => r.status !== 'failed').map(r => r.url))
    try {
      for (const url of chosen) {
        if (cancelled.current) break
        if (done.has(url)) continue
        let result: ArticleImageResult
        try {
          const response = await api.importArticleImages([url])
          result = response.find(r => r.url === url) ?? { url, status: 'failed', error: '服务器未确认结果，可重试核查' }
        } catch { result = { url, status: 'failed', error: '请求失败或结果未确认，可重试核查' } }
        if (result.status !== 'failed') window.dispatchEvent(new Event('assets-changed'))
        if (!cancelled.current) setResults(prev => [...prev.filter(r => r.url !== url), result])
      }
    } finally { running.current = false; if (!cancelled.current) setBusy(false) }
  }
  const imported = results.filter(r => r.status === 'imported').length
  const existing = results.filter(r => r.status === 'existing').length
  const failed = results.filter(r => r.status === 'failed').length
  return <Modal title="收集文中图片" onClose={close} width={640}>
    <p>{scopeId ? '仅选中模块' : '全文（含封面）'}：发现 {urls.length} 张不同图片。</p>
    <p className="hint">仅将图片加入本机素材库，不修改文稿，也不把图片发给 AI。其他文字或排版要求不会在这里执行，原指令仍保留。网络图片仅支持微信／秀米图床；已有本地素材不重复导入。</p>
    <p className="hint">关闭会停止剩余图片；正在下载的一张可能仍会入库，重试不会重复创建。</p>
    {urls.length === 0 ? <p role="status">当前范围没有可收集的图片，请检查选中模块或改为全文。</p> : <div style={{ maxHeight: '40vh', overflowY: 'auto', border: '1px solid var(--border)', padding: 12 }}>
      {urls.map((url, i) => {
        const result = results.find(r => r.url === url)
        return <div key={url} style={{ padding: '8px 0', overflowWrap: 'anywhere' }}>
          <label><input type="checkbox" checked={chosen.has(url)} disabled={busy || !!result && result.status !== 'failed'} onChange={e => setChosen(prev => { const next = new Set(prev); if (e.target.checked) next.add(url); else next.delete(url); return next })} /> 图片 {i + 1}</label>
          <details><summary>来源地址</summary><span>{url}</span></details>
          {result && <p className={result.status === 'failed' ? 'warn' : 'hint'}>{result.status === 'imported' ? '已加入素材库' : result.status === 'existing' ? '已在素材库' : result.error}</p>}
        </div>
      })}
    </div>}
    <p role="status" aria-live="polite">{busy ? '正在处理… ' : ''}新增 {imported} 张，已存在 {existing} 张，失败或未确认 {failed} 张。</p>
    {error && <p role="alert" className="warn">{error}</p>}
    <div className="modal-actions">
      <button onClick={close}>{busy ? '停止剩余并关闭' : '关闭'}</button>
      <button className="primary" onClick={run} disabled={busy || !chosen.size || results.length > 0 && chosen.size === imported + existing}>{busy ? '导入中…' : failed ? '重试失败图片' : '确认加入素材库'}</button>
    </div>
  </Modal>
}
