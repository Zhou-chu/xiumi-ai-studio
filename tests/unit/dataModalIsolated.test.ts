// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppInfo, MergePlanView } from '../../src/editor/api'
import { DataModal } from '../../src/editor/DataModal'

const h = vi.hoisted(() => ({
  api: {
    wechatStatus: vi.fn(), openFolder: vi.fn(), restoreUpload: vi.fn(),
    restoreApply: vi.fn(), migratePreview: vi.fn(), migrateApply: vi.fn(),
  },
  flush: vi.fn(), notify: vi.fn(), close: vi.fn(),
}))
vi.mock('../../src/editor/api', () => ({ api: h.api }))
vi.mock('../../src/editor/store', () => ({
  flushSave: h.flush, useStore: (pick: (store: { notify: typeof h.notify }) => unknown) => pick({ notify: h.notify }),
}))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) =>
    createElement('section', { role: 'dialog', 'aria-label': title }, children,
      createElement('button', { 'data-testid': 'dismiss-data', onClick: onClose }, '关闭面板')),
}))
const info: AppInfo = {
  app: 'fixture', version: '1.0.0', packaged: false, port: null, dataDir: '/fixture/current',
  envFile: '/fixture/current/.env', logDir: '/fixture/logs', envExists: false, canOpenFolder: true, canQuit: false,
}
const plan: MergePlanView = {
  source: '/fixture/legacy', target: '/fixture/current',
  counts: { projects: { label: '项目', add: 2, skip: 1 }, empty: { label: '隐藏项', add: 0, skip: 0 } },
  ignored: 2, ai: { add: ['合成模型甲'], skip: ['合成模型乙'], withKeys: false },
  env: { source: '/fixture/legacy/.env', target: '/fixture/current/.env', action: 'copy' },
}
const cleanPlan: MergePlanView = { ...plan, counts: {}, ignored: 0, ai: { add: [], skip: [], withKeys: false }, env: null }
const result = { copied: 2, skipped: 1, aiAdded: 1, envCopied: true }
const noBoundary = () => { throw Error('Unexpected isolated backup or system operation') }
const fetchGuard = vi.fn(noBoundary)
const clickAnchor = vi.fn<(href: string, hasDownload: boolean) => void>()
const confirm = vi.fn((_message: string) => false)
let root: Root, host: HTMLDivElement
const el = <T extends HTMLElement=HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!
const byText = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const click = async (node: HTMLElement) => { await act(async () => { node.click() }) }
const mount = async (runtime: AppInfo | null = info) => { await act(async () => root.render(createElement(DataModal, { info: runtime, onClose: h.close }))) }
const path = (value: string) => act(() => {
  const field = el<HTMLInputElement>('legacy-path')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
})
async function files(selected: File[]) {
  const field = el<HTMLInputElement>('restore-file')
  Object.defineProperty(field, 'files', { configurable: true, value: selected })
  await act(async () => { field.dispatchEvent(new Event('change', { bubbles: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchGuard.mockClear(); vi.stubGlobal('fetch', fetchGuard)
  confirm.mockReset().mockReturnValue(false); vi.stubGlobal('confirm', confirm)
  clickAnchor.mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickAnchor(this.getAttribute('href') ?? '', this.hasAttribute('download'))
  })
  for (const mock of Object.values(h.api)) mock.mockReset().mockImplementation(noBoundary)
  h.api.wechatStatus.mockResolvedValue({ configured: false })
  h.flush.mockReset().mockResolvedValue(undefined)
  h.notify.mockReset(); h.close.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  expect(fetchGuard).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('shows an unresolved data path with no folder actions until host info is available', async () => {
  await mount(null)
  expect(el('data-dir').textContent).toBe('读取中…')
  expect(byText('打开数据文件夹')).toBeUndefined()
  expect(byText('打开日志文件夹')).toBeUndefined()
  expect(host.textContent).toContain('未配置。')
  expect(h.api.openFolder).not.toHaveBeenCalled()
})
it('shows the actual displayed path and delegates only the specific requested local folder target', async () => {
  h.api.wechatStatus.mockResolvedValue({ configured: true })
  h.api.openFolder.mockResolvedValueOnce({ opened: false, path: '/fixture/current' })
    .mockResolvedValueOnce({ opened: true }).mockResolvedValueOnce({ opened: true })
  await mount()
  expect(el('data-dir').textContent).toBe('/fixture/current')
  expect(host.textContent).toContain('已配置。')
  await click(byText('打开数据文件夹')); await click(byText('打开日志文件夹')); await click(byText('创建并打开配置文件'))
  expect(h.api.openFolder.mock.calls).toEqual([['data'], ['logs'], ['env']])
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('位置：/fixture/current')
})
it('waits for the pending write barrier before starting the backup download', async () => {
  let saved!: () => void
  h.flush.mockReturnValue(new Promise<void>(resolve => { saved = resolve }))
  await mount()
  await click(el('download-backup'))
  expect(el<HTMLButtonElement>('download-backup').disabled).toBe(true)
  expect(clickAnchor).not.toHaveBeenCalled()
  await act(async () => { saved() })
  expect(clickAnchor).toHaveBeenCalledExactlyOnceWith('/api/data/backup', true)
  expect(document.querySelector('a[download]')).toBeNull()
})
it('does not start an incomplete backup unless the person explicitly accepts that outcome', async () => {
  h.flush.mockRejectedValue(Error('合成保存失败'))
  await mount()
  await click(el('download-backup'))
  expect(confirm.mock.calls[0][0]).toContain('备份里不会包含最近没有保存的修改')
  expect(clickAnchor).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await click(el('download-backup'))
  expect(clickAnchor).toHaveBeenCalledExactlyOnceWith('/api/data/backup', true)
})
it('separates ZIP preview, cancel and explicit apply with the returned token', async () => {
  const selected = new File(['fixture'], 'test.zip', { type: 'application/zip' })
  h.api.restoreUpload.mockResolvedValue({ token: 'synthetic-token', plan })
  h.api.restoreApply.mockResolvedValue(result)
  await mount()
  await files([])
  expect(h.api.restoreUpload).not.toHaveBeenCalled()
  await files([selected])
  expect(h.api.restoreUpload).toHaveBeenCalledExactlyOnceWith(selected)
  expect(h.api.restoreApply).not.toHaveBeenCalled()
  const preview = el('merge-plan').textContent
  expect(preview).toContain('保留本机版本')
  expect(preview).toContain('合成模型甲')
  expect(preview).toContain('不含密钥')
  expect(preview).toContain('另有 2 个')
  expect(preview).not.toContain('隐藏项')
  await click(byText('取消'))
  expect(el('restore-apply')).toBeNull()
  await files([selected])
  await click(el('restore-apply'))
  expect(h.api.restoreApply).toHaveBeenCalledExactlyOnceWith('synthetic-token')
  expect(el('merge-result').textContent).toContain('已导入 2 个文件，跳过本机已有的 1 个，新增 1 套 AI 配置，已复制公众号配置（重启后生效）')
})
it('requires a nonempty migration path, previews without applying and clears the shown plan after edits', async () => {
  h.api.migratePreview.mockResolvedValue({ plan: cleanPlan })
  await mount()
  expect(el<HTMLButtonElement>('legacy-preview').disabled).toBe(true)
  path('   '); expect(el<HTMLButtonElement>('legacy-preview').disabled).toBe(true)
  path('/fixture/legacy')
  await click(el('legacy-preview'))
  expect(h.api.migratePreview).toHaveBeenCalledExactlyOnceWith('/fixture/legacy')
  expect(h.api.migrateApply).not.toHaveBeenCalled()
  expect(el('merge-plan').textContent).toContain('没有可导入的项目、模板、组件或素材')
  path('/fixture/other')
  expect(el('legacy-apply')).toBeNull()
  expect(h.api.migrateApply).not.toHaveBeenCalled()
})
it('reports migration errors and only triggers the bound typed path after successful analysis', async () => {
  h.api.migratePreview.mockRejectedValueOnce(Error('合成检测失败')).mockResolvedValueOnce({ plan })
  h.api.migrateApply.mockResolvedValueOnce({ copied: 1, skipped: 0, aiAdded: 0, envCopied: false })
  await mount()
  path('/fixture/legacy')
  await click(el('legacy-preview'))
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('合成检测失败', 'error')
  expect(el('legacy-apply')).toBeNull()
  await click(el('legacy-preview'))
  await click(el('legacy-apply'))
  expect(h.api.migrateApply).toHaveBeenCalledExactlyOnceWith('/fixture/legacy')
  expect(el('merge-result').textContent).toContain('已导入 1 个文件')
})

function pendingPlan() {
  let complete!: (value: { plan: MergePlanView }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ plan: MergePlanView }>((resolve, fail) => { complete = resolve; reject = fail })
  return { promise, complete, reject }
}
it('cannot apply a newly typed path using a stale plan from a different source', async () => {
  const old = pendingPlan()
  h.api.migratePreview.mockReturnValueOnce(old.promise)
  h.api.migrateApply.mockResolvedValueOnce(result)
  await mount()
  path('/fixture/old-typed-path')
  await click(el('legacy-preview'))
  expect(h.api.migratePreview).toHaveBeenCalledExactlyOnceWith('/fixture/old-typed-path')
  path('/fixture/unreviewed-path')
  expect(el('legacy-apply')).toBeNull()
  await act(async () => { old.complete({ plan }) })
  const stale = el('legacy-apply')
  if (stale) await click(stale)
  expect(h.api.migrateApply).not.toHaveBeenCalled()
  expect(stale).toBeNull()
})
it('requires a new preview even when a typed path changes away and back during the old request', async () => {
  const old = pendingPlan()
  h.api.migratePreview.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ plan: cleanPlan })
  h.api.migrateApply.mockResolvedValueOnce(result)
  await mount()
  path('/fixture/legacy')
  await click(el('legacy-preview'))
  path('/fixture/another')
  path('/fixture/legacy')
  await act(async () => { old.complete({ plan }) })
  expect(el('legacy-apply')).toBeNull()
  await click(el('legacy-preview'))
  expect(el('merge-plan').textContent).toContain('没有可导入的项目')
  await click(el('legacy-apply'))
  expect(h.api.migrateApply).toHaveBeenCalledExactlyOnceWith('/fixture/legacy')
})
it('ignores an obsolete preview error and permits the current source to be reviewed', async () => {
  const old = pendingPlan()
  h.api.migratePreview.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ plan: cleanPlan })
  await mount()
  path('/fixture/old')
  await click(el('legacy-preview'))
  path('/fixture/legacy')
  await act(async () => { old.reject(Error('旧路径错误')) })
  expect(h.notify).not.toHaveBeenCalled()
  expect(el('legacy-apply')).toBeNull()
  await click(el('legacy-preview'))
  expect(el('merge-plan').textContent).toContain('没有可导入的项目')
})
it('does not reactivate the plan after explicit dismissal of the requesting dialog', async () => {
  const pending = pendingPlan()
  h.api.migratePreview.mockReturnValueOnce(pending.promise)
  await mount()
  path('/fixture/legacy')
  await click(el('legacy-preview'))
  await click(el('dismiss-data'))
  expect(h.close).toHaveBeenCalledTimes(1)
  await act(async () => { pending.complete({ plan }) })
  expect(el('legacy-apply')).toBeNull()
  expect(h.api.migrateApply).not.toHaveBeenCalled()
})
it('does not surface a deferred preview failure after the dialog unmounts', async () => {
  const old = pendingPlan()
  h.api.migratePreview.mockReturnValueOnce(old.promise)
  await mount()
  path('/fixture/legacy')
  await click(el('legacy-preview'))
  act(() => root.render(null))
  await act(async () => { old.reject(Error('已离开的请求错误')) })
  expect(h.notify).not.toHaveBeenCalled()
  expect(h.api.migrateApply).not.toHaveBeenCalled()
})
