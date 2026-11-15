// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'
import type { Asset } from '../../src/editor/api'
import { ImportWizard } from '../../src/editor/ImportWizard'

type ImportReceipt = { text: string; assets: Asset[] }
type Props = Parameters<typeof ImportWizard>[0]
const h = vi.hoisted(() => ({
  importFile: vi.fn(), upload: vi.fn(), sample: vi.fn(), status: vi.fn(), templates: vi.fn(),
  outline: vi.fn(), design: vi.fn(), enrich: vi.fn(), save: vi.fn(), read: vi.fn(), saveBeforeLeave: vi.fn(), load: vi.fn(), notify: vi.fn(),
  current: null as unknown as Doc, planner: vi.fn(),
}))
vi.mock('../../src/editor/api', () => ({
  api: { importFile: h.importFile, uploadAssets: h.upload, loadSample: h.sample, aiStatus: h.status,
    templates: h.templates, aiOutline: h.outline, aiDesign: h.design, aiEnrichCopy: h.enrich, saveProject: h.save, project: h.read },
  assetRef: (asset: Asset) => ({ src: '/media/' + asset.file, assetId: asset.id }),
}))
vi.mock('../../src/editor/store', () => ({
  useStore: Object.assign((select: (state: { themes: unknown[] }) => unknown) => select({ themes: [] }), { getState: () => ({ doc: h.current, notify: h.notify }) }),
  saveBeforeLeave: h.saveBeforeLeave,
}))
vi.mock('../../src/editor/documentNavigation', () => ({ loadIfUnchanged: h.load }))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
    createElement('section', {}, createElement('button', { 'data-testid': 'close-boundary', onClick: onClose }, 'Close'), children),
}))
vi.mock('../../src/editor/KitPicker', () => ({
  KitPicker: ({ templates }: { templates: Array<{ id: string }> }) => createElement('span', { 'data-testid': 'kit-boundary' }, templates.map(t => t.id).join(',')),
  useComponents: () => [], kitCandidates: () => [], resolveKit: () => ({}), layoutOptions: () => { throw Error('Unexpected kit layout call') },
}))
vi.mock('../../src/editor/PhotoPlanner', () => ({
  PhotoPlanner: (props: { images: Asset[]; text: string; setNotes: (notes: Record<string, string>) => void; setAnchors: (anchors: Record<string, string>) => void }) => {
    h.planner(props)
    return createElement('div', null,
      createElement('span', { 'data-testid': 'photo-boundary' }, props.images.map(a => a.id).join(',')),
      props.images.length ? createElement('button', { 'data-testid': 'photo-note-boundary', onClick: () => {
        props.setNotes({ [props.images[0].id]: '现场机器人展台' })
        props.setAnchors({ [props.images[0].id]: '这里安排照片。' })
      } }, 'Add fixture photo note') : null,
    )
  },
}))
vi.mock('../../src/editor/PlanIssues', () => ({ PlanIssues: () => { throw Error('Unexpected plan workflow') } }))
vi.mock('../../src/editor/Copywriter', () => ({
  Copywriter: ({ onImport }: { onImport: (value: string) => void }) =>
    createElement('button', { 'data-testid': 'copywriter-boundary', onClick: () => onImport('New accepted copywriter text') }, 'Use writing result'),
}))
vi.mock('../../src/core/compiler', () => ({ compileDoc: () => ({ html: '<p>Preview boundary</p>', charCount: 8 }) }))
vi.mock('../../src/core/layouts', () => ({
  RECIPES: [
    { id:'first', name:'First recipe', description:'First', defaultTheme:'theme-one' },
    { id:'second', name:'Second recipe', description:'Second', defaultTheme:'theme-two' },
  ],
  buildDoc: (outline: { title: string }, _refs: unknown, recipe: { id: string }, themeId: string): Doc =>
    ({ id: recipe.id, title: outline.title, blocks: [], themeId, author: '', digest: '', createdAt: 0, updatedAt: 0 }),
}))

let host: HTMLDivElement
let root: Root
const close = vi.fn<() => void>()
const enabled = { enabled: true, profileId: 'fixture', provider:'openai', name:'Fixture', model:'Model' }
const asset = (id: string): Asset => ({ id, file: id + '.jpg', name: id, width: 10, height: 10, size: 10, createdAt: 0 })
const current = (): Doc => ({ id: 'current', title: 'Current draft', blocks: [], themeId:'theme-one', author:'', digest:'', createdAt:0, updatedAt:0 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const by = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!
const press = async (target: HTMLElement) => { expect(target).toBeTruthy(); await act(async () => target.click()) }
const text = () => by<HTMLTextAreaElement>('import-text')
const enter = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text(), value)
  text().dispatchEvent(new Event('input', { bubbles: true }))
})
const select = async (id: string, files: File[]) => {
  const input = by<HTMLInputElement>(id)
  const fileList = Object.assign(files.slice(), { item: (index: number) => files[index] ?? null })
  Object.defineProperty(input,'files',{ configurable: true, value: fileList })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  return fileList
}
const mount = async (props: Partial<Props> = {}) => {
  await act(async () => root.render(createElement(ImportWizard,{ onClose: close, ...props })))
}
const generate = () => press(by('generate'))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected network') }))
  for (const fn of [h.importFile,h.upload,h.sample,h.status,h.templates,h.outline,h.design,h.enrich,h.save,h.read,h.saveBeforeLeave,h.load]) {
    fn.mockReset().mockImplementation(() => { throw Error('Unexpected collaborator invocation') })
  }
  h.status.mockResolvedValueOnce({ ...enabled, enabled: false })
  h.templates.mockResolvedValueOnce([])
  h.notify.mockReset(); h.planner.mockReset(); close.mockReset(); h.current = current()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
})

it('ignores empty file choices and exposes the existing supported file selection filter', async () => {
  await mount()
  expect(by<HTMLInputElement>('import-file').accept).toBe('.docx,.md,.markdown,.txt')
  expect(by<HTMLInputElement>('import-images').accept).toBe('image/*')
  expect(by<HTMLInputElement>('import-images').multiple).toBe(true)
  await select('import-file',[]); await select('import-images',[])
  expect(h.importFile).not.toHaveBeenCalled(); expect(h.upload).not.toHaveBeenCalled()
})

it('uses the selected file receipt to replace text and append assets to the current draft', async () => {
  await mount({ initialText: 'Before', initialImages: [asset('existing')] })
  const file = new File(['synthetic'], 'fixture.md', { type:'text/markdown' })
  h.importFile.mockResolvedValueOnce({ text:'Imported text', assets:[asset('imported')] })
  const observed = vi.fn()
  window.addEventListener('assets-changed', observed)
  try {
    await select('import-file',[file])
    expect(h.importFile).toHaveBeenCalledExactlyOnceWith(file)
    expect(text().value).toBe('Imported text')
    expect(by('photo-boundary').textContent).toBe('existing,imported')
    expect(observed).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('assets-changed', observed) }
})

it('forwards the entire selected image FileList and preserves manually entered text', async () => {
  await mount({ initialText:'Keep text', initialImages:[asset('existing')] })
  h.upload.mockResolvedValueOnce([asset('first-photo'),asset('second-photo')])
  const first = new File(['first'],'first.jpg',{ type:'image/jpeg' })
  const second = new File(['second'],'second.png',{ type:'image/png' })
  const list = await select('import-images',[first,second])
  expect(h.upload).toHaveBeenCalledExactlyOnceWith(list)
  expect(text().value).toBe('Keep text')
  expect(by('photo-boundary').textContent).toBe('existing,first-photo,second-photo')
})

it.each(['import-file', 'import-images', 'load-sample'])('reports a %s failure without changing the current draft', async id => {
  const observer = vi.fn()
  window.addEventListener('assets-changed', observer)
  const target = { 'import-file': h.importFile, 'import-images': h.upload, 'load-sample': h.sample }[id]!
  target.mockRejectedValueOnce(new Error('Synthetic boundary failure'))
  await mount({ initialText:'Keep text', initialImages:[asset('existing')] })
  try {
    if (id === 'load-sample') await press(by(id))
    else await select(id,[new File(['synthetic'],'fixture')])
    expect(h.notify).toHaveBeenCalledExactlyOnceWith('Synthetic boundary failure','error')
    expect(text().value).toBe('Keep text')
    expect(by('photo-boundary').textContent).toBe('existing')
    expect(observer).not.toHaveBeenCalled()
    expect(by<HTMLButtonElement>('generate').disabled).toBe(false)
  } finally { window.removeEventListener('assets-changed', observer) }
})

it('replaces initial text and image set with the explicit sample receipt', async () => {
  await mount({ initialText:'Before', initialImages:[asset('existing')] })
  h.sample.mockResolvedValueOnce({ text:'Sample text', assets:[asset('sample')] })
  await press(by('load-sample'))
  expect(h.sample).toHaveBeenCalledOnce()
  expect(text().value).toBe('Sample text')
  expect(by('photo-boundary').textContent).toBe('sample')
})

it('uses built-in layouts without provider calls and can return to the draft', async () => {
  await mount()
  expect(by<HTMLButtonElement>('generate').disabled).toBe(true)
  enter('  ')
  expect(by<HTMLButtonElement>('generate').disabled).toBe(true)
  enter('# Ready\nBody')
  await generate()
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
  expect(h.outline).not.toHaveBeenCalled(); expect(h.design).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled()
  await press(button('← 返回修改'))
  expect(text().value).toBe('# Ready\nBody')
})

it('gates navigation on current document save and ignores repeated choose before it settles', async () => {
  await mount({ initialText:'# Ready\nBody' })
  await generate()
  const gate = deferred<boolean>()
  h.saveBeforeLeave.mockReturnValueOnce(gate.promise)
  const choose = by('choose-first')
  act(() => { choose.click(); choose.click() })
  expect(h.saveBeforeLeave).toHaveBeenCalledOnce()
  await act(async () => gate.resolve(false))
  expect(h.save).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(by<HTMLButtonElement>('choose-first').disabled).toBe(false)
})

it.each(['unmount', 'document change'])('does not navigate after a save-before-leaving continuation is invalidated by %s', async action => {
  await mount({ initialText:'# Ready\nBody' })
  await generate()
  const gate = deferred<boolean>(); h.saveBeforeLeave.mockReturnValueOnce(gate.promise)
  await press(by('choose-first'))
  if (action === 'unmount') await act(async () => root.render(null))
  else h.current = { ...h.current, id: 'different' }
  await act(async () => gate.resolve(true))
  expect(h.save).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})

it('opens only a successfully persisted layout and passes the captured current document to navigation', async () => {
  const expected = h.current
  await mount({ initialText:'# Ready\nBody' })
  await generate()
  h.saveBeforeLeave.mockResolvedValueOnce(true)
  h.save.mockResolvedValueOnce({ revision: 'fixture-revision' })
  h.load.mockReturnValueOnce(true)
  await press(by('choose-first'))
  expect(h.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id:'first',title:'Ready' }))
  expect(h.load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id:'first',revision:'fixture-revision' }), expected)
  expect(close).toHaveBeenCalledOnce()
})

it('ignores template refresh events after tab unmount', async () => {
  await mount()
  h.templates.mockResolvedValueOnce([{ id:'new-template' }])
  await act(async () => window.dispatchEvent(new Event('templates-changed')))
  expect(by('kit-boundary').textContent).toBe('new-template')
  expect(h.templates).toHaveBeenCalledTimes(2)
  await act(async () => root.render(null))
  await act(async () => window.dispatchEvent(new Event('templates-changed')))
  expect(h.templates).toHaveBeenCalledTimes(2)
})

it('can opt out of AI even when the model is configured', async () => {
  h.status.mockReset().mockResolvedValueOnce(enabled)
  await mount({ initialText:'# Ready\nBody' })
  expect(by<HTMLInputElement>('use-ai').checked).toBe(true)
  await press(by('use-ai'))
  expect(by('design-hint')).toBeNull()
  await generate()
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
  expect(h.outline).not.toHaveBeenCalled(); expect(h.design).not.toHaveBeenCalled()
})

it('prevents a duplicate sample load from two clicks before the busy render', async () => {
  await mount({ initialText:'Current draft' })
  const pending = deferred<ImportReceipt>()
  h.sample.mockReturnValue(pending.promise)
  const loadSample = by<HTMLButtonElement>('load-sample')
  act(() => { loadSample.click(); loadSample.click() })
  expect(h.sample).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ text:'Sample receipt', assets:[] }))
  expect(text().value).toBe('Sample receipt')
})

it('preserves newer typed text when a delayed file import resolves', async () => {
  await mount({ initialText:'Before file import' })
  const pending = deferred<ImportReceipt>(); h.importFile.mockReturnValueOnce(pending.promise)
  await select('import-file',[new File(['synthetic'],'fixture.md')])
  enter('Hand-edited text while import runs')
  await act(async () => pending.resolve({ text:'Older file text', assets:[] }))
  expect(text().value).toBe('Hand-edited text while import runs')
})

it('does not show a rejected import failure after cancel closes the wizard', async () => {
  await mount({ initialText:'Before cancel' })
  const pending = deferred<ImportReceipt>(); h.importFile.mockReturnValueOnce(pending.promise)
  await select('import-file',[new File(['synthetic'],'fixture.md')])
  await press(button('取消'))
  expect(close).toHaveBeenCalledOnce()
  await act(async () => root.render(null))
  await act(async () => pending.reject(new Error('Obsolete wizard request')))
  expect(h.notify).not.toHaveBeenCalled()
})

it('preserves the existing text and image set when typing returns to the original text during delayed sample loading', async () => {
  await mount({ initialText:'Same visible text', initialImages:[asset('existing')] })
  const pending = deferred<ImportReceipt>(); h.sample.mockReturnValueOnce(pending.promise)
  const refresh = vi.fn()
  window.addEventListener('assets-changed', refresh)
  try {
    await press(by('load-sample'))
    enter('Intermediate text')
    enter('Same visible text')
    await act(async () => pending.resolve({ text:'Late sample', assets:[asset('sample-asset')] }))
    expect(text().value).toBe('Same visible text')
    expect(by('photo-boundary').textContent).toBe('existing')
    expect(refresh).toHaveBeenCalledOnce()
    expect(h.notify).toHaveBeenCalledExactlyOnceWith('导入已完成，当前输入已保留，可从素材库选择图片')
  } finally { window.removeEventListener('assets-changed', refresh) }
})

it('refreshes already-imported assets on late success after close without applying the stale receipt or notifying', async () => {
  await mount({ initialText:'Before close', initialImages:[asset('original')] })
  const pending = deferred<ImportReceipt>(); h.importFile.mockReturnValueOnce(pending.promise)
  const refresh = vi.fn()
  window.addEventListener('assets-changed', refresh)
  try {
    await select('import-file',[new File(['synthetic'],'fixture.md')])
    await press(by('close-boundary'))
    expect(close).toHaveBeenCalledOnce()
    // Keep the test double mounted to observe a receipt that resolves before the parent commits unmount.
    await act(async () => pending.resolve({ text:'Obsolete text', assets:[asset('saved-in-library')] }))
    expect(text().value).toBe('Before close')
    expect(by('photo-boundary').textContent).toBe('original')
    expect(refresh).toHaveBeenCalledOnce()
    expect(h.notify).not.toHaveBeenCalled()
  } finally { window.removeEventListener('assets-changed', refresh) }
})

it('lets a newer accepted Copywriter result survive an older file import', async () => {
  h.status.mockReset().mockResolvedValueOnce(enabled)
  await mount({ initialText:'Before composing', initialImages:[asset('original')] })
  const pending = deferred<ImportReceipt>()
  h.importFile.mockReturnValueOnce(pending.promise)
  await select('import-file',[new File(['synthetic'],'fixture.md')])
  await press(by('open-copywriter'))
  await press(by('copywriter-boundary'))
  await act(async () => pending.resolve({ text:'Older text', assets:[asset('older-assets')] }))
  expect(text().value).toBe('New accepted copywriter text')
  expect(by('photo-boundary').textContent).toBe('original')
})

const sourceWithAnchor = '# 实践纪实\n\n## 现场\n\n这里安排照片。\n\n这段是原始正文。'
const mountWithPhotoNote = async () => {
  h.status.mockReset().mockResolvedValueOnce(enabled)
  await mount({ initialText: sourceWithAnchor, initialImages: [asset('campus')] })
  await press(by('photo-note-boundary'))
}
const hinted = () => by<HTMLInputElement>('design-hint')

it('asks before sending an annotated photo to enrichment and forwards only its text context on approval', async () => {
  await mountWithPhotoNote()
  await generate()
  expect(by('enrich-ask')).toBeTruthy()
  expect(h.enrich).not.toHaveBeenCalled()
  expect(h.outline).not.toHaveBeenCalled()
  h.enrich.mockResolvedValueOnce({ markdown: '# 实践纪实\n\n## 新标题\n\n机器人的展板照片在入口旁。', changes: ['补充入口细节'] })
  await press(by('enrich-yes'))
  expect(h.enrich).toHaveBeenCalledExactlyOnceWith({
    text: sourceWithAnchor, photos: [{ no: 1, note: '现场机器人展台', after: '这里安排照片。' }], keep: ['这里安排照片。'],
  })
  expect(text().value).toContain('机器人的展板照片在入口旁。')
  expect(by('enrich-result').textContent).toContain('补充入口细节')
  expect(by('enrich-result').textContent).toContain('标题有改动')
  expect(by('enrich-result').textContent).toContain('「这里安排照片。」')
  expect(h.outline).not.toHaveBeenCalled()
  await press(by('enrich-undo'))
  expect(text().value).toBe(sourceWithAnchor)
  expect(by('enrich-result')).toBeNull()
})

it('allows declining enrichment, preserves draft text, and passes the selected style to the design request', async () => {
  await mountWithPhotoNote()
  await press(button('国风雅致'))
  expect(hinted().value).toBe('国风雅致')
  await generate()
  h.outline.mockResolvedValueOnce({ title: '模型标题', sections: [{ heading: '章节', paragraphs: ['正文'] }] })
  h.design.mockResolvedValueOnce({ designs: [] })
  await press(by('enrich-no'))
  expect(h.enrich).not.toHaveBeenCalled()
  expect(h.outline).toHaveBeenCalledExactlyOnceWith(sourceWithAnchor, ['campus'], ['现场机器人展台'])
  expect(h.design).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({title:'模型标题',imageCount:1}), '国风雅致')
  expect(h.notify).toHaveBeenCalledWith('AI 设计失败，可先使用内置版式：模型没有返回设计方案','error')
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
  await press(button('← 返回修改'))
  expect(text().value).toBe(sourceWithAnchor)
})

it('retains rule layouts if structure recognition and a later explicit redesign fail', async () => {
  h.status.mockReset().mockResolvedValueOnce(enabled)
  await mount({ initialText: '# 保留标题\n\n## 章节\n\n完整正文。' })
  h.outline.mockRejectedValueOnce(Error('结构拒绝'))
  h.design.mockRejectedValueOnce(Error('首轮设计拒绝')).mockRejectedValueOnce(Error('重试拒绝'))
  await generate()
  expect(h.notify.mock.calls).toEqual([
    ['结构理解失败，已改用规则解析：结构拒绝','error'],
    ['AI 设计失败，可先使用内置版式：首轮设计拒绝','error'],
  ])
  expect(h.design).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({title:'保留标题',imageCount:0}), '')
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
  await press(by('redesign'))
  expect(h.outline).toHaveBeenCalledOnce()
  expect(h.design).toHaveBeenCalledTimes(2)
  expect(h.notify).toHaveBeenLastCalledWith('重试拒绝','error')
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
})

it('keeps the enrichment prompt and draft available when the model returns no usable text', async () => {
  await mountWithPhotoNote()
  await generate()
  h.enrich.mockResolvedValueOnce({ markdown: '' })
  await press(by('enrich-yes'))
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('模型没有返回文案','error')
  expect(by('enrich-result')).toBeNull()
  expect(by('enrich-ask')).toBeTruthy()
  expect(by<HTMLButtonElement>('enrich-yes').disabled).toBe(false)
  expect(text().value).toBe(sourceWithAnchor)
})

it('retries a failed batch without recreating already saved variants', async () => {
  const expected = h.current
  await mount({ initialText:'# Ready\n\nBody' })
  await generate()
  h.saveBeforeLeave.mockResolvedValue(true)
  h.save.mockResolvedValueOnce({revision:'second-rev'}).mockRejectedValueOnce(Error('保存失败')).mockResolvedValueOnce({revision:'first-rev'})
  h.read.mockResolvedValueOnce({ ...current(), id:'second', revision:'second-rev', updatedAt:12 })
  h.load.mockReturnValueOnce(true)
  const all = button('全部保存为项目，并打开第一套')
  await press(all)
  expect(h.save.mock.calls.map(([d]) => d.id)).toEqual(['second','first'])
  expect(h.load).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('保存失败','error')
  await press(all)
  expect(h.read).toHaveBeenCalledExactlyOnceWith('second')
  expect(h.save.mock.calls.map(([d]) => d.id)).toEqual(['second','first','first'])
  expect(h.load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'first',revision:'first-rev'}), expected)
  expect(h.notify).toHaveBeenLastCalledWith('2 套方案均已保存为项目，可在「项目」中切换')
  expect(close).toHaveBeenCalledOnce()
})

const enrichedCopy = { markdown: '# 实践纪实\n\n## 现场\n\n这里安排照片。\n\n展台在人群右侧。' }

it('does not overwrite text typed while the photo enrichment is pending', async () => {
  await mountWithPhotoNote()
  await generate()
  const receipt = deferred<typeof enrichedCopy>()
  h.enrich.mockReturnValueOnce(receipt.promise)
  await press(by('enrich-yes'))
  expect(by<HTMLButtonElement>('enrich-yes').disabled).toBe(true)
  enter('我在等待时手写了新文案。')
  await act(async () => receipt.resolve(enrichedCopy))
  expect(text().value).toBe('我在等待时手写了新文案。')
  expect(by('enrich-result')).toBeNull()
})

it('does not let an earlier enrichment undo replace newer manually typed content', async () => {
  await mountWithPhotoNote()
  await generate()
  h.enrich.mockResolvedValueOnce(enrichedCopy)
  await press(by('enrich-yes'))
  expect(text().value).toBe(enrichedCopy.markdown)
  enter(enrichedCopy.markdown + '\n\n手写部分不能丢。')
  await press(by('enrich-undo'))
  expect(text().value).toContain('手写部分不能丢。')
})

it('discards a pending enrichment after an ABA edit and permits a new enrichment from the preserved draft', async () => {
  await mountWithPhotoNote()
  await generate()
  const delayed = deferred<typeof enrichedCopy>()
  h.enrich.mockReturnValueOnce(delayed.promise)
  await press(by('enrich-yes'))
  enter('不同的内容')
  enter(sourceWithAnchor)
  await act(async () => delayed.resolve(enrichedCopy))
  expect(text().value).toBe(sourceWithAnchor)
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('当前文案已变化，未应用 AI 补充结果')
  expect(by('enrich-result')).toBeNull()
  expect(by('enrich-ask')).toBeNull()
  expect(by<HTMLButtonElement>('generate').disabled).toBe(false)
  await generate()
  h.enrich.mockResolvedValueOnce(enrichedCopy)
  await press(by('enrich-yes'))
  expect(text().value).toBe(enrichedCopy.markdown)
  expect(h.enrich).toHaveBeenCalledTimes(2)
})

it('does not apply or notify on a delayed enrichment receipt after cancellation', async () => {
  await mountWithPhotoNote()
  await generate()
  const delayed = deferred<typeof enrichedCopy>()
  h.enrich.mockReturnValueOnce(delayed.promise)
  await press(by('enrich-yes'))
  await press(by('close-boundary'))
  await act(async () => delayed.resolve(enrichedCopy))
  expect(close).toHaveBeenCalledOnce()
  expect(text().value).toBe(sourceWithAnchor)
  expect(by('enrich-result')).toBeNull()
  expect(h.notify).not.toHaveBeenCalled()
})

it('rejects enrichment undo even if later manual edits returned to the same text and can continue layout', async () => {
  await mountWithPhotoNote()
  await generate()
  h.enrich.mockResolvedValueOnce(enrichedCopy)
  await press(by('enrich-yes'))
  enter(enrichedCopy.markdown + '\n\n手写段落。')
  enter(enrichedCopy.markdown)
  expect(by<HTMLButtonElement>('enrich-undo').disabled).toBe(true)
  expect(by('enrich-result').textContent).toContain('不能撤销这次 AI 补充')
  expect(by<HTMLButtonElement>('enrich-continue').disabled).toBe(false)
  h.outline.mockResolvedValueOnce({})
  h.design.mockResolvedValueOnce({ designs: [] })
  await press(by('enrich-continue'))
  expect(h.outline).toHaveBeenCalledExactlyOnceWith(enrichedCopy.markdown, ['campus'], ['现场机器人展台'])
  expect(host.querySelectorAll('.variant')).toHaveLength(2)
})

it.each(['edited', 'deleted', 'unavailable'] as const)('keeps the current draft when a previously saved variant is %s during retry', async action => {
  const expected = h.current
  await mount({ initialText:'# Ready\n\nBody' })
  await generate()
  h.saveBeforeLeave.mockResolvedValue(true)
  h.save.mockResolvedValueOnce({ revision:'second-rev', updatedAt:1 }).mockRejectedValueOnce(Error('第一次保存失败'))
  const all = button('全部保存为项目，并打开第一套')
  await press(all)
  expect(h.save.mock.calls.map(([d]) => d.id)).toEqual(['second','first'])
  if (action === 'edited') h.read.mockResolvedValueOnce({ ...current(), id:'second', revision:'another-revision', title:'远端编辑' })
  else if (action === 'deleted') h.read.mockRejectedValueOnce(Object.assign(Error('missing'), { status:404 }))
  else h.read.mockRejectedValueOnce(Error('暂时无法读取'))
  await press(all)
  expect(h.read).toHaveBeenCalledExactlyOnceWith('second')
  expect(h.save.mock.calls.map(([d]) => d.id)).toEqual(['second','first'])
  const error = action === 'edited' ? '已被其他页面修改' : action === 'deleted' ? '已被其他页面删除' : '暂时无法读取'
  expect(by('variant-save-error').textContent).toContain(error)
  expect(h.load).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(h.current).toBe(expected)
})

it('does not continue a retry after closing while its receipt is being validated', async () => {
  await mount({ initialText:'# Ready\n\nBody' })
  await generate()
  h.saveBeforeLeave.mockResolvedValue(true)
  h.save.mockResolvedValueOnce({ revision:'second-rev' }).mockRejectedValueOnce(Error('first failed'))
  const all = button('全部保存为项目，并打开第一套')
  await press(all)
  const receipt = deferred<Doc>()
  h.read.mockReturnValueOnce(receipt.promise)
  await press(all)
  await press(by('close-boundary'))
  await act(async () => receipt.resolve({ ...current(), id:'second', revision:'second-rev' }))
  expect(h.read).toHaveBeenCalledExactlyOnceWith('second')
  expect(h.save.mock.calls.map(([d]) => d.id)).toEqual(['second','first'])
  expect(h.load).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})
