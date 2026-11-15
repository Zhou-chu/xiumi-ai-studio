// @vitest-environment jsdom
import { act, createElement, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { textToRich } from '../../src/core/richtext'
import { TEXT_FONTS,TEXT_SIZES } from '../../src/core/textTypography'
import { THEMES } from '../../src/core/themes'
import type { RichText } from '../../src/core/types'

type NodeMock={isText:boolean;nodeSize:number;marks:Array<{type:{name:string};attrs:Record<string,string>} >}
type EditorMock={
  chain:()=>Record<string,unknown>; destroy:()=>void;getJSON:()=>RichText;
  getAttributes:()=>Record<string,string>;isActive:(token:string|{textAlign:string})=>boolean;
  state:{selection:{empty:boolean;ranges:Array<{$from:{pos:number};$to:{pos:number}}>};
    doc:{nodesBetween:(start:number,end:number,cb:(node:NodeMock,pos:number)=>void)=>void}};
}
type EditorOptions={autofocus:string;content:RichText;onUpdate:(value:{editor:EditorMock})=>void;editorProps:{handleKeyDown:(view:unknown,event:KeyboardEvent)=>boolean}}
type ColorOption={label:string;colors:Array<{color:string;label:string}>}
const h=vi.hoisted(()=>({
  editor:null as EditorMock|null, init:null as EditorOptions|null, chooser:vi.fn(),
  destroy:vi.fn(), marks:vi.fn(), getAttributes:vi.fn(), nodes:vi.fn(), json:vi.fn(),
  commands:vi.fn(), prompt:vi.fn(),
}))
vi.mock('@tiptap/react',()=>({
  useEditor:(options:EditorOptions)=>{h.init=options;return h.editor},
  useEditorState:({editor,selector}:{editor:EditorMock|null;selector:(state:{editor:EditorMock|null})=>unknown})=>selector({editor}),
  EditorContent:({style,className}:{style:CSSProperties;className:string})=>createElement('div',{style,className,'data-testid':'tiptap-engine-boundary'}),
}))
vi.mock('../../src/editor/ColorPicker',()=>({
  ColorPicker:({value,groups,onPick}:{value:string|null;groups:ColorOption[];onPick:(color:string|null)=>void})=>{
    h.chooser({value,groups})
    return createElement('div',{},
      createElement('button',{onClick:()=>onPick(groups[0].colors[1].color)},'选择测试颜色'),
      createElement('button',{onClick:()=>onPick(null)},'清除测试颜色'))
  },
}))
import { RichEditor } from '../../src/editor/RichEditor'

const theme=THEMES[0]
const content=textToRich('合成人口文稿')
const onChange=vi.fn(),onDone=vi.fn()
const simpleNode=(style?:Record<string,string>):NodeMock=>({isText:true,nodeSize:4,marks:style?[{type:{name:'textStyle'},attrs:style}]:[]})
let host:HTMLDivElement
let root:Root
const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!
const select=(label:string)=>host.querySelector<HTMLSelectElement>('select[aria-label="'+label+'"]')!
const press=(b:HTMLButtonElement)=>act(()=>b.click())
const choose=(field:HTMLSelectElement,value:string)=>act(()=>{
  field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}))
})
function commands(){
  const chain:Record<string,unknown>={}
  for(const name of ['focus','setFontFamily','unsetFontFamily','setFontSize','unsetFontSize','toggleBold','toggleItalic','toggleUnderline','toggleHighlight','setColor','unsetColor','unsetAllMarks','toggleBulletList','toggleOrderedList','setTextAlign','unsetLink','setLink','run']) {
    chain[name]=(...args:unknown[])=>{h.commands(name,...args);return chain}
  }
  return chain
}
const mount=(fontSize?:number)=>act(()=>root.render(createElement(RichEditor,{value:content,theme,onChange,onDone,fontSize})))

beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Unexpected native request')}))
  vi.stubGlobal('prompt',h.prompt.mockReset().mockImplementation(()=>{throw Error('Unexpected prompt')}))
  for(const f of [h.commands,h.destroy,h.chooser,h.nodes,onChange,onDone])f.mockReset()
  h.marks.mockReset().mockReturnValue(false);h.getAttributes.mockReset().mockReturnValue({});h.json.mockReset().mockReturnValue(content)
  h.editor={chain:commands,destroy:h.destroy,getJSON:h.json,getAttributes:h.getAttributes,isActive:h.marks,
    state:{selection:{empty:true,ranges:[]},doc:{nodesBetween:h.nodes}}}
  h.init=null
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})

it('renders nothing while the editor is unavailable and safe state accepts a null engine',()=>{
  h.editor=null
  mount()
  expect(host.children).toHaveLength(0)
  expect(h.destroy).not.toHaveBeenCalled()
})

it('initializes from structured text, uses the chosen geometry, and forwards JSON change/ordinary Escape',()=>{
  mount(18)
  expect(h.init).toMatchObject({ content,autofocus:'end' })
  expect(host.querySelector<HTMLElement>('.rich-content')?.style.fontSize).toBe('18px')
  expect(host.querySelector<HTMLElement>('.rich-content')?.style.getPropertyValue('--gap')).toBe(theme.paragraphSpacing+'px')
  const changed=textToRich('编辑后的合成内容')
  h.json.mockReturnValueOnce(changed)
  h.init!.onUpdate({editor:h.editor!})
  expect(onChange).toHaveBeenCalledExactlyOnceWith(changed)
  expect(h.init!.editorProps.handleKeyDown(null,new KeyboardEvent('keydown',{key:'a'}))).toBe(false)
  expect(h.init!.editorProps.handleKeyDown(null,new KeyboardEvent('keydown',{key:'Escape'}))).toBe(true)
  expect(onDone).toHaveBeenCalledOnce()
})

it('reports mixed family and size for only the intersecting text ranges',()=>{
  const selection=h.editor!.state.selection
  selection.empty=false;selection.ranges=[{$from:{pos:2},$to:{pos:10}}]
  h.getAttributes.mockReturnValue({fontFamily:'Outside',fontSize:'19px'})
  h.nodes.mockImplementation((start:number,end:number,visit:(node:NodeMock,pos:number)=>void)=>{
    expect([start,end]).toEqual([2,10])
    visit({...simpleNode(),isText:false},3)
    visit(simpleNode({fontFamily:'Boundary before',fontSize:'16px'}),-2)
    visit(simpleNode({fontFamily:'Mixed 1',fontSize:'18px'}),2)
    visit(simpleNode(),6)
    visit(simpleNode({fontFamily:'Boundary after',fontSize:'50px'}),10)
  })
  mount()
  for(const label of ['正文字体','正文字号']){
    const field=select(label)
    expect(field.value).toBe('__mixed__')
    expect(field.querySelector<HTMLOptionElement>('option[value="__mixed__"]')?.disabled).toBe(true)
  }
  expect(host.textContent).toContain('仅调整选中文字')
})

it('shows preserved unknown font values and subsequent-input hint when the range is collapsed',()=>{
  h.getAttributes.mockReturnValue({fontFamily:'Fixture Custom Serif',fontSize:'19.5px'})
  mount()
  expect(select('正文字体').selectedOptions[0].text).toBe('原字体')
  expect(select('正文字号').value).toBe('19.5px')
  expect(host.textContent).toContain('应用于随后输入')
  expect(h.nodes).not.toHaveBeenCalled()
})

it('changes and resets family or size without focusing the engine or stealing current select focus',()=>{
  mount()
  const family=select('正文字体'),size=select('正文字号')
  family.focus()
  choose(family,TEXT_FONTS[0].value)
  expect(document.activeElement).toBe(family)
  choose(family,'')
  size.focus()
  choose(size,`${TEXT_SIZES[0]}px`)
  expect(document.activeElement).toBe(size)
  choose(size,'')
  expect(h.commands.mock.calls).toEqual([
    ['setFontFamily',TEXT_FONTS[0].value],['run'],['unsetFontFamily'],['run'],
    ['setFontSize',`${TEXT_SIZES[0]}px`],['run'],['unsetFontSize'],['run'],
  ])
})

it('reflects active mark state and protects selection on pointerdown before applying B I U and clear',()=>{
  h.marks.mockImplementation(token=>token==='bold'||token==='underline')
  mount()
  expect(button('B').getAttribute('aria-pressed')).toBe('true')
  expect(button('I').getAttribute('aria-pressed')).toBe('false')
  expect(button('U').getAttribute('aria-pressed')).toBe('true')
  const down=new MouseEvent('mousedown',{bubbles:true,cancelable:true})
  act(()=>button('B').dispatchEvent(down))
  expect(down.defaultPrevented).toBe(true)
  for(const label of ['B','I','U','清除'])press(button(label))
  expect(h.commands.mock.calls).toEqual(['toggleBold','toggleItalic','toggleUnderline','unsetAllMarks'].flatMap(cmd=>[['focus'],[cmd],['run']]))
})

it('uses theme-derived color choices, current color and the actual selected-color commands',()=>{
  h.getAttributes.mockReturnValue({color:'#334455'})
  mount()
  expect(h.chooser).toHaveBeenLastCalledWith({value:'#334455',groups:[{label:'主题色',colors:[
    {color:theme.colors.primary,label:'主色'},{color:theme.colors.accent,label:'强调色'},
    {color:theme.colors.text,label:'正文色'},{color:theme.colors.muted,label:'次要文字色'},
  ]}]})
  press(button('选择测试颜色'));press(button('清除测试颜色'))
  expect(h.commands.mock.calls).toEqual([['focus'],['setColor',theme.colors.accent],['run'],['focus'],['unsetColor'],['run']])
})

it('declares list and alignment state and directly routes block alignment/list/highlight controls',()=>{
  h.marks.mockImplementation(token=>token==='bulletList'||(typeof token==='object'&&token.textAlign==='center'))
  mount()
  expect(button('• 列表').getAttribute('aria-pressed')).toBe('true')
  expect(button('居中').getAttribute('aria-pressed')).toBe('true')
  for(const label of ['1. 列表','右对齐','高亮'])press(button(label))
  expect(h.commands.mock.calls).toEqual([
    ['focus'],['toggleOrderedList'],['run'],['focus'],['setTextAlign','right'],['run'],
    ['focus'],['toggleHighlight',{color:theme.colors.primarySoft}],['run'],
  ])
})

it('does not insert a link after cancel and distinguishes adding from removing a current mark',()=>{
  h.prompt.mockReturnValueOnce(null).mockReturnValueOnce('https://fixture.invalid/link')
  mount()
  press(button('链接'));expect(h.commands).not.toHaveBeenCalled()
  press(button('链接'))
  expect(h.commands.mock.calls).toEqual([['focus'],['setLink',{href:'https://fixture.invalid/link'}],['run']])
  h.marks.mockImplementation(token=>token==='link')
  mount(16);press(button('链接'))
  expect(h.prompt).toHaveBeenCalledTimes(2)
  expect(h.commands.mock.calls.slice(-3)).toEqual([['focus'],['unsetLink'],['run']])
})

it('completes editing exactly once and releases its engine on unmount',()=>{
  mount()
  press(button('完成'))
  expect(onDone).toHaveBeenCalledOnce()
  act(()=>root.render(null))
  expect(h.destroy).toHaveBeenCalledOnce()
})
