import { useEffect, useRef, useState } from 'react'

const endpoint = '/api/data/migrate'
type SharedCounts = { skipped: number; unsupported: number; invalid: number; ignored: number }
type Plan = SharedCounts & { added: number; sourceLayout: 'checkout' | 'data' }
type Result = SharedCounts & { restored: number; failed: number }
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
function decodePreview(input: unknown): Preview {
  const { token, plan: raw } = object(input)
  const plan = object(raw)
  const sourceLayout = plan.sourceLayout
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/.test(token) || !['checkout', 'data'].includes(String(sourceLayout))) {
    throw Error('迁移预览格式无效')
  }
  return { token, plan: { added: count(plan, 'add'), ...counts(plan, 'skip'), sourceLayout: sourceLayout as Plan['sourceLayout'] } }
}
function decodeResult(input: unknown): Result {
  const data = object(input)
  return { restored: count(data, 'restored'), failed: count(data, 'failed'), ...counts(data, 'skipped') }
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

export function LegacyDirectoryMigrationPanel() {
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
        const next = decodePreview(await content(await send('', {}, { signal: controller.signal }), true))
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
        if (!controller.signal.aborted) setResult(migrated)
        if (migrated.restored) window.dispatchEvent(new Event('projects-changed'))
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

  return <section aria-label="从本机旧目录迁移项目">
    <h4>从本机旧目录迁移项目</h4>
    <p className="hint">只读取桌面程序所有者在启动前指定的旧仓库或 data 文件夹。迁移不改动源文件，也不覆盖现有项目。</p>
    <p className="hint">支持普通文字项目及项目内由旧素材库索引的 PNG/JPEG。不迁移独立素材、复杂排版、历史版本、模板、组件、主题和设置，不读取 .env 内容。</p>
    {!preview && <button type="button" disabled={busy} onClick={() => void run('preview')}>检测已配置旧目录</button>}
    {preview && <>
      <p role="status">尚未写入。预计新增 {preview.plan.added}，跳过 {preview.plan.skipped}，不支持 {preview.plan.unsupported}，无效 {preview.plan.invalid}，忽略 {preview.plan.ignored}。</p>
      <button type="button" disabled={busy} onClick={() => void run('cancel')}>取消目录迁移</button>
      <button type="button" disabled={busy || !preview.plan.added} onClick={() => void run('apply')}>确认迁移项目</button>
    </>}
    {result && <p role="status">已新增 {result.restored}，跳过 {result.skipped}，失败 {result.failed}，不支持 {result.unsupported}，无效 {result.invalid}，忽略 {result.ignored}。</p>}
    {error && <p role="alert" className="warn">{error}</p>}
  </section>
}
