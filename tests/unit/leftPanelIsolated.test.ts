// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block, Doc } from '../../src/core/types'
import type { Asset, ProjectSummary, Template } from '../../src/editor/api'
import { LeftPanel } from '../../src/editor/LeftPanel'

const h = vi.hoisted(() => ({
  api: {
    assets: vi.fn(), templates: vi.fn(), projects: vi.fn(), project: vi.fn(),
    uploadAssets: vi.fn(), deleteAsset: vi.fn(), saveTemplate: vi.fn(), deleteTemplate: vi.fn(), deleteProject: vi.fn(),
  },
  doc: {} as Doc, selected: undefined as Block | undefined,
  insertBlock: vi.fn(), insertBlocks: vi.fn(), updateProps: vi.fn(), notify: vi.fn(), load: vi.fn(), setDocFields: vi.fn(),
  saveBeforeLeave: vi.fn(), saveNow: vi.fn(), loadIfUnchanged: vi.fn(), emptyDoc: vi.fn(), useDraggable: vi.fn(),
}))
vi.mock('../../src/editor/api', async (original) => ({
  ...await original<typeof import('../../src/editor/api')>(), api: h.api,
}))
vi.mock('../../src/editor/documentNavigation', () => ({ loadIfUnchanged: h.loadIfUnchanged }))
vi.mock('../../src/editor/store', () => {
  const state = () => ({ ...h })
  return {
    useStore: Object.assign((select: (s: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }),
    emptyDoc: h.emptyDoc, saveBeforeLeave: h.saveBeforeLeave, saveNow: h.saveNow, selectedBlock: () => h.selected,
  }
})
vi.mock('../../src/editor/TemplateModules', () => ({
  TemplateModules: ({ template, onClose }: { template: Template; onClose: () => void }) =>
    createElement('button', { 'data-testid': 'template-dialog', onClick: onClose }, template.name),
}))
vi.mock('../../src/editor/ComponentLibrary', () => ({
  ComponentLibrary: ({ templates }: { templates: Template[] }) =>
    createElement('output', { 'data-testid': 'component-library' }, templates.map(({ id }) => id).join(',')),
}))
vi.mock('../../src/editor/CropModal', () => ({
  CropModal: ({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) =>
    createElement('div', { 'data-testid': 'crop-dialog' }, asset.name,
      createElement('button', { 'data-testid': 'crop-cancel', onClick: onClose }, '取消'),
      createElement('button', { 'data-testid': 'crop-done', onClick: onDone }, '完成')),
}))
vi.mock('@dnd-kit/core', () => ({
  useDraggable: (input: unknown) => {
    h.useDraggable(input)
    return { attributes: {}, listeners: {}, isDragging: false, setNodeRef: () => {} }
  },
}))

const fixtureDoc: Doc = { id: 'current', title: '当前文稿', author: '', digest: '', themeId: 'minimal-magazine', blocks: [], createdAt: 1, updatedAt: 2 }
const empty: Doc = { ...fixtureDoc, id: 'blank-fixture', title: '' }
const pic: Asset = { id: 'fixture', file: 'fixture.png', name: '合成图片', width: 15, height: 12, size: 47, createdAt: 1 }
const ref = { assetId: 'fixture', src: '/media/fixture.png', alt: '合成图片', width: 15, height: 12 }
const tpl: Template = { id: 'tpl', name: '合成模板', themeId: 'thu-eea-de', themeOverrides: { fontSize: 18 }, createdAt: 1, blocks: [createBlock('heading', { title: '旧标题' })] }
const projects: ProjectSummary[] = [
  { id: 'current', title: '当前文稿', themeId: 'minimal-magazine', updatedAt: 1, blockCount: 1 },
  { id: 'other', title: '', themeId: 'minimal-magazine', updatedAt: 1, blockCount: 2 },
]
const forbidden = () => { throw Error('Unexpected isolated LeftPanel side effect') }
const fetcher = vi.fn(forbidden)
const confirm = vi.fn((_text: string) => false)
const prompt = vi.fn((_text: string, _defaultValue: string) => null as string | null)
let host: HTMLDivElement, root: Root
const q = <T extends HTMLElement=HTMLElement>(sel: string) => host.querySelector<T>(sel)!
const el = <T extends HTMLElement=HTMLElement>(id: string) => q<T>(`[data-testid="${id}"]`)
const byText = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const click = async (node: HTMLElement) => { await act(async () => { node.click() }) }
const tab = (name: string) => click(el('tab-'+name))
const mount = async (strict = false) => { await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(LeftPanel)) : createElement(LeftPanel))) }
const event = async (name: string) => { await act(async () => { window.dispatchEvent(new Event(name)) }) }
async function chooseFiles(files: File[]) {
  const input = el<HTMLInputElement>('asset-upload')
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('confirm', confirm)
  vi.stubGlobal('prompt', prompt)
  fetcher.mockClear()
  confirm.mockReset().mockReturnValue(false)
  prompt.mockReset().mockReturnValue(null)
  for (const mock of Object.values(h.api)) mock.mockReset().mockImplementation(forbidden)
  h.api.assets.mockResolvedValue([pic])
  h.api.templates.mockResolvedValue([tpl])
  h.api.projects.mockResolvedValue(projects)
  h.doc = fixtureDoc
  h.selected = undefined
  for (const mock of [h.notify, h.useDraggable, h.insertBlock, h.insertBlocks, h.updateProps, h.load, h.setDocFields, h.loadIfUnchanged]) mock.mockReset()
  h.emptyDoc.mockReset().mockReturnValue(empty)
  h.saveBeforeLeave.mockReset().mockResolvedValue(false)
  h.saveNow.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  expect(fetcher).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
it('inserts the chosen standard block and actual preset, and applies the theme as a separate action', async () => {
  await mount()
  await click(el('lib-heading'))
  expect(h.insertBlock).toHaveBeenLastCalledWith('heading')
  expect(h.useDraggable).toHaveBeenCalledWith({ id: 'lib:heading' })
  await click(el('kit-photos3'))
  expect(h.insertBlock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'photos', props: expect.objectContaining({ count: 3, layout: 'feature' }) }))
  expect(h.setDocFields).not.toHaveBeenCalled()
  await click(el('kit-theme'))
  expect(h.setDocFields).toHaveBeenCalledExactlyOnceWith({ themeId: 'thu-eea-de', themeOverrides: undefined })
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已套用「清华电机·德国」主题')
})
it('inserts a single picture only without a compatible selection and replaces an existing compatible image', async () => {
  await mount()
  await tab('assets')
  const image = q('img[alt="合成图片"]')
  expect(image.getAttribute('src')).toBe('/media/fixture.png?fit=1:1&w=240')
  expect(h.useDraggable).toHaveBeenCalledWith({ id: 'asset:fixture', data: { asset: pic } })
  await click(image)
  expect(h.insertBlock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'image', props: expect.objectContaining({ image: ref }) }))
  h.selected = createBlock('cover')
  await click(image)
  expect(h.updateProps).toHaveBeenCalledExactlyOnceWith(h.selected.id, { image: ref })
  expect(h.insertBlock).toHaveBeenCalledTimes(1)
})
it('appends a gallery image and rejects adding to filled photo slots without rewriting pictures', async () => {
  const first = { src: '/media/existing.png' }
  await mount()
  await tab('assets')
  const image = q('img[alt="合成图片"]')
  h.selected = createBlock('gallery', { images: [first] })
  await click(image)
  expect(h.updateProps).toHaveBeenLastCalledWith(h.selected.id, { images: [first, ref] })
  h.selected = createBlock('photos', { count: 2, layout: 'even', pics: [{ image: first, caption: 'keep 1' }, { image: first, caption: 'keep 2' }] })
  await click(image)
  expect(h.updateProps).toHaveBeenCalledTimes(1)
  expect(h.insertBlock).not.toHaveBeenCalled()
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('这组图片已放满：把素材拖到某张图片上可以替换', 'error')
})
it('skips empty uploads then reports both a rejected and a successful selected-file operation', async () => {
  await mount()
  await tab('assets')
  await chooseFiles([])
  expect(h.api.uploadAssets).not.toHaveBeenCalled()
  const file = new File(['synthetic'], 'fixture.png', { type: 'image/png' })
  h.api.uploadAssets.mockRejectedValueOnce(Error('合成拒绝')).mockResolvedValueOnce(undefined)
  await chooseFiles([file])
  expect(h.notify).toHaveBeenLastCalledWith('合成拒绝', 'error')
  expect(h.api.assets).toHaveBeenCalledTimes(1)
  await chooseFiles([file])
  expect(h.notify).toHaveBeenLastCalledWith('已上传 1 张图片')
  expect(h.api.uploadAssets.mock.calls).toEqual([[[file]], [[file]]])
  expect(h.api.assets).toHaveBeenCalledTimes(2)
  expect(host.textContent).not.toContain('上传中')
})
it('differentiates cancelling a crop from refreshing after a completed crop and a confirmed delete', async () => {
  await mount()
  await tab('assets')
  await click(byText('裁剪'))
  expect(el('crop-dialog').textContent).toContain('合成图片')
  await click(el('crop-cancel'))
  expect(el('crop-dialog')).toBeNull()
  expect(h.api.assets).toHaveBeenCalledTimes(1)
  await click(byText('裁剪'))
  await click(el('crop-done'))
  expect(el('crop-dialog')).toBeNull()
  expect(h.api.assets).toHaveBeenCalledTimes(2)
  await click(byText('删除'))
  expect(h.api.deleteAsset).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  h.api.deleteAsset.mockResolvedValue(undefined)
  h.api.assets.mockResolvedValue([])
  await click(byText('删除'))
  expect(h.api.deleteAsset).toHaveBeenCalledExactlyOnceWith('fixture')
  expect(host.textContent).toContain('暂无素材')
})
it('keeps template insertion, apply event and module inspector separate', async () => {
  await mount()
  await tab('components')
  expect(el('component-library').textContent).toBe('tpl')
  await tab('templates')
  await click(el('template-item'))
  expect(h.insertBlocks).toHaveBeenCalledExactlyOnceWith(tpl.blocks)
  const fired = vi.fn()
  window.addEventListener('open-import', fired, { once: true })
  try {
    await click(el('apply-template'))
    expect(fired).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ detail: { templateIds: ['tpl'] } }))
  } finally {
    window.removeEventListener('open-import', fired)
  }
  await click(el('template-modules'))
  expect(el('template-dialog').textContent).toContain('合成模板')
  await click(el('template-dialog'))
  expect(el('template-dialog')).toBeNull()
  expect(h.insertBlocks).toHaveBeenCalledTimes(1)
})
it('requires a name before saving the current document as a template and cancels a denied deletion', async () => {
  await mount()
  await tab('templates')
  const save = byText('☆ 收藏当前整篇为模板')
  await click(save)
  expect(h.api.saveTemplate).not.toHaveBeenCalled()
  expect(prompt).toHaveBeenLastCalledWith('把当前整篇结构收藏为模板，名称：', '当前文稿')
  prompt.mockReturnValue('新模板名')
  h.api.saveTemplate.mockResolvedValue(undefined)
  await click(save)
  expect(h.api.saveTemplate).toHaveBeenCalledExactlyOnceWith('新模板名', fixtureDoc.blocks, fixtureDoc)
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已收藏整篇模板')
  await click(byText('✕'))
  expect(h.api.deleteTemplate).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  h.api.deleteTemplate.mockResolvedValue(undefined)
  h.api.templates.mockResolvedValue([])
  await click(byText('✕'))
  expect(h.api.deleteTemplate).toHaveBeenCalledExactlyOnceWith('tpl')
  expect(host.textContent).toContain('还没有收藏的模板')
})
it('gates a new project from a template on save and clones the source blocks', async () => {
  await mount()
  await tab('templates')
  const create = byText('新建')
  await click(create)
  expect(h.load).not.toHaveBeenCalled()
  expect(h.saveNow).not.toHaveBeenCalled()
  h.saveBeforeLeave.mockResolvedValue(true)
  await click(create)
  const loaded = h.load.mock.calls[0][0] as Doc
  expect(loaded).toMatchObject({ id: empty.id, title: tpl.name, themeId: tpl.themeId, themeOverrides: tpl.themeOverrides })
  expect(loaded.blocks[0].type).toBe('heading')
  expect(loaded.blocks[0].id).not.toBe(tpl.blocks[0].id)
  expect(h.saveNow).toHaveBeenCalledTimes(1)
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已用模板「合成模板」新建项目')
})
it('guards the active project and delegates switching with the expected current document', async () => {
  await mount()
  expect(h.api.projects).not.toHaveBeenCalled()
  await tab('projects')
  expect(q<HTMLButtonElement>('.list-row.current .danger').disabled).toBe(true)
  await click(q('.list-row.current .danger'))
  expect(confirm).not.toHaveBeenCalled()
  const other = [...host.querySelectorAll('.list-row .grow')][1] as HTMLElement
  expect(other.textContent).toContain('未命名')
  await click(other)
  expect(h.api.project).not.toHaveBeenCalled()
  h.saveBeforeLeave.mockResolvedValue(true)
  const next = { ...fixtureDoc, id: 'other' }
  h.api.project.mockResolvedValue(next)
  await click(other)
  expect(h.api.project).toHaveBeenCalledExactlyOnceWith('other')
  expect(h.loadIfUnchanged).toHaveBeenCalledExactlyOnceWith(next, fixtureDoc)
  expect(h.load).not.toHaveBeenCalled()
})
it('refreshes active resource lists on events and stops listening once unmounted', async () => {
  await mount()
  h.api.assets.mockResolvedValue([])
  h.api.templates.mockResolvedValue([])
  await event('assets-changed')
  await event('templates-changed')
  await tab('assets')
  expect(host.textContent).toContain('暂无素材')
  await tab('templates')
  expect(host.textContent).toContain('还没有收藏的模板')
  act(() => root.render(null))
  await event('assets-changed')
  await event('templates-changed')
  expect(h.api.assets).toHaveBeenCalledTimes(2)
  expect(h.api.templates).toHaveBeenCalledTimes(2)
})

function deferred<T>() {
  let complete!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolve, fail) => { complete = resolve; reject = fail })
  return { complete, promise, reject }
}
const choiceA = { ...fixtureDoc, id: 'a', title: '项目甲' }
const choiceB = { ...fixtureDoc, id: 'b', title: '项目乙' }
function projectChoices() {
  h.api.projects.mockResolvedValue([
    ...projects,
    { id: 'a', title: '项目甲', themeId: 'minimal-magazine', updatedAt: 1, blockCount: 1 },
    { id: 'b', title: '项目乙', themeId: 'minimal-magazine', updatedAt: 1, blockCount: 1 },
  ])
}
const projectButton = (title: string) => [...host.querySelectorAll<HTMLButtonElement>('.list-row .grow')].find((b) => b.querySelector('b')?.textContent === title)!
it('does not dispatch the older project receipt when the newer explicit choice is still loading', async () => {
  projectChoices()
  h.saveBeforeLeave.mockResolvedValue(true)
  const a = deferred<Doc>()
  const b = deferred<Doc>()
  h.api.project.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)
  await mount()
  await tab('projects')
  await click(projectButton('项目甲'))
  await click(projectButton('项目乙'))
  expect(h.api.project.mock.calls).toEqual([['a'], ['b']])
  await act(async () => { a.complete(choiceA) })
  expect(h.loadIfUnchanged).not.toHaveBeenCalled()
  await act(async () => { b.complete(choiceB) })
  expect(h.loadIfUnchanged).toHaveBeenCalledExactlyOnceWith(choiceB, fixtureDoc)
})
it('does not start a superseded project request after the preceding write barrier resolves', async () => {
  projectChoices()
  const oldSave = deferred<boolean>()
  h.saveBeforeLeave.mockReturnValueOnce(oldSave.promise).mockResolvedValue(true)
  h.api.project.mockResolvedValue(choiceB)
  await mount()
  await tab('projects')
  await click(projectButton('项目甲'))
  await click(projectButton('项目乙'))
  expect(h.loadIfUnchanged).toHaveBeenCalledExactlyOnceWith(choiceB, fixtureDoc)
  await act(async () => { oldSave.complete(true) })
  expect(h.api.project).toHaveBeenCalledExactlyOnceWith('b')
  expect(h.loadIfUnchanged).toHaveBeenCalledExactlyOnceWith(choiceB, fixtureDoc)
})
it('does not apply delayed project data after leaving the projects tab', async () => {
  projectChoices()
  h.saveBeforeLeave.mockResolvedValue(true)
  const a = deferred<Doc>()
  h.api.project.mockReturnValue(a.promise)
  await mount()
  await tab('projects')
  await click(projectButton('项目甲'))
  await tab('assets')
  expect(q('img[alt="合成图片"]')).not.toBeNull()
  await tab('projects')
  expect(projectButton('项目甲')).not.toBeUndefined()
  await act(async () => { a.complete(choiceA) })
  expect(h.loadIfUnchanged).not.toHaveBeenCalled()
  expect(h.load).not.toHaveBeenCalled()
})
it('does not apply a delayed project receipt after the panel unmounts', async () => {
  projectChoices()
  h.saveBeforeLeave.mockResolvedValue(true)
  const a = deferred<Doc>()
  h.api.project.mockReturnValue(a.promise)
  await mount(true)
  await tab('projects')
  await click(projectButton('项目甲'))
  act(() => root.render(null))
  await act(async () => { a.complete(choiceA) })
  expect(h.loadIfUnchanged).not.toHaveBeenCalled()
})
it('reports only the currently selected project failure and permits another attempt', async () => {
  projectChoices()
  h.saveBeforeLeave.mockResolvedValue(true)
  const a = deferred<Doc>()
  const b = deferred<Doc>()
  h.api.project.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockResolvedValueOnce(choiceB)
  await mount()
  await tab('projects')
  await click(projectButton('项目甲'))
  await click(projectButton('项目乙'))
  await act(async () => { a.reject(Error('不再相关的旧错误')) })
  expect(h.notify).not.toHaveBeenCalled()
  await act(async () => { b.reject(Error('当前项目暂时不可用')) })
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('当前项目暂时不可用', 'error')
  expect(h.loadIfUnchanged).not.toHaveBeenCalled()
  await click(projectButton('项目乙'))
  expect(h.loadIfUnchanged).toHaveBeenCalledExactlyOnceWith(choiceB, fixtureDoc)
})
