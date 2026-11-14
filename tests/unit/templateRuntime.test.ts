// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const runtimePath = '../../templates/eea-germany/template-runtime.mjs'
let install: (window: Window) => void
const write = vi.fn()
beforeEach(async () => {
  vi.useFakeTimers()
  write.mockReset().mockResolvedValue(undefined)
  document.body.innerHTML = '<button id="copy-all">Copy all</button><div id="article"><div class="demo" data-name="Module"><button class="copy">Copy</button><div class="stage"><p>Article</p></div></div></div><div id="toast"></div>'
  Object.defineProperty(document.querySelector('.stage'), 'innerText', { configurable: true, value: 'Article' })
  Object.defineProperty(document.getElementById('article'), 'innerText', { configurable: true, value: 'Article' })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
  Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: class { constructor(public data: Record<string, Blob>) {} } })
  install = (await import(runtimePath)).installTemplateInteractions
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
it('copies exactly one module using HTML/plain Clipboard API and clears success timers', async () => {
  install(window)
  const button = document.querySelector<HTMLButtonElement>('.copy')!
  button.click(); await flush()
  expect(write).toHaveBeenCalledTimes(1)
  const item = write.mock.calls[0][0][0]
  expect(item.data['text/html'].type).toBe('text/html')
  expect(item.data['text/plain'].type).toBe('text/plain')
  expect(button.classList.contains('done')).toBe(true)
  expect(document.getElementById('toast')?.classList.contains('show')).toBe(true)
  await vi.advanceTimersByTimeAsync(2700)
  expect(button.classList.contains('done')).toBe(false)
  expect(document.getElementById('toast')?.classList.contains('show')).toBe(false)
})
it('copies all article modules and replaces an existing toast timer', async () => {
  install(window)
  document.getElementById('copy-all')!.click(); await flush()
  document.getElementById('copy-all')!.click(); await flush()
  expect(write).toHaveBeenCalledTimes(2)
  expect(document.getElementById('toast')?.textContent).toContain('1')
})
it.each(['denied', 'insecure'])('falls back through a temporary copy listener when %s', async mode => {
  if (mode === 'denied') write.mockRejectedValue(Error('denied'))
  else Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  const setData = vi.fn()
  const exec = vi.fn(() => {
    const event = new Event('copy', { cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { setData } })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    return true
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  const remove = vi.spyOn(document, 'removeEventListener')
  install(window)
  document.querySelector<HTMLButtonElement>('.copy')!.click(); await flush()
  expect(setData).toHaveBeenCalledWith('text/html', '<p>Article</p>')
  expect(setData).toHaveBeenCalledWith('text/plain', 'Article')
  expect(remove).toHaveBeenCalledWith('copy', expect.any(Function))
})
it.each(['false', 'throw'])('reports unsuccessful fallback (%s) without displaying a copied state', async mode => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => { if (mode === 'throw') throw new Error('Clipboard disabled'); return false } })
  install(window)
  document.querySelector<HTMLButtonElement>('.copy')!.click(); await flush()
  expect(document.querySelector('.copy')?.classList.contains('done')).toBe(false)
  expect(document.getElementById('toast')?.textContent).toContain('Chrome / Edge')
})
