// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { HtmlTypographyControls } from '../../src/editor/HtmlTypographyControls'
import { THEMES } from '../../src/core/themes'
vi.mock('../../src/editor/ColorPicker', () => ({
  ColorPicker: ({ onPick }: { onPick: (color: string | undefined) => void }) => createElement('button', { type: 'button', onClick: () => onPick(undefined) }, 'fixture color reset'),
}))
const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.unstubAllGlobals() })
function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'), editor = document.createElement('div')
  editor.contentEditable = 'true'; editor.tabIndex = 0; editor.textContent = 'Author text'
  document.body.append(editor, host)
  const root = createRoot(host), onCommit = vi.fn(), command = vi.fn<(_name: string, _show: boolean, _value: string) => boolean>(() => true)
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command })
  cleanups.push(() => { if (original) Object.defineProperty(document, 'execCommand', original); else Reflect.deleteProperty(document, 'execCommand') })
  cleanups.push(() => { act(() => root.unmount()); host.remove(); editor.remove(); document.getSelection()?.removeAllRanges() })
  const rootRef: { current: HTMLDivElement | null } = { current: editor }
  act(() => root.render(createElement(HtmlTypographyControls, { rootRef, onCommit, theme: THEMES[0] })))
  const capture = (node: Node, from: number, to: number) => act(() => {
    const range = document.createRange(); range.setStart(node, from); range.setEnd(node, to)
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  return { host, editor, rootRef, onCommit, command, capture }
}
it('rejects the old selection after editor identity changes, even when markup and text match', () => {
  const { host, editor, rootRef, command, onCommit, capture } = fixture()
  capture(editor.firstChild!, 0, 6)
  const replacement = editor.cloneNode(true) as HTMLDivElement
  document.body.append(replacement); cleanups.unshift(() => replacement.remove())
  rootRef.current = replacement
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="原文加粗"]')!.click())
  expect(command).not.toHaveBeenCalled()
  expect(onCommit).not.toHaveBeenCalled()
  expect(host.querySelector('[role=status]')?.textContent).toContain('选区已变化')
})
it('delegates reset to an explicit document color and preserves selection for its caller', () => {
  const { host, editor, command, onCommit, capture } = fixture()
  capture(editor.firstChild!, 0, 6)
  onCommit.mockImplementation(() => expect(document.getSelection()?.toString()).toBe('Author'))
  const reset = host.querySelector<HTMLButtonElement>('fieldset button')!
  act(() => reset.click())
  expect(command).toHaveBeenCalledExactlyOnceWith('foreColor', false, THEMES[0].colors.text)
  expect(onCommit).toHaveBeenCalledOnce()
})
it('does not commit when the selected native command reports unsupported', () => {
  const { host, editor, command, onCommit, capture } = fixture()
  capture(editor.firstChild!, 0, 3)
  command.mockReturnValueOnce(false)
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="原文下划线"]')!.click())
  expect(command).toHaveBeenCalledExactlyOnceWith('underline', false, '')
  expect(onCommit).not.toHaveBeenCalled()
  expect(host.querySelector('[role=status]')?.textContent).toContain('不支持')
})
it('formats only the current selected text and delegates actual markup to native history', () => {
  const { host, editor, command, onCommit, capture } = fixture()
  capture(editor.firstChild!, 0, 6)
  capture(editor.firstChild!, 7, 11)
  const control = host.querySelector<HTMLSelectElement>('[aria-label="原文字号"]')!
  act(() => {
    control.value = '20px'
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(command).toHaveBeenCalledExactlyOnceWith('insertHTML', false, expect.any(String))
  const payload = new DOMParser().parseFromString(command.mock.calls[0][2], 'text/html')
  expect(payload.body.textContent).toBe('text')
  expect(payload.querySelector('span')?.textContent).toBe('text')
  expect(payload.querySelector('span')?.style.fontSize).toBe('20px')
  expect(editor.textContent).toBe('Author text')
  expect(onCommit).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(control)
})

const setDocumentMethod = (name: string, value: unknown) => {
  const previous = Object.getOwnPropertyDescriptor(document, name)
  Object.defineProperty(document, name, { configurable: true, value })
  cleanups.push(() => {
    if (previous) Object.defineProperty(document, name, previous)
    else Reflect.deleteProperty(document, name)
  })
}

it('renders mixed and on mark states from browser receipts, then clears controls for a collapsed selection', () => {
  const { host, editor, capture } = fixture()
  const mask = vi.fn((key: string) => key === 'bold'), state = vi.fn((key: string) => key === 'italic')
  setDocumentMethod('queryCommandIndeterm', mask)
  setDocumentMethod('queryCommandState', state)
  capture(editor.firstChild!, 0, 6)
  const bold = host.querySelector<HTMLButtonElement>('[aria-label="原文加粗"]')!
  const italic = host.querySelector<HTMLButtonElement>('[aria-label="原文斜体"]')!
  const underline = host.querySelector<HTMLButtonElement>('[aria-label="原文下划线"]')!
  expect([bold, italic, underline].map(button => button.getAttribute('aria-pressed'))).toEqual(['mixed', 'true', 'false'])
  expect(state).not.toHaveBeenCalledWith('bold')
  capture(editor.firstChild!, 1, 1)
  expect(bold.disabled).toBe(true)
  expect(host.querySelector('[role=status]')?.textContent).toContain('先选中')
})

it('keeps a saved range during toolbar focus but requires reselection after unrelated outside focus', () => {
  const { host, editor, capture, command, onCommit } = fixture()
  capture(editor.firstChild!, 0, 6)
  const outside = document.createElement('button')
  outside.textContent = 'outside'
  document.body.append(outside)
  cleanups.push(() => outside.remove())
  const bold = host.querySelector<HTMLButtonElement>('[aria-label="原文加粗"]')!
  bold.focus()
  capture(outside.firstChild!, 0, 2)
  expect(bold.disabled).toBe(false)
  act(() => bold.click())
  expect(command).toHaveBeenCalledOnce(); expect(onCommit).toHaveBeenCalledOnce()
  outside.focus()
  capture(outside.firstChild!, 0, 2)
  expect(bold.disabled).toBe(true)
  act(() => bold.click())
  expect(command).toHaveBeenCalledOnce()
})

it('refuses a cross-table-cell range before calling native formatting', () => {
  const { host, editor, command, onCommit } = fixture()
  editor.innerHTML = '<table><tbody><tr><td>Left</td><td>Right</td></tr></tbody></table>'
  const left = editor.querySelectorAll('td')[0].firstChild!, right = editor.querySelectorAll('td')[1].firstChild!
  act(() => {
    const range = document.createRange(); range.setStart(left, 1); range.setEnd(right, 2)
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="原文加粗"]')!.click())
  expect(command).not.toHaveBeenCalled(); expect(onCommit).not.toHaveBeenCalled()
  expect(host.querySelector('[role=status]')?.textContent).toContain('避免修改表格')
})

it('restores the original lexical selection across text nodes produced by native command receipts', () => {
  const { host, editor, command, onCommit, capture } = fixture()
  capture(editor.firstChild!, 3, 9)
  command.mockImplementationOnce(() => {
    editor.innerHTML = '<span>Aut</span><i>hor te</i><span>xt</span>'
    return true
  })
  const captured: string[] = []
  onCommit.mockImplementation(() => { captured.push(document.getSelection()?.toString() ?? '') })
  const italic = host.querySelector<HTMLButtonElement>('[aria-label="原文斜体"]')!
  act(() => italic.click())
  expect(document.activeElement).toBe(italic)
  act(() => italic.click())
  expect(onCommit).toHaveBeenCalledTimes(2)
  expect(captured).toEqual(['hor te', 'hor te'])
})

it('reports an unavailable native command without changing the selected text', () => {
  const { host, editor, onCommit, capture } = fixture()
  setDocumentMethod('execCommand', undefined)
  capture(editor.firstChild!, 0, 6)
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="原文加粗"]')!.click())
  expect(onCommit).not.toHaveBeenCalled()
  expect(editor.textContent).toBe('Author text')
  expect(host.querySelector('[role=status]')?.textContent).toContain('不支持')
})
