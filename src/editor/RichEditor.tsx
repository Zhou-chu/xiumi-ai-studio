import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useId, useRef, useState } from 'react'
import { TEXT_FONTS, TEXT_SIZES } from '../core/textTypography'
import { toHex } from '../core/color'
import './text-typography.css'
import type { RichText, Theme } from '../core/types'

const MIXED_FORMAT = '__mixed__'
const COMMON_TEXT_COLORS = [
  ['黑色', '#000000'], ['深灰', '#3f3f3f'], ['浅灰', '#888888'], ['白色', '#ffffff'],
  ['红色', '#c0392b'], ['橙色', '#e67e22'], ['金色', '#d4a017'], ['绿色', '#27ae60'],
  ['蓝色', '#2e86de'], ['深蓝', '#1f3a93'], ['紫色', '#8e44ad'], ['粉色', '#e84393'],
] as const

interface QuickColorsProps {
  id: string
  theme: Theme
  active: string
  onChoose: (color: string) => void
}

function QuickColors({ id, theme, active, onChoose }: QuickColorsProps) {
  const { primary, accent, text, muted } = theme.colors
  const groups = [
    ['主题色', [['主题主色', primary], ['主题强调色', accent], ['主题正文色', text], ['主题次要文字色', muted]]],
    ['常用色', COMMON_TEXT_COLORS],
  ] as const
  return <div id={id} className="rich-color-palette">
    {groups.map(([group, swatches]) => <div key={group} role="group" aria-label={group} className="rich-color-group">
      <span>{group}</span>
      {swatches.map(([label, color]) => <button key={label} type="button" title={label} aria-label={label}
        aria-pressed={toHex(color) === active} onMouseDown={e => e.preventDefault()} onClick={() => onChoose(color)}>
        <span aria-hidden="true" style={{ backgroundColor: color }} />
      </button>)}
    </div>)}
  </div>
}

function typographyState(editor: Editor | null) {
  const active = editor?.getAttributes('textStyle')
  const original = {
    fontFamily: typeof active?.fontFamily === 'string' ? active.fontFamily : '',
    fontSize: typeof active?.fontSize === 'string' ? active.fontSize : '',
    mixedFamily: false,
    mixedSize: false,
  }
  if (!editor || editor.state.selection.empty) return original
  const families = new Set<string>()
  const sizes = new Set<string>()
  for (const { $from, $to } of editor.state.selection.ranges) {
    editor.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isText || pos >= $to.pos || pos + node.nodeSize <= $from.pos) return
      const attrs = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs
      // Unmarked text follows the template and is a distinct selection value.
      families.add(typeof attrs?.fontFamily === 'string' ? attrs.fontFamily : '')
      sizes.add(typeof attrs?.fontSize === 'string' ? attrs.fontSize : '')
    })
  }
  return {
    fontFamily: families.values().next().value ?? original.fontFamily,
    fontSize: sizes.values().next().value ?? original.fontSize,
    mixedFamily: families.size > 1,
    mixedSize: sizes.size > 1,
  }
}

interface Props {
  value: RichText
  theme: Theme
  onChange: (v: RichText) => void
  onDone: () => void
  fontSize?: number
}

/** 正文模块的就地富文本编辑器（tiptap），以结构化 JSON 存储 */
export function RichEditor({ value, theme, onChange, onDone, fontSize }: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteId = useId()
  const paletteButton = useRef<HTMLButtonElement>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false } }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: value,
    autofocus: 'end',
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichText),
    editorProps: {
      handleKeyDown: (_v, e) => {
        if (e.key === 'Escape') {
          onDone()
          return true
        }
        return false
      },
    },
  })
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...typographyState(e),
      empty: e?.state.selection.empty ?? true,
      color: e?.getAttributes('textStyle').color ?? '#222222',
      align: ['left', 'center', 'right', 'justify'].find((textAlign) => e?.isActive({ textAlign })) ?? 'justify',
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      highlight: e?.isActive('highlight') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      link: e?.isActive('link') ?? false,
    }),
  })
  useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return null
  const c = theme.colors
  const btn = (label: string, active: boolean, run: () => void, title: string) => (
    <button type="button" className={active ? 'on' : ''} title={title} aria-label={title} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  )
  const chain = () => editor.chain().focus()
  return (
    <div className="rich-editor" onClick={(e) => e.stopPropagation()} onKeyDownCapture={e => {
      if (e.key !== 'Escape' || !paletteOpen) return
      e.preventDefault()
      e.stopPropagation()
      setPaletteOpen(false)
      paletteButton.current?.focus()
    }}>
      <div className="rich-toolbar" onKeyDown={(e) => e.stopPropagation()}>
        <label className="text-font-control">字体
          <select aria-label="正文字体" value={st?.mixedFamily ? MIXED_FORMAT : st?.fontFamily ?? ''} onChange={(e) => {
            const value = e.target.value
            if (value !== MIXED_FORMAT) (value ? editor.chain().setFontFamily(value) : editor.chain().unsetFontFamily()).run()
          }}>
            <option value="">跟随模板</option>
            {st?.mixedFamily && <option value={MIXED_FORMAT} disabled>混合格式</option>}
            {!st?.mixedFamily && st?.fontFamily && !TEXT_FONTS.some(f => f.value === st.fontFamily) && <option value={st.fontFamily}>原字体</option>}
            {TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label className="text-font-control">字号
          <select aria-label="正文字号" value={st?.mixedSize ? MIXED_FORMAT : st?.fontSize ?? ''} onChange={(e) => {
            const value = e.target.value
            if (value !== MIXED_FORMAT) (value ? editor.chain().setFontSize(value) : editor.chain().unsetFontSize()).run()
          }}>
            <option value="">模板字号</option>
            {st?.mixedSize && <option value={MIXED_FORMAT} disabled>混合格式</option>}
            {!st?.mixedSize && st?.fontSize && !TEXT_SIZES.some(n => `${n}px` === st.fontSize) && <option value={st.fontSize}>{st.fontSize}</option>}
            {TEXT_SIZES.map(n => <option key={n} value={`${n}px`}>{n}px</option>)}
          </select>
        </label>
        <span className="text-font-hint">{st?.empty ? '未选中文字：应用于随后输入' : '仅调整选中文字'}</span>
        <span className="sep" />
        <label className="text-font-control">文字颜色<input type="color" aria-label="正文文字颜色" value={toHex(st?.color ?? '') ?? '#222222'} onChange={e => editor.chain().setColor(e.target.value).run()} /></label>
        {btn('默认色', false, () => chain().unsetColor().run(), '恢复默认文字颜色')}
        <button ref={paletteButton} type="button" aria-label="预设文字颜色" aria-expanded={paletteOpen}
          aria-controls={paletteOpen ? paletteId : undefined} onMouseDown={e => e.preventDefault()}
          onClick={() => setPaletteOpen(open => !open)}>色板</button>
        {paletteOpen && <QuickColors id={paletteId} theme={theme} active={toHex(st?.color ?? '') ?? ''}
          onChoose={color => { chain().setColor(color).run(); setPaletteOpen(false) }} />}
        {btn('B', st?.bold ?? false, () => chain().toggleBold().run(), '加粗（主题色）')}
        {btn('I', st?.italic ?? false, () => chain().toggleItalic().run(), '斜体')}
        {btn('U', st?.underline ?? false, () => chain().toggleUnderline().run(), '下划线')}
        {btn('高亮', st?.highlight ?? false, () => chain().toggleHighlight({ color: c.primarySoft }).run(), '背景高亮')}
        {btn('主色', false, () => chain().setColor(c.primary).run(), '文字设为主题色')}
        {btn('强调色', false, () => chain().setColor(c.accent).run(), '文字设为强调色')}
        {btn('清除', false, () => chain().unsetAllMarks().run(), '清除格式')}
        <span className="sep" />
        {btn('• 列表', st?.bullet ?? false, () => chain().toggleBulletList().run(), '无序列表')}
        {btn('1. 列表', st?.ordered ?? false, () => chain().toggleOrderedList().run(), '有序列表')}
        {([['left', '左对齐'], ['center', '居中'], ['right', '右对齐'], ['justify', '两端对齐']] as const).map(([align, label]) => (
          <span key={align}>{btn(label, st?.align === align, () => chain().setTextAlign(align).run(), label)}</span>
        ))}
        {btn('链接', st?.link ?? false, () => {
          if (editor.isActive('link')) return chain().unsetLink().run()
          const href = prompt('链接地址（非公众号文章链接在微信中会转为文字）')
          if (href) chain().setLink({ href }).run()
        }, '链接')}
        <span className="sep" />
        <button type="button" className="done" onMouseDown={(e) => e.preventDefault()} onClick={onDone}>完成</button>
      </div>
      <EditorContent
        editor={editor}
        className="rich-content"
        style={{ fontSize: fontSize ?? theme.fontSize, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, color: c.text, ['--strong' as string]: c.primary, ['--gap' as string]: `${theme.paragraphSpacing}px` }}
      />
    </div>
  )
}
