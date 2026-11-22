// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { loadCustomThemes } from '../../src/editor/store'
import { LegacyDirectoryMigrationPanel } from '../../src/editor/LegacyDirectoryMigrationPanel'

vi.mock('../../src/editor/store', () => ({ loadCustomThemes: vi.fn().mockResolvedValue(undefined) }))

const token = 'a'.repeat(64)
const endpoint = '/api/data/migrate'
const preview = { token, plan: { sourceLayout: 'checkout', add: 1, skip: 2, unsupported: 3, invalid: 4, ignored: 5 } }
const json = (input: unknown, status = 200) => new Response(JSON.stringify(input), { status })

async function mounted(body: (fetchMock: ReturnType<typeof vi.fn>, host: HTMLElement) => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<LegacyDirectoryMigrationPanel />))
    await body(fetchMock, host)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
}
const click = async (host: HTMLElement, label: string) => act(async () => {
  const button = [...host.querySelectorAll('button')].find(value => value.textContent === label)
  expect(button).toBeDefined()
  button!.click()
})

it('keeps detection read-only, allows cancelling, then publishes an exact result only on explicit confirmation', () => mounted(async (request, host) => {
  expect(request).not.toHaveBeenCalled()
  request.mockResolvedValueOnce(json(preview)).mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json(preview)).mockResolvedValueOnce(json({ restored: 1, skipped: 2, failed: 1, unsupported: 3, invalid: 4, ignored: 5 }))
  const changed = vi.fn()
  window.addEventListener('projects-changed', changed)
  try {
    await click(host, '检测已配置旧目录')
    expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: '{}' }))
    expect(host.textContent).toContain('尚未写入。预计新增 1')
    await click(host, '取消目录迁移')
    expect(request).toHaveBeenNthCalledWith(2, endpoint + '/' + token + '/cancel', expect.objectContaining({ body: '{}' }))
    expect(changed).not.toHaveBeenCalled()
    await click(host, '检测已配置旧目录')
    await click(host, '确认迁移项目')
    expect(request).toHaveBeenNthCalledWith(4, endpoint + '/' + token + '/apply', expect.objectContaining({ body: '{"confirm":true}' }))
    expect(host.textContent).toContain('已新增 1，跳过 2，失败 1')
    expect(changed).toHaveBeenCalledTimes(1)
  } finally {
    window.removeEventListener('projects-changed', changed)
  }
}))

it('explains unconfigured launches, invalid replies and stale snapshots without implying success', () => mounted(async (request, host) => {
  request.mockResolvedValueOnce(json({}, 404))
    .mockResolvedValueOnce(json({ token: 'not a token' }))
    .mockResolvedValueOnce(json({ ...preview, plan: { ...preview.plan, invalid: null } }))
    .mockResolvedValueOnce(json(preview))
    .mockResolvedValueOnce(json({ error: '旧版目录已更改' }, 409))
  for (const expected of ['没有启用本机目录迁移', '迁移预览格式无效', '迁移结果格式无效']) {
    await click(host, '检测已配置旧目录')
    expect(host.getAttribute('role')).toBeNull()
    expect(host.querySelector('[role=alert]')?.textContent).toContain(expected)
  }
  await click(host, '检测已配置旧目录')
  await click(host, '确认迁移项目')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('旧版目录已更改')
  expect(host.textContent).not.toContain('已新增')
}))

it('does not offer apply with an empty plan; failed cancellation does not report the session ended', () => mounted(async (request, host) => {
  request.mockResolvedValueOnce(json({ ...preview, plan: { ...preview.plan, add: 0 } }))
    .mockResolvedValueOnce(json({}, 500))
    .mockResolvedValueOnce(json({}, 404))
  await click(host, '检测已配置旧目录')
  expect([...host.querySelectorAll('button')].find(btn => btn.textContent === '确认迁移项目')?.disabled).toBe(true)
  await click(host, '取消目录迁移')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('本机迁移请求未完成')
  expect(host.textContent).toContain('尚未写入')
  await click(host, '取消目录迁移')
  expect(host.textContent).not.toContain('尚未写入')
  expect(host.textContent).not.toContain('已新增')
}))

it('discards a still-unused server session when the dialog is closed', async () => {
  let calls: unknown[][] = []
  await mounted(async (request, host) => {
    calls = request.mock.calls
    request.mockResolvedValueOnce(json(preview)).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await click(host, '检测已配置旧目录')
  })
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual([endpoint + '/' + token + '/cancel', expect.objectContaining({ body: '{}', keepalive: true })])
})

it('distinguishes linked version counts from manuscript counts', () => mounted(async (request, host) => {
  request.mockResolvedValueOnce(json({ ...preview, plan: { ...preview.plan, versions: { add: 4, skip: 2, unsupported: 1 } } }))
    .mockResolvedValueOnce(json({
      restored: 1, skipped: 0, failed: 0, unsupported: 0, invalid: 0, ignored: 0,
      versions: { restored: 2, skipped: 3, failed: 1, unsupported: 1 },
    }))
  await click(host, '检测已配置旧目录')
  expect(host.querySelector('[role=status]')?.textContent).toContain('历史版本预计新增 4，跳过 2，不支持 1')
  await click(host, '确认迁移项目')
  expect(host.querySelector('[role=status]')?.textContent).toContain('历史版本已新增 2，跳过 3，失败 1，不支持 1')
}))

it('allows a history-only directory confirmation without rewriting the retained project', () => mounted(async (request, host) => {
  request.mockResolvedValueOnce(json({ ...preview, plan: {
    ...preview.plan, add: 0, versions: { add: 1, skip: 0, unsupported: 0 },
  } })).mockResolvedValueOnce(json({
    restored: 0, skipped: 1, failed: 0, unsupported: 0, invalid: 0, ignored: 0,
    versions: { restored: 1, skipped: 0, failed: 0, unsupported: 0 },
  }))
  await click(host, '检测已配置旧目录')
  expect([...host.querySelectorAll('button')].find(btn => btn.textContent === '确认迁移历史版本')?.disabled).toBe(false)
  await click(host, '确认迁移历史版本')
  expect(host.querySelector('[role=status]')?.textContent).toContain('历史版本已新增 1')
}))

it('requires an explicit opt-in and confirms an image-only plan', () => mounted(async (request, host) => {
  request.mockResolvedValueOnce(json({
    ...preview, plan: { ...preview.plan, add: 0, assets: { add: 1, skip: 0, alreadyPresent: 0 } },
  })).mockResolvedValueOnce(json({
    restored: 0, skipped: 0, failed: 0, unsupported: 0, invalid: 0, ignored: 0,
    assets: { restored: 1, skipped: 0, failed: 0, alreadyPresent: 0 },
  }))
  const option = host.querySelector<HTMLInputElement>('input[type=checkbox]')
  expect(option?.checked).toBe(false)
  act(() => option!.click())
  await click(host, '检测已配置旧目录')
  expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: '{"standaloneImages":true}' }))
  expect(host.querySelector('[role=status]')?.textContent).toContain('独立素材预计新增 1')
  expect(option?.disabled).toBe(true)
  const changed = vi.fn()
  window.addEventListener('assets-changed', changed)
  try {
    await click(host, '确认迁移素材')
    expect(host.querySelector('[role=status]')?.textContent).toContain('独立素材已新增 1')
    expect(changed).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('assets-changed', changed) }
}))

it('requires explicit design consent and confirms zero-project theme, template and component data', () => mounted(async (request, host) => {
  const pending = { add: 1, conflicts: 0, alreadyPresent: 0, unresolved: 0 }
  const done = { restored: 1, conflicts: 0, alreadyPresent: 0, unresolved: 0, failed: 0 }
  request.mockResolvedValueOnce(json({ ...preview, plan: { ...preview.plan, add: 0, design: {
    themes: pending, templates: pending, components: pending,
  } } })).mockResolvedValueOnce(json({
    restored: 0, skipped: 0, failed: 0, unsupported: 0, invalid: 0, ignored: 0,
    design: { themes: done, templates: done, components: done },
  }))
  const opted = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('迁移旧目录中支持的主题、模板和组件'))
    ?.querySelector<HTMLInputElement>('input')
  expect(opted?.checked).toBe(false)
  act(() => opted!.click())
  await click(host, '检测已配置旧目录')
  expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: '{"designRecords":true}' }))
  expect(host.querySelector('[role=status]')?.textContent).toContain('主题预计新增 1')
  expect(host.querySelector('[role=status]')?.textContent).toContain('模板预计新增 1')
  expect(host.querySelector('[role=status]')?.textContent).toContain('组件预计新增 1')
  await click(host, '确认迁移所选数据')
  for (const group of ['主题', '模板', '组件']) expect(host.querySelector('[role=status]')?.textContent).toContain(group + '已新增 1')
}))

it('refreshes a matching local theme before announcing migrated projects', () => mounted(async (request, host) => {
  const done = { restored: 0, conflicts: 0, alreadyPresent: 0, unresolved: 0, failed: 0 }
  request.mockResolvedValueOnce(json(preview)).mockResolvedValueOnce(json({
    restored: 1, skipped: 0, failed: 0, unsupported: 0, invalid: 0, ignored: 0,
    design: { themes: { ...done, alreadyPresent: 1 }, templates: done, components: done },
  }))
  const order: string[] = []
  vi.mocked(loadCustomThemes).mockImplementationOnce(async () => { await Promise.resolve(); order.push('theme') })
  const changed = () => { order.push('projects') }
  window.addEventListener('projects-changed', changed)
  try {
    await click(host, '检测已配置旧目录')
    await click(host, '确认迁移项目')
    expect(order).toEqual(['theme', 'projects'])
  } finally {
    vi.mocked(loadCustomThemes).mockReset().mockResolvedValue(undefined)
    window.removeEventListener('projects-changed', changed)
  }
}))
