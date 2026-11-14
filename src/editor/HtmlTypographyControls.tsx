import { useEffect, useRef, useState, type RefObject } from 'react'
import { TEXT_FONTS, TEXT_SIZES } from '../core/textTypography'
import { canStyleSelection, styledSelectionHtml } from './selectedTextStyle'
import { ColorPicker } from './ColorPicker'
import { safeColor } from '../core/style'
import type { Theme } from '../core/types'
import './html-typography.css'

/** Native HTML editing keeps its browser undo stack; toolbar focus must not discard the selection. */
export function HtmlTypographyControls({ rootRef, onCommit, theme }: { rootRef: RefObject<HTMLDivElement | null>; onCommit: () => void; theme: Theme }) {
  const saved = useRef<{ range: Range; html: string; start: Node; end: Node } | null>(null)
  const [available, setAvailable] = useState(false)
  const [marks, setMarks] = useState<Record<string, boolean | 'mixed'>>({})
  const readMarks = () => setMarks(Object.fromEntries(['bold', 'italic', 'underline'].map(command => [command, typeof document.queryCommandIndeterm === 'function' && document.queryCommandIndeterm(command) ? 'mixed' : typeof document.queryCommandState === 'function' && document.queryCommandState(command)])))
  const [message, setMessage] = useState('先选中原文中的文字')
  useEffect(() => {
    const capture = () => {
      const root = rootRef.current
      const selection = document.getSelection()
      if (!root || !selection?.rangeCount) { saved.current = null; setAvailable(false); return }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        if (!document.activeElement?.closest('.html-typography-controls')) { saved.current = null; setAvailable(false); setMessage('先选中原文中的文字') }
        return
      }
      const valid = !range.collapsed && !!range.toString()
      saved.current = valid ? { range: range.cloneRange(), html: root.innerHTML, start: range.startContainer, end: range.endContainer } : null
      setAvailable(valid)
      readMarks()
      setMessage(valid ? '仅调整选中文字' : '先选中原文中的文字')
    }
    document.addEventListener('selectionchange', capture)
    return () => document.removeEventListener('selectionchange', capture)
  }, [rootRef])
  const apply = (property: 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'foreColor', value = '') => {
    const root = rootRef.current
    const snapshot = saved.current
    if (!root || !root.isConnected || !snapshot || !root.contains(snapshot.start) || !root.contains(snapshot.end) || root.innerHTML !== snapshot.html) { setMessage('选区已变化，请重新选择文字'); setAvailable(false); return }
    const native = property !== 'fontFamily' && property !== 'fontSize'
    if (!canStyleSelection(root, snapshot.range)) {
      setMessage('请在同一个文本区域内选择，避免修改表格或图形结构'); return
    }
    if (property === 'foreColor') {
      const color = safeColor(value)
      if (!color) return
      value = color
    }
    const html = native ? null : styledSelectionHtml(root, snapshot.range, property, value)
    if (!native && !html) return
    const prefix = document.createRange()
    prefix.selectNodeContents(root); prefix.setEnd(snapshot.range.startContainer, snapshot.range.startOffset)
    const start = prefix.toString().length, length = snapshot.range.toString().length
    root.focus()
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(snapshot.range)
    // insertHTML participates in the native contentEditable undo stack, unlike direct DOM replacement.
    if (typeof document.execCommand !== 'function' || !document.execCommand(native ? property : 'insertHTML', false, native ? value : html!)) { setMessage('此浏览器不支持该文字格式操作'); return }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const point = (offset: number): [Node, number] => {
      for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length }
      return [root, root.childNodes.length]
    }
    const restored = document.createRange()
    restored.setStart(...point(start)); restored.setEnd(...point(start + length))
    selection.removeAllRanges(); selection.addRange(restored)
    onCommit()
    saved.current = { range: restored.cloneRange(), html: root.innerHTML, start: restored.startContainer, end: restored.endContainer }
    setAvailable(true)
    readMarks()
    setMessage('已应用，可继续调整选中文字或撤销')
  }
  return <span className="html-typography-controls" onKeyDown={e => e.stopPropagation()}>
    <label className="text-font-control">字体<select aria-label="原文字体" disabled={!available} value="" onChange={e => { apply('fontFamily', e.target.value); e.currentTarget.focus() }}>
      <option value="">选择字体</option>{TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
    </select></label>
    <label className="text-font-control">字号<select aria-label="原文字号" disabled={!available} value="" onChange={e => { apply('fontSize', e.target.value); e.currentTarget.focus() }}>
      <option value="">选择字号</option>{TEXT_SIZES.map(n => <option key={n} value={`${n}px`}>{n}px</option>)}
    </select></label>
    {([['bold', 'B', '加粗'], ['italic', 'I', '斜体'], ['underline', 'U', '下划线']] as const).map(([command, label, name]) =>
      <button type="button" key={command} aria-label={`原文${name}`} title={name} aria-pressed={marks[command] ?? false} className={marks[command] === true ? 'on' : ''} disabled={!available} onMouseDown={e => e.preventDefault()} onClick={e => { apply(command); e.currentTarget.focus() }}>{label}</button>)}
    <fieldset className="html-color-control" disabled={!available} aria-label="选中文字颜色">
      <ColorPicker groups={[{ label: '主题色', colors: [{ color: theme.colors.primary, label: '主色' }, { color: theme.colors.accent, label: '强调色' }, { color: theme.colors.text, label: '正文色' }] }]}
        onPick={color => apply('foreColor', color ?? theme.colors.text)} testId="html-text-color" resetLabel="使用当前模板正文色" />
    </fieldset>
    <span className="text-font-hint" role="status">{message}</span>
  </span>
}
