import { useEffect, useRef, useState } from 'react'
import { loadCustomThemes } from './store'

const endpoint = '/api/data/migrate'
const designGroups = [['themes', '主题'], ['templates', '模板'], ['components', '组件']] as const
type DesignGroup = typeof designGroups[number][0]
type DesignPreview = Record<DesignGroup, { add: number; conflicts: number; alreadyPresent: number; unresolved: number }>
type DesignResult = Record<DesignGroup, { restored: number; conflicts: number; alreadyPresent: number; unresolved: number; failed: number }>
type SharedCounts = { skipped: number; unsupported: number; invalid: number; ignored: number }
type Plan = SharedCounts & { design?: DesignPreview; assets?: { added: number; skipped: number; alreadyPresent: number }; added: number; sourceLayout: 'checkout' | 'data'; versions?: { added: number; skipped: number; unsupported: number } }
type Result = SharedCounts & { design?: DesignResult; assets?: { restored: number; skipped: number; failed: number; alreadyPresent: number }; restored: number; failed: number; versions?: { restored: number; skipped: number; failed: number; unsupported: number } }
type Preview = { token: string; plan: Plan }
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function count(data: Record<string, unknown>, key: string) {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('迁移结果格式无效')
  return value
}
function counts(data: Record<string, unknown>, skipped: string): SharedCounts {
  return { skipped: count(data, skipped), unsupported: count(data, 'unsupported'), invalid: count(data, 'invalid'), ignored: count(data, 'ignored') }
}
function decodeDesign<K extends string>(raw: unknown, fields: readonly K[]) {
  const grouped = object(raw)
  return Object.fromEntries(designGroups.map(([key]) => [key,
    Object.fromEntries(fields.map(field => [field, count(object(grouped[key]), field)])),
  ])) as Record<DesignGroup, Record<K, number>>
}
function DesignPreviewSummary({ design }: { design?: DesignPreview }) {
  if (!design) return null
  return <>{designGroups.map(([key, label]) => <span key={key}> {label}预计新增 {design[key].add}，冲突 {design[key].conflicts}，已有相同 {design[key].alreadyPresent}，依赖未满足 {design[key].unresolved}。</span>)}</>
}
function DesignResultSummary({ design }: { design?: DesignResult }) {
  if (!design) return null
  return <>{designGroups.map(([key, label]) => <span key={key}> {label}已新增 {design[key].restored}，冲突 {design[key].conflicts}，已有相同 {design[key].alreadyPresent}，依赖未满足 {design[key].unresolved}，失败 {design[key].failed}。</span>)}</>
}
function decodePreview(input: unknown): Preview {
  const { token, plan: raw } = object(input)
  const plan = object(raw)
  const sourceLayout = plan.sourceLayout
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/.test(token) || !['checkout', 'data'].includes(String(sourceLayout))) {
    throw Error('迁移预览格式无效')
  }
  const versions = object(plan.versions), assets = object(plan.assets)
  return { token, plan: { added: count(plan, 'add'), ...counts(plan, 'skip'), sourceLayout: sourceLayout as Plan['sourceLayout'],
    ...(plan.design !== undefined && { design: decodeDesign(plan.design, ['add', 'conflicts', 'alreadyPresent', 'unresolved']) }),
    ...(plan.assets !== undefined && { assets: { added: count(assets, 'add'), skipped: count(assets, 'skip'), alreadyPresent: count(assets, 'alreadyPresent') } }),
    ...(plan.versions !== undefined && { versions: { added: count(versions, 'add'), skipped: count(versions, 'skip'), unsupported: count(versions, 'unsupported') } }),
  } }
}
function decodeResult(input: unknown): Result {
  const data = object(input)
  const versions = object(data.versions), assets = object(data.assets)
  return { restored: count(data, 'restored'), failed: count(data, 'failed'), ...counts(data, 'skipped'),
    ...(data.design !== undefined && { design: decodeDesign(data.design, ['restored', 'conflicts', 'alreadyPresent', 'unresolved', 'failed']) }),
    ...(data.assets !== undefined && { assets: { restored: count(assets, 'restored'), skipped: count(assets, 'skipped'), failed: count(assets, 'failed'), alreadyPresent: count(assets, 'alreadyPresent') } }),
    ...(data.versions !== undefined && { versions: { restored: count(versions, 'restored'), skipped: count(versions, 'skipped'), failed: count(versions, 'failed'), unsupported: count(versions, 'unsupported') } }),
  }
}
function send(suffix: string, body: Record<string, boolean>, options: RequestInit = {}) {
  return fetch(endpoint + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options })
}
async function content(response: Response, preview: boolean): Promise<unknown> {
  if (preview && response.status === 404) throw Error('没有启用本机目录迁移。请由桌面程序所有者在启动前指定旧版目录。')
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = object(data).error
    throw Error(typeof error === 'string' ? error : '本机迁移请求未完成')
  }
  return data
}

function confirmationLabel(plan: Plan | undefined) {
  if (!plan) return null
  if (plan.design && Object.values(plan.design).some(group => group.add > 0)) return '确认迁移所选数据'
  if (plan.assets?.added) return plan.added || plan.versions?.added ? '确认迁移所选数据' : '确认迁移素材'
  if (plan.added) return '确认迁移项目'
  return plan.versions?.added ? '确认迁移历史版本' : null
}

function previewRequest(standaloneImages: boolean, designRecords: boolean, signal: AbortSignal) {
  return send('', { ...(standaloneImages && { standaloneImages: true }), ...(designRecords && { designRecords: true }) }, { signal })
}

async function notifyMigration(result: Result) {
  const themes = result.design?.themes
  if (themes && (themes.restored || themes.alreadyPresent)) await loadCustomThemes()
  if (result.restored) window.dispatchEvent(new Event('projects-changed'))
  if (result.assets?.restored || result.design?.templates.restored || result.design?.components.restored) window.dispatchEvent(new Event('assets-changed'))
  if (result.design?.templates.restored) window.dispatchEvent(new Event('templates-changed'))
  if (result.design?.components.restored) window.dispatchEvent(new Event('components-changed'))
}

export function LegacyDirectoryMigrationPanel() {
  const [standaloneImages, setStandaloneImages] = useState(false)
  const [designRecords, setDesignRecords] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const token = useRef('')
  useEffect(() => () => {
    active.current?.abort()
    if (token.current) void send('/' + token.current + '/cancel', {}, { keepalive: true }).catch(() => {})
  }, [])

  async function run(action: 'preview' | 'apply' | 'cancel') {
    const current = token.current
    if (active.current || (action !== 'preview' && !current)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (action === 'preview') {
        const next = decodePreview(await content(await previewRequest(standaloneImages, designRecords, controller.signal), true))
        if (!controller.signal.aborted) {
          token.current = next.token
          setPreview(next)
        }
      } else if (action === 'cancel') {
        const response = await send('/' + current + '/cancel', {}, { signal: controller.signal })
        if (!response.ok && response.status !== 404) await content(response, false)
        if (!controller.signal.aborted) { token.current = ''; setPreview(null) }
      } else {
        token.current = ''
        setPreview(null)
        const migrated = decodeResult(await content(await send('/' + current + '/apply', { confirm: true }, { signal: controller.signal }), false))
        await notifyMigration(migrated)
        if (!controller.signal.aborted) setResult(migrated)
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message = failure instanceof Error ? failure.message : '请求未完成'
        setError(action === 'apply' ? '未确认迁移结果：' + message + ' 请重新检测。' : message)
      }
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const confirm = confirmationLabel(preview?.plan)
  return <section aria-label="从本机旧目录迁移项目">
    <h4>从本机旧目录迁移项目</h4>
    <p className="hint">只读取桌面程序所有者在启动前指定的旧仓库或 data 文件夹。迁移不改动源文件，也不覆盖现有项目。</p>
    <p className="hint">支持普通文字项目及符合条件的时间轴、数据表与留白分隔线，以及新增项目或内容完全匹配的本地项目缺少的历史版本。可迁移文稿和版本引用的已索引 PNG/JPEG。选中主题迁移可为项目恢复同一份旧目录中匹配的自定义主题。不迁移复杂排版和设置，不读取 .env 内容。</p>
    <label><input type="checkbox" checked={standaloneImages} disabled={busy || !!preview}
      onChange={event => { setStandaloneImages(event.currentTarget.checked); setResult(null); setError('') }} />
      独立迁移旧素材库中已索引的 PNG/JPEG
    </label>
    <label><input type="checkbox" checked={designRecords} disabled={busy || !!preview}
      onChange={event => { setDesignRecords(event.currentTarget.checked); setResult(null); setError('') }} />
      迁移旧目录中支持的主题、模板和组件
    </label>
    {!preview && <button type="button" disabled={busy} onClick={() => void run('preview')}>检测已配置旧目录</button>}
    {preview && <>
      <p role="status">尚未写入。预计新增 {preview.plan.added}，跳过 {preview.plan.skipped}，不支持 {preview.plan.unsupported}，无效 {preview.plan.invalid}，忽略 {preview.plan.ignored}。{preview.plan.assets && <> 独立素材预计新增 {preview.plan.assets.added}，跳过 {preview.plan.assets.skipped}，已有相同 {preview.plan.assets.alreadyPresent}。</>}{preview.plan.versions && <> 历史版本预计新增 {preview.plan.versions.added}，跳过 {preview.plan.versions.skipped}，不支持 {preview.plan.versions.unsupported}。</>}<DesignPreviewSummary design={preview.plan.design}/></p>
      <button type="button" disabled={busy} onClick={() => void run('cancel')}>取消目录迁移</button>
      <button type="button" disabled={busy || !confirm} onClick={() => void run('apply')}>
        {confirm ?? '确认迁移项目'}
      </button>
    </>}
    {result && <p role="status">已新增 {result.restored}，跳过 {result.skipped}，失败 {result.failed}，不支持 {result.unsupported}，无效 {result.invalid}，忽略 {result.ignored}。{result.assets && <> 独立素材已新增 {result.assets.restored}，跳过 {result.assets.skipped}，失败 {result.assets.failed}，已有相同 {result.assets.alreadyPresent}。</>}{result.versions && <> 历史版本已新增 {result.versions.restored}，跳过 {result.versions.skipped}，失败 {result.versions.failed}，不支持 {result.versions.unsupported}。</>}<DesignResultSummary design={result.design}/></p>}
    {error && <p role="alert" className="warn">{error}</p>}
  </section>
}
