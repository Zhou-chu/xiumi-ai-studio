import { blockLabel } from '../core/blocks'
import { findBlock } from '../core/tree'
import { useSelectionScope } from './useSelectionScope'
import { ArticleImageImport } from './ArticleImageImport'
import { isImageLibraryRequest } from '../core/articleImages'
import { UiIcon } from './UiIcon'
import { Help } from './Help'
import { useEffect, useMemo, useRef, useState } from 'react'
import { variantUrl } from '../core/compiler'
import { QUICK_ACTIONS, aiContext } from '../core/quickActions'
import { analyzeStyle, themeFromReport, type StyleReport } from '../core/styleExtract'
import { getTheme, registerTheme, resolveTheme } from '../core/themes'
import type { Theme, ThemeTokens } from '../core/types'
import { api, type AiStatus } from './api'
import { CoverDesigner } from './CoverDesigner'
import { readSuggestionPreference, saveSuggestionPreference } from './suggestionPreference'
import { SuggestionInput } from './SuggestionInput'
import { instructionSuggestions } from './suggestionQueue'
import { PropsForm } from './PropsForm'
import { selectedBlock, useStore } from './store'

type Tab = 'style' | 'theme' | 'ai' | 'reference'

function DocSettings() {
  const doc = useStore((s) => s.doc)
  const set = useStore((s) => s.setDocFields)
  const [designing, setDesigning] = useState(false)
  return (
    <div className="props-form">
      <h4>文章信息</h4>
      <label className="field"><span>标题（≤64 字）</span><input value={doc.title} maxLength={64} onChange={(e) => set({ title: e.target.value }, 'title')} /></label>
      <label className="field"><span>作者（≤16 字）</span><input value={doc.author} maxLength={16} onChange={(e) => set({ author: e.target.value }, 'author')} /></label>
      <label className="field"><span>摘要（≤120 字）</span><textarea rows={3} maxLength={120} value={doc.digest} onChange={(e) => set({ digest: e.target.value }, 'digest')} /></label>
      <div className="field">
        <span>公众号封面（2.35:1）</span>
        {doc.cover ? <img className="cover-preview" src={variantUrl(doc.cover.src, '235:100', 600)} alt="" /> : <p className="hint">尚未设置</p>}
        <button onClick={() => setDesigning(true)}><span className="ui-legacy-icon" aria-hidden="true">🎨 </span><UiIcon name="cover" /> 设计封面</button>
      </div>
      <Help title="编辑模块">提示：点击画布中的模块即可编辑该模块；双击正文类模块可直接编辑文字。</Help>
      {designing && <CoverDesigner onClose={() => setDesigning(false)} />}
    </div>
  )
}

/** Saving a theme may outlive this panel or the document it was requested for. */
function useThemeSave() {
  const active = useRef(true)
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const save = async (theme: Theme) => {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    const expected = useStore.getState().doc
    const { commit, notify, refreshThemes } = useStore.getState()
    try {
      await api.saveTheme(theme)
      registerTheme(theme)
      refreshThemes()
      if (!active.current) return
      if (useStore.getState().doc !== expected) {
        notify('主题已保存，但文稿已变化，未应用到当前文稿。可从主题列表手动选择。', 'error')
        return
      }
      commit({ ...expected, themeId: theme.id, themeOverrides: undefined })
      notify(`主题已保存并应用「${theme.name}」`)
    } catch (error) {
      if (active.current) notify(error instanceof Error ? error.message : '主题保存失败，请重试', 'error')
    } finally {
      pending.current = false
      if (active.current) setSaving(false)
    }
  }
  return { save, saving }
}

function ThemePanel() {
  const doc = useStore((s) => s.doc)
  const themes = useStore((s) => s.themes)
  const { commit } = useStore.getState()
  const { save, saving } = useThemeSave()
  const theme = resolveTheme(doc)
  const setOverride = (patch: Partial<ThemeTokens>, key: string) => {
    const o = doc.themeOverrides ?? {}
    commit({ ...doc, themeOverrides: { ...o, ...patch, colors: { ...(o.colors ?? {}), ...(patch.colors ?? {}) } as any } }, `theme:${key}`)
  }
  const num = (label: string, key: keyof ThemeTokens, min: number, max: number, step = 1) => (
    <label className="field slider">
      <span>{label}<b>{String(theme[key])}</b></span>
      <input type="range" min={min} max={max} step={step} value={theme[key] as number} onChange={(e) => setOverride({ [key]: Number(e.target.value) } as any, key)} />
    </label>
  )
  const color = (label: string, key: keyof Theme['colors']) => (
    <label className="color-field">
      <input type="color" value={theme.colors[key]} onChange={(e) => setOverride({ colors: { [key]: e.target.value } as any }, `c-${key}`)} />
      <span>{label}</span>
    </label>
  )
  return (
    <div className="props-form">
      <h4>视觉主题 · 一键切换全文</h4>
      <div className="theme-grid">
        {themes.map((t) => (
          <button key={t.id} className={`theme-card ${doc.themeId === t.id ? 'on' : ''}`} onClick={() => commit({ ...doc, themeId: t.id, themeOverrides: undefined })} title={t.description} data-testid={`theme-${t.id}`}>
            <span className="swatch">
              {[t.colors.primary, t.colors.accent, t.colors.primarySoft].map((c) => <i key={c} style={{ background: c }} />)}
            </span>
            <b>{t.name}</b>
          </button>
        ))}
      </div>
      <button
        className="wide"
        title="把封面、标题、卡片、引言、分割的样式都改为“跟随主题”，切换主题时整体变化"
        onClick={() => commit({ ...doc, blocks: doc.blocks.map((b) => ('variant' in b.props && ['cover', 'heading', 'card', 'quote', 'divider'].includes(b.type) ? ({ ...b, props: { ...b.props, variant: 'auto' } } as typeof b) : b)) })}
      >
        全部模块样式跟随主题
      </button>
      <h4>微调{doc.themeOverrides && <button className="link" onClick={() => commit({ ...doc, themeOverrides: undefined })}>重置</button>}</h4>
      <div className="color-row">{color('主色', 'primary')}{color('强调', 'accent')}{color('浅底', 'primarySoft')}{color('正文', 'text')}{color('辅助', 'muted')}</div>
      {num('正文字号', 'fontSize', 13, 18)}
      {num('大标题字号', 'h1Size', 18, 32)}
      {num('小标题字号', 'h2Size', 15, 24)}
      {num('行距', 'lineHeight', 1.4, 2.4, 0.05)}
      {num('字间距', 'letterSpacing', 0, 2, 0.1)}
      {num('段落间距', 'paragraphSpacing', 6, 32)}
      {num('模块间距', 'blockSpacing', 12, 48)}
      {num('圆角', 'radius', 0, 20)}
      {num('图片圆角', 'imageRadius', 0, 20)}
      <button
        className="wide"
        disabled={saving}
        onClick={async () => {
          const name = prompt('保存为我的主题，名称：', `${getTheme(doc.themeId).name} · 自定义`)
          if (!name) return
          const t: Theme = { ...theme, id: `custom-${Date.now().toString(36)}`, name, description: '用户自定义主题' }
          await save(t)
        }}
      >
        保存为我的主题
      </button>
    </div>
  )
}

function AiPanel() {
  const selected = useStore(selectedBlock)
  const selectedIds = useStore(s => s.selectedIds)
  const selectionKey = JSON.stringify([...selectedIds].sort())
  const doc = useStore((s) => s.doc)
  const proposal = useStore((s) => s.proposal)
  const { scope, setScope } = useSelectionScope(doc.id, selectedIds)
  const { propose, notify } = useStore.getState()
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [instruction, setInstruction] = useState('')
  const [collectImages, setCollectImages] = useState(false)
  const imageCommand = isImageLibraryRequest(instruction)
  const [busy, setBusy] = useState(false)
  const [autoSuggest, setAutoSuggest] = useState(readSuggestionPreference)
  const [suggestion, setSuggestion] = useState({ key: '', text: '', error: '' })
  const selectedId = scope === 'selection' && selectedIds.length ? selectedIds.length === 1 ? selectedIds[0] : selectedIds : undefined
  // Strip image URLs and rich-text metadata, and send only selected content in selection mode.
  const context = useMemo(() => aiContext(doc, selectedId), [doc, selectedId])
  const contextKey = JSON.stringify([doc.id, context, selectedId, ai?.profileId, ai?.model, ai?.provider, instructionSuggestions.revision])
  useEffect(() => {
    if (!autoSuggest || !ai?.enabled || instruction || busy || !context.blocks.length) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      instructionSuggestions.get(contextKey, () => api.aiSuggestInstruction(context, ai.profileId, selectedId), controller.signal)
        .then((text) => { if (!controller.signal.aborted) setSuggestion({ key: contextKey, text, error: '' }) })
        .catch(() => { if (!controller.signal.aborted) setSuggestion({ key: contextKey, text: '', error: '自动建议暂不可用，可以直接输入修改要求。' }) })
    }, 1500)
    return () => { clearTimeout(timer); controller.abort() }
  }, [autoSuggest, ai, instruction, busy, context, contextKey, selectedId])
  useEffect(() => {
    const load = () => api.aiStatus().then(setAi).catch(() => setAi(null))
    load()
    window.addEventListener('ai-settings-changed', load)
    return () => window.removeEventListener('ai-settings-changed', load)
  }, [])
  const request = useRef(0)
  const requesting = useRef(false)
  useEffect(() => () => { request.current++; requesting.current = false }, [])
  // A pending response belongs to the selection/scope at submission, not the next one.
  useEffect(() => {
    request.current++
    if (requesting.current) {
      requesting.current = false
      setBusy(false)
      notify('选择范围已变化，旧请求结果将被忽略，请重新生成建议。', 'error')
    }
  }, [doc.id, selectionKey, scope, notify])
  const run = async () => {
    if (!instruction.trim() || requesting.current) return
    if (imageCommand) { setCollectImages(true); return }
    requesting.current = true
    const generation = ++request.current
    setBusy(true)
    try {
      const r = await api.aiEdit(aiContext(doc, selectedId), instruction, undefined, selectedId)
      if (generation !== request.current) return
      if (JSON.stringify([...useStore.getState().selectedIds].sort()) !== selectionKey) throw new Error('选择范围已变化，请重新生成建议')
      if (useStore.getState().doc !== doc) throw new Error('文档已在请求期间发生变化，请重新生成修改建议')
      propose(r.summary ?? 'AI 修改建议', Array.isArray(r.ops) ? r.ops : [], selectedId)
    } catch (e: any) {
      if (generation === request.current) notify(e.message, 'error')
    } finally {
      if (generation === request.current) { requesting.current = false; setBusy(false) }
    }
  }
  return (
    <div className="props-form">
      <h4>AI 设计助手</h4>
      <p className={`ai-status ${ai?.enabled ? 'on' : ''}`}>
        {ai?.enabled ? `当前模型：${ai.name} / ${ai.model}` : '尚未配置 AI 模型。以下规则动作可离线使用。'}{' '}
        <button className="link" onClick={() => window.dispatchEvent(new Event('open-ai-settings'))}>{ai?.enabled ? '切换' : '去配置'}</button>
      </p>
      <label className="field"><span>修改范围</span>
        <select data-testid="ai-edit-scope" value={scope} onChange={(e) => setScope(e.target.value as 'selection' | 'document')} disabled={busy}>
          {selectedIds.length > 0 && <option value="selection">{selectedIds.length > 1 ? `已选 ${selectedIds.length} 个模块` : `仅选中模块：${selected?.type}（${selected?.id}）`}</option>}
          <option value="document">全文</option>
        </select>
      </label>
      <p className="hint">{selected && scope === 'selection' ? `仅生成已选 ${selectedIds.length} 个模块的修改建议，其他模块不会被修改。` : '当前范围为全文；在画布点选一个模块后，可切换为仅修改选中模块。'}</p>
      <label className="hint"><input type="checkbox" checked={autoSuggest} onChange={(e) => { saveSuggestionPreference(e.target.checked); setAutoSuggest(e.target.checked) }} /> 自动生成输入建议</label>
      <p className="hint">开启后会将当前范围的文稿发送到当前模型，可能产生 API 费用；当前页面的建议请求间隔至少 30 秒。不发送图片文件。</p>
      <SuggestionInput value={instruction} onChange={setInstruction} disabled={busy} suggestion={autoSuggest && suggestion.key === contextKey ? suggestion.text : ''} />
      {autoSuggest && suggestion.key === contextKey && suggestion.error && <p className="hint" role="status">{suggestion.error}</p>}
      <button className="primary wide" data-testid={imageCommand ? 'ai-image-library-command' : undefined} disabled={(!ai?.enabled && !imageCommand) || busy} onClick={run}>{imageCommand ? '收集图片到素材库' : busy ? 'AI 思考中…' : '生成修改建议'}</button>
      <button disabled={busy} onClick={() => setCollectImages(true)} data-testid="collect-article-images">收集当前范围图片到素材库</button>
      {collectImages && <ArticleImageImport doc={doc} selectedId={selectedId} onClose={() => setCollectImages(false)} />}
      <h4>规则动作</h4>
      <div className="quick-grid">
        {QUICK_ACTIONS.map((a) => (
          <button key={a.id} onClick={() => { const r = a.run(doc); propose(r.summary, r.ops) }} data-testid={`qa-${a.id}`}>{a.label}</button>
        ))}
      </div>
      {proposal && <button className="wide" onClick={() => window.dispatchEvent(new CustomEvent('workspace-view', { detail: 'canvas' }))}>在文中审阅修改（{proposal.items.filter(i => i.status === 'pending').length}）</button>}
    </div>
  )
}

function ReferencePanel() {
  const [html, setHtml] = useState('')
  const [url, setUrl] = useState('')
  const [report, setReport] = useState<StyleReport | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const { notify } = useStore.getState()
  const { save, saving } = useThemeSave()
  const draft = useMemo(() => (report ? themeFromReport(report, '参考风格主题') : null), [report])
  const analyze = (source: string) => {
    const dom = new DOMParser().parseFromString(source, 'text/html')
    const r = analyzeStyle(dom.body)
    if (r.sampleCount < 3) return notify('样式样本太少：请粘贴带内联样式的公众号文章 HTML', 'error')
    setReport(r)
  }
  return (
    <div className="props-form">
      <h4><Help title="参考风格学习">只提取字号层级、颜色、行距、间距、圆角与装饰倾向等数值参数，生成全新的原创主题；不复制原文结构、文字或素材。</Help></h4>
      <label className="check">
        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
        我确认对参考文章拥有使用权或已获授权
      </label>
      <label className="field"><span>公众号文章链接</span><input value={url} placeholder="https://mp.weixin.qq.com/s/..." onChange={(e) => setUrl(e.target.value)} /></label>
      <button
        disabled={!authorized || !url}
        onClick={async () => {
          try {
            analyze((await api.fetchReference(url)).html)
          } catch (e: any) {
            notify(e.message, 'error')
          }
        }}
      >
        抓取并分析
      </button>
      <label className="field"><span><Help title="或粘贴文章 HTML">在浏览器中复制正文后，用开发者工具复制 #js_content 元素。</Help></span><textarea aria-label="或粘贴文章 HTML" rows={4} value={html} onChange={(e) => setHtml(e.target.value)} /></label>
      <button disabled={!authorized || !html} onClick={() => analyze(html)}>分析粘贴内容</button>
      {report && draft && (
        <div className="report">
          <h4>提取结果（{report.sampleCount} 个样式样本）</h4>
          <div className="color-row">
            {report.colors.slice(0, 6).map((c) => <i key={c.color} className="dot" style={{ background: c.color }} title={`${c.color} ×${c.count}`} />)}
          </div>
          <p>字号：{report.fontSizes.map((f) => `${f.size}px`).join(' / ')}</p>
          <p>行距 {report.lineHeight} · 字距 {report.letterSpacing}px · 段距 {report.paragraphSpacing}px · 圆角 {report.radius}px</p>
          <p>装饰倾向：竖线 {report.traits.borderLeft} · 胶囊 {report.traits.pill} · 居中 {report.traits.centered} · 图片 {report.traits.images}</p>
          <h4>生成的主题</h4>
          <div className="color-row">
            {Object.entries(draft.colors).map(([k, c]) => <i key={k} className="dot" style={{ background: c }} title={`${k} ${c}`} />)}
          </div>
          <p>标题样式 {draft.headingVariant} · 引言 {draft.quoteVariant} · 卡片 {draft.cardVariant}</p>
          <button
            className="primary wide"
            disabled={saving}
            onClick={async () => {
              const name = prompt('新主题名称', '我的参考风格')
              if (!name) return
              const t = { ...draft, name }
              await save(t)
            }}
          >
            保存并应用为新主题
          </button>
        </div>
      )}
    </div>
  )
}

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('style')
  const block = useStore(selectedBlock)
  const selectedIds = useStore(s=>s.selectedIds)
  const doc = useStore(s=>s.doc)
  const hasProposal = useStore((s) => !!s.proposal)
  useEffect(() => {
    if (hasProposal) setTab('ai')
  }, [hasProposal])
  return (
    <aside className="panel right">
      <nav className="tabs">
        {(['style', 'theme', 'ai', 'reference'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {{ style: block ? '模块' : '文章', theme: '主题', ai: 'AI 设计', reference: '参考风格' }[t]}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'style' && (selectedIds.length > 1 ? <div className="props-form" data-testid="multi-selection-properties">
          <h4>已选 {selectedIds.length} 个模块</h4>
          <p>当前为多选。不同模块的属性不混用；点击单个模块可编辑其属性。</p>
          <ul>{selectedIds.map(id=><li key={id}>{blockLabel(findBlock(doc.blocks,id)!.block)}</li>)}</ul>
          <button data-testid="delete-selected-blocks" onClick={()=>useStore.getState().removeSelected()}>删除所选模块</button>
          <button onClick={()=>useStore.getState().select(null)}>取消选择</button>
        </div> : block ? <PropsForm key={block.id} block={block} /> : <DocSettings />)}
        {tab === 'theme' && <ThemePanel />}
        {tab === 'ai' && <AiPanel />}
        {tab === 'reference' && <ReferencePanel />}
      </div>
    </aside>
  )
}
