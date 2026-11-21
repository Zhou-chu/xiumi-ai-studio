import { useEffect, useRef, useState } from 'react'
import { api, type LegacyRestorePlan, type LegacyRestoreResult } from './api'

import { MAX_RESTORE_ARCHIVE_MIB, MAX_RESTORE_ARCHIVE_UPLOAD } from '../core/backupLimits'
type Preview = { token: string; plan: LegacyRestorePlan }
function RestoreList({ label, entries }: { label: string; entries: string[] }) {
  if (!entries.length) return null
  return <details>
    <summary>{label}（{entries.length}）</summary>
    <ul>{entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
  </details>
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : '请求未完成，请重试。'

export function LegacyRestorePanel() {
  const [file, setFile] = useState<File | null>(null)
  const [indexedImages, setIndexedImages] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<LegacyRestoreResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  const run = async (stage: 'preview' | 'apply') => {
    if (active.current || !file || (stage === 'apply' && !preview?.plan.projects.add.length)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(stage)
    setError('')
    setResult(null)
    setPreview(null)
    try {
      if (stage === 'preview') {
        const response = await api.previewLegacyRestore(file, controller.signal, indexedImages)
        if (!controller.signal.aborted) setPreview(response)
      } else if (preview) {
        const response = await api.applyLegacyRestore(preview.token, controller.signal)
        if (!controller.signal.aborted) setResult(response)
        if (response.projects.restored.length) window.dispatchEvent(new Event('projects-changed'))
        if (response.assets?.restored.length) window.dispatchEvent(new Event('assets-changed'))
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

  return <section aria-label="从整库 ZIP 恢复部分项目">
    <h4>从整库 ZIP 恢复部分项目</h4>
    <p className="hint">只添加支持的项目，不覆盖现有数据。新加入的纯文字项目可恢复符合条件的文字历史；可另外选择恢复普通图片模块的已索引 PNG/JPEG。图片项目的历史、复杂排版、链接、模板、主题、组件及设置不在此范围内；不支持迁移。</p>
    <p className="hint">ZIP 必须小于 {MAX_RESTORE_ARCHIVE_MIB} MiB，解压后的项目、图片和历史数据各有限额。</p>
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
      同时恢复项目引用的已索引图片
    </label>
    <div className="row gap wrap">
      <button type="button" disabled={!file || !!busy} onClick={() => void run('preview')}>{busy === 'preview' ? '正在预览…' : '预览恢复'}</button>
      {preview && <button type="button" disabled={!preview.plan.projects.add.length || !!busy} onClick={() => void run('apply')}>确认添加项目</button>}
    </div>
    {busy === 'apply' && <p role="status">正在添加项目。关闭窗口不会撤销已经添加的项目。</p>}
    {error && <p role="alert" className="warn">{error}</p>}
    {preview && <div className="report" aria-label="恢复预览">
      <p role="status">预览未写入项目数据。预计新增 {preview.plan.projects.add.length} 个项目；确认时会重新检查。</p>
      <RestoreList label="可添加的项目" entries={preview.plan.projects.add} />
      <RestoreList label="现有项目，不覆盖" entries={preview.plan.projects.skip} />
      <RestoreList label="不支持的项目" entries={preview.plan.projects.unsupported} />
      <RestoreList label="可添加的历史版本" entries={preview.plan.versions?.add ?? []} />
      <RestoreList label="将跳过的历史版本" entries={preview.plan.versions?.skip ?? []} />
      <RestoreList label="可添加的项目图片" entries={preview.plan.assets?.add ?? []} />
      <RestoreList label="已有相同图片" entries={preview.plan.assets?.alreadyPresent ?? []} />
      <RestoreList label="冲突图片，不覆盖" entries={preview.plan.assets?.skip ?? []} />
      <RestoreList label="不恢复的其他档案" entries={preview.plan.unsupported} />
    </div>}
    {result && <div className="report" aria-label="本次恢复结果">
      <p role="status">{result.projects.restored.length ? `新增 ${result.projects.restored.length} 个项目。` : '没有新增项目。'}</p>
      <RestoreList label="新增项目" entries={result.projects.restored} />
      <RestoreList label="已跳过，不覆盖" entries={result.projects.skipped} />
      <RestoreList label="写入失败" entries={result.projects.failed} />
      <RestoreList label="不支持的项目" entries={result.projects.unsupported} />
      <RestoreList label="新增历史版本" entries={result.versions?.restored ?? []} />
      <RestoreList label="已跳过的历史版本" entries={result.versions?.skipped ?? []} />
      <RestoreList label="写入失败的历史版本" entries={result.versions?.failed ?? []} />
      <RestoreList label="新增图片" entries={result.assets?.restored ?? []} />
      <RestoreList label="已有相同图片" entries={result.assets?.alreadyPresent ?? []} />
      <RestoreList label="已跳过的冲突图片" entries={result.assets?.skipped ?? []} />
      <RestoreList label="图片写入失败" entries={result.assets?.failed ?? []} />
      <RestoreList label="未恢复的其他档案" entries={result.unsupported} />
    </div>}
  </section>
}
