// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import ProjectBackupModal from '../../src/editor/ProjectBackupModal'

vi.mock('../../src/editor/store', () => ({
  saveNow: vi.fn(),
  loadCustomThemes: vi.fn().mockResolvedValue(undefined),
  useStore: Object.assign((select: (value: { saveStatus: string }) => unknown) => select({ saveStatus: 'saved' }),
    { getState: () => ({ saveStatus: 'saved' }) }),
}))

const previewBody = {
  token: 'b'.repeat(64),
  plan: {
    projects: { add: ['example'], skip: ['existing'], unsupported: ['media-doc'] },
    unsupported: ['templates/example.json', 'settings.json'],
  },
}
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent === text)
function pick(selected: string | File) {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!
  expect(input).not.toBeNull()
  Object.defineProperty(input, 'files', { configurable: true, value: [typeof selected === 'string' ? new File(['fixture'], selected, { type: 'application/zip' }) : selected] })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
}
async function modal(test: (requests: ReturnType<typeof vi.fn>) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const requests = vi.fn()
  vi.stubGlobal('fetch', requests)
  try {
    act(() => root.render(<ProjectBackupModal onClose={vi.fn()} />))
    await test(requests)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  }
}

it('does not apply before explicit confirmation and reports exact partial results', () => modal(async requests => {
  requests.mockResolvedValueOnce(json(previewBody)).mockResolvedValueOnce(json({
    projects: { restored: [], skipped: ['example'], failed: ['later'], unsupported: ['media-doc'] },
    unsupported: ['templates/example.json', 'settings.json'],
  }))
  const changed = vi.fn()
  window.addEventListener('projects-changed', changed)
  try {
    pick('backup-export.zip')
    expect(requests).not.toHaveBeenCalled()
    expect(button('确认添加项目')).toBeUndefined()
    await act(async () => button('预览恢复')!.click())
    expect(requests).toHaveBeenCalledTimes(1)
    expect(requests.mock.calls[0][0]).toBe('/api/data/restore')
    expect(requests.mock.calls[0][1].body).toBeInstanceOf(FormData)
    expect(document.body.textContent).toContain('预览未写入项目数据')
    expect(document.body.textContent).toContain('media-doc')
    expect(document.body.textContent).toContain('templates/example.json')
    expect(document.body.textContent).toContain('settings.json')
    await act(async () => button('确认添加项目')!.click())
    expect(requests).toHaveBeenCalledTimes(2)
    expect(requests.mock.calls[1][0]).toBe(`/api/data/restore/${previewBody.token}/apply`)
    expect(JSON.parse(requests.mock.calls[1][1].body)).toEqual({ confirm: true })
    expect(document.body.textContent).toContain('没有新增项目')
    expect(document.body.textContent).toContain('later')
    expect(document.body.textContent).not.toContain('恢复成功')
    expect(button('确认添加项目')).toBeUndefined()
    expect(changed).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('projects-changed', changed)
  }
}))

it('invalidates stale previews on file selection and reports expiry without implying success', () => modal(async requests => {
  requests.mockResolvedValueOnce(json(previewBody)).mockResolvedValueOnce(json(previewBody))
    .mockResolvedValueOnce(json({ error: '恢复会话已过期' }, 404))
  pick('first.zip')
  await act(async () => button('预览恢复')!.click())
  expect(button('确认添加项目')?.disabled).toBe(false)
  pick('second.zip')
  expect(button('确认添加项目')).toBeUndefined()
  expect(requests).toHaveBeenCalledTimes(1)
  await act(async () => button('预览恢复')!.click())
  await act(async () => button('确认添加项目')!.click())
  expect(document.body.textContent).toContain('未确认恢复结果')
  expect(document.body.textContent).toContain('恢复会话已过期')
  expect(button('确认添加项目')).toBeUndefined()
}))

it('accepts browser files above the old 32 MiB threshold but rejects files beyond the disk spool cap', () => modal(async requests => {
  requests.mockResolvedValueOnce(json(previewBody))
  const file = new File([new Uint8Array(33 * 1024 * 1024)], 'streamed.zip', { type: 'application/zip' })
  pick(file)
  expect(button('预览恢复')?.disabled).toBe(false)
  await act(async () => button('预览恢复')!.click())
  expect(requests.mock.calls[0][1].body.get('file')).toBe(file)
  expect(document.body.textContent).toContain('预览未写入项目数据')

  const oversized = new File(['size metadata only'], 'oversized.zip', { type: 'application/zip' })
  Object.defineProperty(oversized, 'size', { value: 513 * 1024 * 1024 })
  pick(oversized)
  expect(button('预览恢复')?.disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('512 MiB')
  expect(requests).toHaveBeenCalledTimes(1)
}))

it('shows planned and confirmed history separately from unsupported files', () => modal(async requests => {
  const key = 'example/100-fixture'
  requests.mockResolvedValueOnce(json({ ...previewBody, plan: {
    ...previewBody.plan, versions: { add: [key], skip: ['other/200-fixture'] },
  } })).mockResolvedValueOnce(json({
    projects: { restored: ['example'], skipped: [], failed: [], unsupported: [] },
    versions: { restored: [key], skipped: [], failed: [] },
    unsupported: [],
  }))
  pick('history.zip')
  await act(async () => button('预览恢复')!.click())
  expect(document.body.textContent).toContain('可添加的历史版本（1）')
  expect(document.body.textContent).toContain('将跳过的历史版本（1）')
  await act(async () => button('确认添加项目')!.click())
  expect(document.body.textContent).toContain('新增历史版本（1）')
  expect(document.body.textContent).toContain(key)
  expect(document.body.textContent).not.toContain('将跳过的历史版本')
}))

it('restores style-only selections, refreshes themes/templates and renders per-category partial results', () => modal(async requests => {
  const plan = { add: ['fixture'], alreadyPresent: [], conflicts: [] }
  requests.mockResolvedValueOnce(json({ ...previewBody, plan: {
    projects: { add: [], skip: [], unsupported: [] }, unsupported: [],
    design: { themes: plan, templates: { ...plan, unresolved: [] } },
  }})).mockResolvedValueOnce(json({
    projects: { restored: [], skipped: [], failed: [], unsupported: [] }, unsupported: [],
    design: {
      themes: { restored: ['custom'], alreadyPresent: [], conflicts: [], failed: [] },
      templates: { restored: ['good'], alreadyPresent: [], conflicts: ['occupied'], failed: [], unresolved: ['bad'] },
    },
  }))
  const refresh = vi.fn()
  window.addEventListener('templates-changed', refresh)
  try {
    pick('design.zip')
    const options = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('同时恢复简单模板和自定义主题'))
    act(() => options?.querySelector('input')?.click())
    await act(async () => button('预览恢复')!.click())
    expect(requests.mock.calls[0][0]).toBe('/api/data/restore?design=1')
    expect(document.body.textContent).toContain('可添加的主题（1）')
    expect(document.body.textContent).toContain('可添加的模板（1）')
    expect(button('确认添加所选数据')?.disabled).toBe(false)
    await act(async () => button('确认添加所选数据')!.click())
    expect(document.body.textContent).toContain('新增主题（1）')
    expect(document.body.textContent).toContain('冲突，未覆盖的模板（1）')
    expect(document.body.textContent).toContain('缺少匹配主题或图片的模板（1）')
    expect(refresh).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('templates-changed', refresh) }
}))

it('keeps component-only opt-in and confirmation separate, and refreshes only restored entries', () => modal(async requests => {
  requests.mockResolvedValueOnce(json({ ...previewBody, plan: {
    projects: { add: [], skip: [], unsupported: [] }, unsupported: [],
    components: { add: ['archived'], alreadyPresent: [], conflicts: [], unresolved: ['missing'] },
  }})).mockResolvedValueOnce(json({
    projects: { restored: [], skipped: [], failed: [], unsupported: [] }, unsupported: [],
    components: { restored: ['archived'], alreadyPresent: [], conflicts: ['later'], unresolved: ['missing'], failed: [] },
  }))
  const refresh = vi.fn()
  window.addEventListener('components-changed', refresh)
  try {
    pick('components.zip')
    const option = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('同时恢复简单原文组件及引用图片'))
    expect(option).toBeDefined()
    act(() => option?.querySelector('input')?.click())
    await act(async () => button('预览恢复')!.click())
    expect(requests.mock.calls[0][0]).toBe('/api/data/restore?components=1')
    expect(document.body.textContent).toContain('可添加的组件（1）')
    expect(document.body.textContent).toContain('缺少匹配图片的组件（1）')
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => button('确认添加所选数据')!.click())
    expect(document.body.textContent).toContain('新增组件（1）')
    expect(document.body.textContent).toContain('冲突，未覆盖的组件（1）')
    expect(refresh).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('components-changed', refresh) }
}))

it('opts in separately for an asset-only archive, then disables confirmation for identical repeats', () => modal(async requests => {
  const asset = 'asset-only'
  const assetPlan = (add: string[], alreadyPresent: string[]) => ({
    token: previewBody.token,
    plan: { projects: { add: [], skip: [], unsupported: [] }, assets: { add, skip: [], alreadyPresent }, unsupported: [] },
  })
  requests.mockResolvedValueOnce(json(assetPlan([asset], []))).mockResolvedValueOnce(json({
    projects: { restored: [], skipped: [], failed: [], unsupported: [] },
    assets: { restored: [asset], skipped: [], failed: [], alreadyPresent: [] }, unsupported: [],
  })).mockResolvedValueOnce(json(assetPlan([], [asset])))
  const event = vi.fn()
  window.addEventListener('assets-changed', event)
  try {
    pick('actual-assets-only.zip')
    const option = [...document.querySelectorAll('label')]
      .find(label => label.textContent?.includes('独立恢复素材库'))!.querySelector<HTMLInputElement>('input')!
    expect(option.checked).toBe(false)
    await act(async () => option.click())
    expect(requests).not.toHaveBeenCalled()
    await act(async () => button('预览恢复')!.click())
    expect(requests.mock.calls[0][0]).toBe('/api/data/restore?standaloneImages=1')
    expect(button('确认添加所选数据')?.disabled).toBe(false)
    await act(async () => button('确认添加所选数据')!.click())
    expect(event).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('新增 1 张素材图片')
    await act(async () => button('预览恢复')!.click())
    expect(document.body.textContent).toContain('已有相同图片（1）')
    expect(button('确认添加所选数据')?.disabled).toBe(true)
    await act(async () => button('确认添加所选数据')!.click())
    expect(requests).toHaveBeenCalledTimes(3)
  } finally { window.removeEventListener('assets-changed', event) }
}))
