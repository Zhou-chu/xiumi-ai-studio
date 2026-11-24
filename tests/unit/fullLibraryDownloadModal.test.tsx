// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import ProjectBackupModal from '../../src/editor/ProjectBackupModal'

const state = vi.hoisted(() => ({ status: 'saved' }))
vi.mock('../../src/editor/store', () => ({
  saveNow: vi.fn(),
  useStore: Object.assign((select: (value: { saveStatus: string }) => unknown) => select({ saveStatus: state.status }),
    { getState: () => ({ saveStatus: state.status }) }),
}))

it('offers a separate streamed library download only after the active project is saved', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const close = vi.fn()
  try {
    act(() => root.render(<ProjectBackupModal onClose={close} />))
    const link = document.querySelector<HTMLAnchorElement>('a[href="/api/data/backup"]')
    expect(link?.textContent).toContain('下载整库 ZIP')
    expect(link?.target).toBe('_blank')
    expect(document.body.textContent).toContain('下载 ZIP 备份')
    state.status = 'saving'
    act(() => root.render(<ProjectBackupModal onClose={close} />))
    expect(document.querySelector('a[href="/api/data/backup"]')).toBeNull()
    expect(document.body.textContent).toContain('保存当前文稿后可下载整库')
  } finally {
    act(() => root.unmount())
    host.remove()
    state.status = 'saved'
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  }
})
