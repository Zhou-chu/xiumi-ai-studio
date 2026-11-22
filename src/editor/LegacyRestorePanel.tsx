import { renderCrossSvgPreview } from '../core/crossSvgPreview'
import { useEffect, useRef, useState } from 'react'
import type { RestoreHistoryReason } from '../core/restoreHistoryReasons'
import { api, type LegacyRestorePlan, type LegacyRestoreResult } from './api'
import { loadCustomThemes } from './store'

import { MAX_RESTORE_ARCHIVE_MIB, MAX_RESTORE_ARCHIVE_UPLOAD } from '../core/backupLimits'
type Preview = { token: string; plan: LegacyRestorePlan }
function RestoreList({ label, entries }: { label: string; entries: string[] }) {
  if (!entries.length) return null
  return <details>
    <summary>{label}（{entries.length}）</summary>
    <ul>{entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
  </details>
}
const historyReasonLabels: Record<RestoreHistoryReason, string> = {
  'parent-mismatch': '本地稿件与备份中的稿件不同',
  'parent-changed': '确认前本地稿件已改变',
  'retention-limit': '已达历史保留上限',
  'occupied': '已有同名版本，未覆盖',
  'target-unavailable': '本地历史目录不可用',
  'dependency-unavailable': '引用的图片不可用',
}
function historyLabels(keys: string[] = [], reasons: Record<string, RestoreHistoryReason> = {}) {
  return keys.map(key => Object.hasOwn(reasons, key) ? key + '：' + historyReasonLabels[reasons[key]] : key)
}
type ItemGroup = { themes: string[]; templates: string[] }
function designGroup(value: LegacyRestorePlan['design'] | LegacyRestoreResult['design'], key: 'conflicts' | 'alreadyPresent'): ItemGroup {
  return { themes: value?.themes[key] ?? [], templates: value?.templates[key] ?? [] }
}
function StyleLists({ label, group }: { label: string; group: ItemGroup }) {
  return <>
    <RestoreList label={label + '模板'} entries={group.templates} />
    <RestoreList label={label + '主题'} entries={group.themes} />
  </>
}
function DesignPreview({ design }: { design: NonNullable<LegacyRestorePlan['design']> }) {
  return <>
    <StyleLists label="可添加的" group={{ themes: design.themes.add, templates: design.templates.add }} />
    <StyleLists label="已有相同" group={designGroup(design, 'alreadyPresent')} />
    <StyleLists label="冲突，未覆盖的" group={designGroup(design, 'conflicts')} />
    <RestoreList label="缺少匹配主题或图片的模板" entries={design.templates.unresolved} />
  </>
}
function DesignResult({ design }: { design: NonNullable<LegacyRestoreResult['design']> }) {
  return <>
    <StyleLists label="新增" group={{ themes: design.themes.restored, templates: design.templates.restored }} />
    <StyleLists label="已有相同" group={designGroup(design, 'alreadyPresent')} />
    <StyleLists label="冲突，未覆盖的" group={designGroup(design, 'conflicts')} />
    <StyleLists label="写入失败的" group={{ themes: design.themes.failed, templates: design.templates.failed }} />
    <RestoreList label="缺少匹配主题或图片的模板" entries={design.templates.unresolved} />
  </>
}
function ComponentLists({ value }: { value: NonNullable<LegacyRestorePlan['components'] | LegacyRestoreResult['components']> }) {
  return <>
    {'add' in value ? <RestoreList label="可添加的组件" entries={value.add} /> : <>
      <RestoreList label="新增组件" entries={value.restored} />
      <RestoreList label="写入失败的组件" entries={value.failed} />
    </>}
    <RestoreList label="已有相同组件" entries={value.alreadyPresent} />
    <RestoreList label="冲突，未覆盖的组件" entries={value.conflicts} />
    <RestoreList label="缺少匹配图片的组件" entries={value.unresolved} />
  </>
}
function ModelCardLists({ value }: { value: NonNullable<LegacyRestorePlan['modelCards'] | LegacyRestoreResult['modelCards']> }) {
  return <>
    {'add' in value ? <RestoreList label="可添加的模型资料" entries={value.add} /> : <>
      <RestoreList label="新增模型资料" entries={value.restored} />
      <RestoreList label="写入失败的模型资料" entries={value.failed} />
    </>}
    <RestoreList label="已有相同模型资料" entries={value.alreadyPresent} />
    <RestoreList label="冲突，未覆盖的模型资料" entries={value.conflicts} />
  </>
}
function hasAdditions(plan: LegacyRestorePlan | undefined): boolean {
  return !!(plan?.projects.add.length || plan?.versions?.add.length || plan?.assets?.add.length || plan?.design?.themes.add.length || plan?.design?.templates.add.length || plan?.components?.add.length || plan?.modelCards?.add.length)
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : '请求未完成，请重试。'

export function LegacyRestorePanel() {
  const [file, setFile] = useState<File | null>(null)
  const [indexedImages, setIndexedImages] = useState(false)
  const [standaloneImages, setStandaloneImages] = useState(false)
  const [includeDesign, setIncludeDesign] = useState(false)
  const [includeModelCards, setIncludeModelCards] = useState(false)
  const [crossSvgOptIn, setCrossSvgOptIn] = useState(false)
  const [includeComponents, setIncludeComponents] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<LegacyRestoreResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | 'cancel' | null>(null)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  const run = async (stage: 'preview' | 'apply' | 'cancel') => {
    if (active.current || !file || (stage === 'apply' && !hasAdditions(preview?.plan)) || (stage === 'cancel' && !preview)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(stage)
    setError('')
    setResult(null)
    setPreview(null)
    try {
      if (stage === 'preview') {
        const response = await api.previewLegacyRestore(file, controller.signal, indexedImages, includeDesign, includeComponents, standaloneImages, includeModelCards, crossSvgOptIn)
        if (!controller.signal.aborted) setPreview(response)
      } else if (stage === 'cancel' && preview) {
        await api.cancelLegacyRestore(preview.token, controller.signal)
      } else if (preview) {
        const response = await api.applyLegacyRestore(preview.token, controller.signal)
        if (response.design?.themes.restored.length) await loadCustomThemes()
        if (!controller.signal.aborted) setResult(response)
        if (response.projects.restored.length) window.dispatchEvent(new Event('projects-changed'))
        if (response.assets?.restored.length) window.dispatchEvent(new Event('assets-changed'))
        if (response.components?.restored.length) window.dispatchEvent(new Event('components-changed'))
        if (response.design?.templates.restored.length) window.dispatchEvent(new Event('templates-changed'))
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(stage === 'apply' ? `未确认恢复结果：${message(failure)} 请重新预览，核对已存在的项目。` : message(failure))
      }
    } finally {
      if (active.current === controller) {
        active.current = null
        if (!controller.signal.aborted) setBusy(null)
      }
    }
  }

  const svgPreview = crossSvgOptIn && preview?.plan.crossSvgPreview ? renderCrossSvgPreview(preview.plan.crossSvgPreview) : null

  return <section aria-label="从整库 ZIP 恢复部分项目">
    <h4>从整库 ZIP 恢复部分项目</h4>
    <p className="hint">只添加支持的项目，不覆盖现有数据。新加入的项目可恢复符合条件的历史；选择恢复图片后，会一并检查当前文稿和历史版本中普通图片模块引用的已索引 PNG/JPEG。还可独立选择恢复简单模板、自定义主题、或简单原文组件及引用图片。备份中的组件来源仅供参考，不继承授权或分发许可。同时选择图片与模板后可恢复简单模板引用的已索引图片和原生双图模块；模板支持有限的主题微调。其他模板媒体、复杂排版、链接及完整设置不在此范围内；不支持迁移。</p>
    <p className="hint">ZIP 必须小于 {MAX_RESTORE_ARCHIVE_MIB} MiB，解压后的项目、图片、历史、模板、组件和主题数据有限额。</p>
    <label className="field">选择整库 ZIP
      <input type="file" accept=".zip,application/zip" disabled={!!busy} onChange={event => {
        if (active.current) return
        const selected = event.currentTarget.files?.[0] ?? null
        setPreview(null)
        setResult(null)
        if (selected && selected.size >= MAX_RESTORE_ARCHIVE_UPLOAD) {
          setFile(null)
          setError(`备份达到或超过 ${MAX_RESTORE_ARCHIVE_MIB} MiB，不能在此恢复。`)
          event.currentTarget.value = ''
        } else {
          setFile(selected)
          setError('')
        }
      }} />
    </label>
    <label className="row gap">
      <input type="checkbox" checked={indexedImages} disabled={!!busy} onChange={event => {
        setIndexedImages(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      同时恢复项目、历史及已选择模板引用的已索引图片
    </label>
    <label className="row gap">
      <input type="checkbox" checked={standaloneImages} disabled={!!busy} onChange={event => {
        setStandaloneImages(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      独立恢复素材库中已索引的 PNG/JPEG（无需项目引用，不覆盖现有图片）
    </label>
    <label className="row gap">
      <input type="checkbox" checked={includeDesign} disabled={!!busy} onChange={event => {
        setIncludeDesign(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      同时恢复简单模板和自定义主题
    </label>
    <label className="row gap">
      <input type="checkbox" checked={includeComponents} disabled={!!busy} onChange={event => {
        setIncludeComponents(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      同时恢复简单原文组件及引用图片
    </label>
    <label className="row gap">
      <input type="checkbox" checked={includeModelCards} disabled={!!busy} onChange={event => {
        setIncludeModelCards(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      恢复只读模型资料（不导入服务地址或密钥，也不会启用）
    </label>
    <label className="row gap">
      <input type="checkbox" checked={crossSvgOptIn} disabled={!!busy} onChange={event => {
        setCrossSvgOptIn(event.currentTarget.checked)
        setPreview(null)
        setResult(null)
        setError('')
      }} />
      离线查看受支持的跨块 SVG（只读）
    </label>
    <div className="row gap wrap">
      <button type="button" disabled={!file || !!busy} onClick={() => void run('preview')}>{busy === 'preview' ? '正在预览…' : '预览恢复'}</button>
      {preview && <button type="button" disabled={!hasAdditions(preview.plan) || !!busy} onClick={() => void run('apply')}>{(preview.plan.design || preview.plan.components || preview.plan.modelCards || standaloneImages || (!preview.plan.projects.add.length && preview.plan.versions?.add.length)) ? '确认添加所选数据' : '确认添加项目'}</button>}
    </div>
    {svgPreview && <section aria-label="跨块 SVG 离线预览">
      <p>可离线预览，暂不能恢复到项目</p>
      <iframe title="跨块 SVG 离线预览" width="320" height="375" sandbox="" srcDoc={svgPreview} />
      <button type="button" disabled={!!busy} onClick={() => void run('cancel')}>取消预览</button>
    </section>}
    {crossSvgOptIn && preview && !svgPreview && <p className="hint">这份备份没有符合本机预览范围的跨块 SVG 稿件。</p>}
    {busy === 'apply' && <p role="status">正在添加所选数据。关闭窗口不会撤销已经添加的数据。</p>}
    {error && <p role="alert" className="warn">{error}</p>}
    {preview && <div className="report" aria-label="恢复预览">
      <p role="status">预览未写入项目数据。预计新增 {preview.plan.projects.add.length} 个项目；确认时会重新检查。</p>
      <RestoreList label="可添加的项目" entries={preview.plan.projects.add} />
      <RestoreList label="现有项目，不覆盖" entries={preview.plan.projects.skip} />
      <RestoreList label="不支持的项目" entries={preview.plan.projects.unsupported} />
      <RestoreList label="可添加的历史版本" entries={preview.plan.versions?.add ?? []} />
      <RestoreList label="将跳过的历史版本" entries={historyLabels(preview.plan.versions?.skip, preview.plan.versions?.reasons)} />
      <RestoreList label={standaloneImages ? '可添加的素材库图片' : '可添加的引用图片'} entries={preview.plan.assets?.add ?? []} />
      <RestoreList label="已有相同图片" entries={preview.plan.assets?.alreadyPresent ?? []} />
      <RestoreList label="冲突图片，不覆盖" entries={preview.plan.assets?.skip ?? []} />
      {preview.plan.components && <ComponentLists value={preview.plan.components} />}
      {preview.plan.modelCards && <ModelCardLists value={preview.plan.modelCards} />}
      {preview.plan.design && <DesignPreview design={preview.plan.design} />}
      <RestoreList label="不恢复的其他档案" entries={preview.plan.unsupported} />
    </div>}
    {result && <div className="report" aria-label="本次恢复结果">
      <p role="status">{standaloneImages && `新增 ${result.assets?.restored.length ?? 0} 张素材图片。 `}{result.projects.restored.length ? `新增 ${result.projects.restored.length} 个项目。` : '没有新增项目。'}</p>
      <RestoreList label="新增项目" entries={result.projects.restored} />
      <RestoreList label="已跳过，不覆盖" entries={result.projects.skipped} />
      <RestoreList label="写入失败" entries={result.projects.failed} />
      <RestoreList label="不支持的项目" entries={result.projects.unsupported} />
      <RestoreList label="新增历史版本" entries={result.versions?.restored ?? []} />
      <RestoreList label="已跳过的历史版本" entries={historyLabels(result.versions?.skipped, result.versions?.reasons)} />
      <RestoreList label="写入失败的历史版本" entries={historyLabels(result.versions?.failed, result.versions?.reasons)} />
      <RestoreList label="新增图片" entries={result.assets?.restored ?? []} />
      <RestoreList label="已有相同图片" entries={result.assets?.alreadyPresent ?? []} />
      <RestoreList label="已跳过的冲突图片" entries={result.assets?.skipped ?? []} />
      <RestoreList label="图片写入失败" entries={result.assets?.failed ?? []} />
      {result.components && <ComponentLists value={result.components} />}
      {result.modelCards && <ModelCardLists value={result.modelCards} />}
      {result.design && <DesignResult design={result.design} />}
      <RestoreList label="未恢复的其他档案" entries={result.unsupported} />
    </div>}
  </section>
}
