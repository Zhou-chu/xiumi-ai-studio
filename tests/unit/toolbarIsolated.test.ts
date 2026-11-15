// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'

type CompileReceipt = { html: string; charCount: number; warnings: string[] }
const h = vi.hoisted(() => ({
  notify: vi.fn(), flush: vi.fn(), quit: vi.fn(), settings: vi.fn(), version: vi.fn(), versions: vi.fn(),
  saveVersion: vi.fn(), saveNow: vi.fn(), commit: vi.fn(), setDocFields: vi.fn(),
  undo:vi.fn(), redo:vi.fn(), conflict:vi.fn(), child:vi.fn(), past:[] as unknown[], future:[] as unknown[], conflicted:false,
  draft: vi.fn(), compile: vi.fn(), copy: vi.fn(), prepare: vi.fn(), download: vi.fn(), pack: vi.fn(),
  subscriptions: new Set<(next: { doc: Doc }, previous: { doc: Doc }) => void>(),
  unexpected: () => { throw Error('Unexpected boundary call') }, compileDoc: vi.fn(), parts: 1, localImages: 0, dialog: vi.fn(), doc: null as unknown as Doc,
}))

vi.mock('../../src/editor/api', () => ({
  api: {
    appInfo: async () => ({ canQuit: true }), wechatStatus: h.settings, wechatDraft: h.draft,
    versions: h.versions, version: h.version, saveVersion: h.saveVersion, quit: h.quit,
  },
}))
vi.mock('../../src/editor/store', () => {
  const state = () => ({
    doc: h.doc, saveStatus: 'saved', saveError: '', saveConflict: h.conflicted, past: h.past, future: h.future,
    notify: h.notify, commit: h.commit, setDocFields: h.setDocFields, undo: h.undo, redo: h.redo,
  })
  return {
    useStore: Object.assign((select: (value: ReturnType<typeof state>) => unknown) => select(state()), { getState: state, subscribe: (listener: Parameters<typeof h.subscriptions.add>[0]) => {
      h.subscriptions.add(listener)
      return () => { h.subscriptions.delete(listener) }
    } }),
    saveNow: h.saveNow, flushSave: h.flush, saveConflictCopy: h.conflict,
    normalizeDoc: (value: Doc) => value,
  }
})
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) =>
    createElement('section', { 'data-modal': title },
      createElement('button', { 'aria-label': '关闭 ' + title, onClick: onClose }), children),
}))
vi.mock('../../src/editor/ToolbarMenu', () => ({ ToolbarMenu: ({ children }: { children: ReactNode }) => children }))
vi.mock('../../src/editor/UiIcon', () => ({ UiIcon: () => null }))
vi.mock('../../src/editor/ColorModeControl', () => ({ ColorModeControl: () => null }))
vi.mock('../../src/editor/AiSettingsModal', () => ({ AiSettingsModal: h.child }))
vi.mock('../../src/editor/DataModal', () => ({ DataModal: h.child }))
vi.mock('../../src/editor/ArticleImport',()=>({ArticleImportModal:h.child}))
vi.mock('../../src/editor/ImportWizard',()=>({ImportWizard:h.child}))
vi.mock('../../src/core/compiler', () => ({ compileDoc: h.compileDoc, variantUrl: () => '/fixture-cover.jpg' }))
vi.mock('../../src/core/exporters', () => ({ docToMarkdown: () => '![test](/media/fixture.jpg)' }))
vi.mock('../../src/core/images', () => ({ displayHtml: (html: string) => html }))
vi.mock('../../src/core/xiumiExport', () => ({
  xiumiReport: () => ({ localImages: h.localImages, backgrounds: 0, localBackgrounds: 0, dataImages: 0 }),
  xiumiSvgBoxes: () => [], splitForXiumi: () => new Array(h.parts),
}))
vi.mock('../../src/editor/wechatOutput', () => ({
  assertReplayOk: (value: CompileReceipt) => value, compileForWechat: h.compile, copyRichText: h.copy,
  download: h.download, prepareXiumiUpload: h.prepare,
  xiumiPackage: h.pack, standaloneHtml: (_doc: Doc, html: string) => '<html>' + html + '</html>',
}))

import { Toolbar } from '../../src/editor/Toolbar'

let host: HTMLDivElement
let root: Root
const doc = (extra: Partial<Doc> = {}): Doc => ({
  id: 'current', title: '草稿:/标题', author: '作者', digest: '摘要', themeId: 'fixture',
  cover: { src: '/media/cover.jpg' }, blocks: [], createdAt: 1, updatedAt: 1, ...extra,
})
const receipt: CompileReceipt = { html: '<p>正文</p>', charCount: 123, warnings: [] }
const by = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
const named = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!
const press = async (button: HTMLButtonElement) => { expect(button).toBeTruthy(); await act(async () => button.click()) }
const mount = async () => { await act(async () => root.render(createElement(Toolbar))) }
const exportsDialog = () => press(by('open-export'))
const draftDialog = () => press(named('推送到草稿箱…'))
const check = async () => { await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(h.unexpected))
  vi.stubGlobal('confirm', h.dialog.mockReset().mockImplementation(h.unexpected))
  for (const mock of [h.quit,h.flush,h.settings,h.version,h.versions,h.saveVersion,h.saveNow,h.draft,h.compile,h.copy,h.prepare,h.download,h.pack]) mock.mockReset().mockImplementation(h.unexpected)
  h.compileDoc.mockReset().mockReturnValue(receipt)
  h.notify.mockReset(); h.commit.mockReset(); h.setDocFields.mockReset()
  h.child.mockReset().mockImplementation(h.unexpected)
  h.undo.mockReset();h.redo.mockReset();h.conflict.mockReset();h.past=[];h.future=[];h.conflicted=false
  h.subscriptions.clear(); h.doc=doc(); h.parts=1; h.localImages=0
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('keeps external image upload and draft actions disabled when configuration cannot be read', async () => {
  h.settings.mockRejectedValueOnce(new Error('not available'))
  h.localImages=2; await mount(); await exportsDialog()
  expect(named('上传到微信图床').disabled).toBe(true)
  expect(named('推送到草稿箱…').disabled).toBe(true)
  expect(by('xiumi-upload').disabled).toBe(true)
  expect(by('xiumi-package').disabled).toBe(false)
})

it('copies compiled rich text in the chosen mode and reports compatibility warnings', async () => {
  h.settings.mockResolvedValueOnce({ configured:false }); await mount(); await exportsDialog()
  await press(named('原图链接'))
  h.compile.mockResolvedValueOnce({ ...receipt, warnings:['合成提醒'] })
  h.copy.mockImplementationOnce(async (html: Promise<string>) => {
    expect(await html).toBe(receipt.html)
    return 'clipboard-api'
  })
  await press(by('copy-wechat'))
  expect(h.compile).toHaveBeenCalledExactlyOnceWith(h.doc,'absolute',expect.any(Function))
  expect(host.textContent).toContain('合成提醒')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('已复制（富文本）'))
})

it('allows a packaged download to be canceled without emitting a file', async () => {
  h.settings.mockResolvedValueOnce({ configured:false }); h.parts=2
  h.pack.mockResolvedValueOnce({ blob:new Blob(['mock']), parts:2, name:'mock.zip', images:0 })
  h.dialog.mockReturnValueOnce(false)
  await mount(); await exportsDialog(); await press(by('xiumi-package'))
  expect(by('xiumi-parts').textContent).toContain('2 份文件')
  expect(h.dialog).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('导入秀米-2.txt'))
  expect(h.download).not.toHaveBeenCalled()
  expect(by('xiumi-package').disabled).toBe(false)
})

it('confirms before image upload and separately confirms when the resulting file count changes', async () => {
  h.settings.mockResolvedValueOnce({ configured:true }); h.parts=2; h.localImages=1
  const upload = vi.fn(async () => ({ blob:new Blob(['mock']), parts:3, name:'mock.zip', images:1 }))
  h.prepare.mockReturnValue({ parts:2, upload })
  h.dialog.mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false)
  await mount(); await exportsDialog(); await press(by('xiumi-upload'))
  expect(upload).not.toHaveBeenCalled()
  await press(by('xiumi-upload'))
  expect(upload).toHaveBeenCalledOnce()
  expect(h.dialog).toHaveBeenNthCalledWith(3, expect.stringContaining('图片已上传到微信，取消只会停止下载'))
  expect(h.download).not.toHaveBeenCalled()
})

it('requires explicit draft consent and rejects an overlong compiled draft before sending it', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  h.compile.mockResolvedValueOnce({ ...receipt, charCount:20_000 })
  await mount(); await exportsDialog(); await draftDialog()
  expect(named('确认推送').disabled).toBe(true)
  await press(named('确认推送'))
  expect(h.compile).not.toHaveBeenCalled()
  await check(); await press(named('确认推送'))
  expect(h.draft).not.toHaveBeenCalled()
  expect(host.textContent).toContain('超过接口 20,000 字符上限')
})

it('passes only the confirmed draft receipt to the publishing adapter and shows its ID', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  h.compile.mockResolvedValueOnce(receipt); h.draft.mockResolvedValueOnce({ media_id:'fixture-ID' })
  await mount(); await exportsDialog(); await draftDialog(); await check(); await press(named('确认推送'))
  expect(h.draft).toHaveBeenCalledExactlyOnceWith({ title:h.doc.title, author:h.doc.author, digest:h.doc.digest, html:receipt.html, cover:h.doc.cover?.src, confirm:true })
  expect(host.textContent).toContain('fixture-ID')
})

it('keeps draft submission disabled after consent when required fields are missing', async () => {
  h.doc=doc({ title:' ', cover:undefined, digest:'字'.repeat(121) })
  h.settings.mockResolvedValueOnce({ configured:true })
  await mount(); await exportsDialog(); await draftDialog(); await check()
  expect(named('确认推送').disabled).toBe(true)
  expect(host.textContent).toContain('缺少标题')
  expect(host.textContent).toContain('缺少封面')
  expect(host.textContent).toContain('摘要超过 120 字')
  expect(h.compile).not.toHaveBeenCalled()
})

it('blocks quit after save fails unless the second data-loss warning is confirmed', async () => {
  h.dialog.mockReturnValueOnce(true).mockReturnValueOnce(false)
  h.flush.mockRejectedValueOnce(new Error('磁盘错误'))
  await mount(); await press(by('quit-app'))
  expect(h.dialog).toHaveBeenNthCalledWith(2,expect.stringContaining('退出后这些修改会丢失'))
  expect(h.quit).not.toHaveBeenCalled()
  expect(by('quit-screen')).toBeNull()
})

it('reports successful exit only after the save adapter settles', async () => {
  h.dialog.mockReturnValueOnce(true)
  let release!: () => void
  h.flush.mockImplementationOnce(() => new Promise<void>(resolve => { release=resolve }))
  h.quit.mockResolvedValueOnce({})
  await mount(); await press(by('quit-app'))
  expect(by('quit-screen').textContent).toContain('正在保存并退出')
  expect(h.quit).not.toHaveBeenCalled()
  await act(async () => release())
  expect(h.quit).toHaveBeenCalledOnce()
  expect(by('quit-screen').textContent).toContain('内容已保存')
})

it('does not send a draft after canceling while a prepared HTML result is still pending', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  h.draft.mockResolvedValueOnce({ media_id:'must-not-send' })
  let release!: (value: CompileReceipt) => void
  h.compile.mockImplementationOnce(() => new Promise<CompileReceipt>(resolve => { release=resolve }))
  await mount(); await exportsDialog(); await draftDialog(); await check()
  await press(named('确认推送'))
  expect(h.compile).toHaveBeenCalledOnce()
  expect(h.draft).not.toHaveBeenCalled()
  const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="关闭 确认推送到公众号草稿箱"]')!
  await press(cancel)
  await act(async () => release(receipt))
  expect(h.draft).not.toHaveBeenCalled()
  expect(h.notify).not.toHaveBeenCalled()
})

it('does not create a second draft from the same completed confirmation dialog', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  h.compile.mockResolvedValue(receipt)
  h.draft.mockResolvedValue({ media_id:'fixture-ID' })
  await mount(); await exportsDialog(); await draftDialog(); await check()
  await press(named('确认推送'))
  expect(h.draft).toHaveBeenCalledOnce()
  const completed = named('草稿已创建')
  expect(completed).toBeTruthy()
  expect(completed.disabled).toBe(true)
  expect(host.textContent).toContain('fixture-ID')
  await press(completed)
  expect(h.draft).toHaveBeenCalledOnce()
})

it('allows intentional retry after a failed preparation while rejecting a same-task repeat activation', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  let fail!: (error: Error) => void
  h.compile.mockImplementationOnce(() => new Promise<CompileReceipt>((_resolve,reject) => { fail=reject }))
  h.compile.mockResolvedValueOnce(receipt); h.draft.mockResolvedValueOnce({ media_id:'retried-ID' })
  await mount(); await exportsDialog(); await draftDialog(); await check()
  const push = named('确认推送')
  act(() => { push.click(); push.click() })
  expect(h.compile).toHaveBeenCalledOnce()
  await act(async () => fail(new Error('准备失败')))
  expect(host.textContent).toContain('准备失败')
  expect(h.draft).not.toHaveBeenCalled()
  expect(named('确认推送').disabled).toBe(false)
  await press(named('确认推送'))
  expect(h.draft).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('retried-ID')
})

it('tells the user closing cannot withdraw a dispatched request and suppresses its result after closing', async () => {
  h.settings.mockResolvedValueOnce({ configured:true })
  h.compile.mockResolvedValueOnce(receipt)
  let finish!: (value: { media_id:string }) => void
  h.draft.mockImplementationOnce(() => new Promise<{media_id:string}>(resolve => { finish=resolve }))
  await mount(); await exportsDialog(); await draftDialog(); await check(); await press(named('确认推送'))
  expect(h.draft).toHaveBeenCalledOnce()
  expect(host.textContent).toContain('不能撤回已上传的图片或已发出的请求')
  await press(named('取消'))
  await act(async () => finish({media_id:'already-dispatched-ID'}))
  expect(h.draft).toHaveBeenCalledOnce()
  expect(h.notify).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('already-dispatched-ID')
  await draftDialog()
  expect(named('确认推送').disabled).toBe(true)
})

it('renders compiled phone preview and closes without editing', async () => {
  await mount(); await press(by('open-preview'))
  expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<html><p>正文</p></html>')
  await press(host.querySelector('button[aria-label="关闭 手机预览"]')!)
  expect(host.querySelector('iframe')).toBeNull(); expect(h.commit).not.toHaveBeenCalled()
})

it('saves version labels only after prompt consent and refreshes the list', async () => {
  h.saveNow.mockReturnValue(undefined)
  h.versions.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'v1',label:'手动保存',createdAt:1,blockCount:2}])
  h.saveVersion.mockResolvedValueOnce({})
  vi.stubGlobal('prompt',vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(''))
  await mount(); await press(named('历史版本'))
  expect(host.textContent).toContain('还没有保存过版本')
  await press(named('保存当前为新版本')); expect(h.saveVersion).not.toHaveBeenCalled()
  await press(named('保存当前为新版本'))
  expect(h.saveVersion).toHaveBeenCalledExactlyOnceWith(h.doc,'手动保存')
  expect(h.versions).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('2 个模块')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('版本已保存')
})

it.each(['new-document','closed','newer-request'] as const)('rejects stale history receipt after %s', async (change) => {
  h.saveNow.mockReturnValue(undefined)
  h.versions.mockResolvedValue([{id:'v1',label:'旧版',createdAt:1,blockCount:1}])
  const finish: Array<(value:{doc:Doc})=>void>=[]
  h.version.mockImplementation(()=>new Promise(resolve=>finish.push(resolve)))
  await mount(); await press(named('历史版本')); await press(named('恢复'))
  if(change==='new-document') {
    const previous = h.doc
    h.doc=doc({title:'新编辑'})
    for (const listener of h.subscriptions) listener({ doc: h.doc }, { doc: previous })
  }
  if(change==='closed') await press(host.querySelector('button[aria-label="关闭 历史版本"]')!)
  if(change==='newer-request') await press(named('恢复'))
  await act(async()=>finish[0]({doc:doc({title:'过期版'})}))
  expect(h.commit).not.toHaveBeenCalled()
  if(change==='new-document') expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('未覆盖新编辑'),'error')
  else expect(h.notify).not.toHaveBeenCalled()
  if(change==='newer-request') {
    await act(async()=>finish[1]({doc:doc({id:'old-id',title:'选定版'})}))
    expect(h.commit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'current',title:'选定版'}))
    expect(host.querySelector('[data-modal="历史版本"]')).toBeNull()
  }
})

it('passes exact Markdown, JSON and standalone HTML payloads to download adapters', async () => {
  h.settings.mockResolvedValueOnce({configured:true}); h.download.mockReturnValue(undefined)
  h.compile.mockResolvedValueOnce(receipt)
  await mount(); await exportsDialog()
  await press(named('Markdown')); await press(named('编辑器 JSON')); await press(named('微信 HTML（图片内嵌）'))
  expect(h.download.mock.calls).toEqual([
    ['草稿__标题.md',`![test](${location.origin}/media/fixture.jpg)`,'text/markdown'],
    ['草稿__标题.json',JSON.stringify(h.doc,null,2),'application/json'],
    ['草稿__标题.html','<html><p>正文</p></html>','text/html'],
  ])
  expect(h.compile).toHaveBeenCalledExactlyOnceWith(h.doc,'embed',expect.any(Function))
  expect(by('copy-wechat').disabled).toBe(false)
})

it('selects configured image hosting then switches back to embedded output', async () => {
  h.settings.mockResolvedValueOnce({configured:true}); h.compile.mockResolvedValue(receipt)
  h.copy.mockImplementation(async(html:Promise<string>)=>{await html;return 'fallback'})
  await mount(); await exportsDialog(); await press(named('上传到微信图床')); await press(by('copy-wechat'))
  expect(h.compile).toHaveBeenLastCalledWith(h.doc,'wechat',expect.any(Function))
  await press(named('内嵌图片')); await press(by('copy-wechat'))
  expect(h.compile).toHaveBeenLastCalledWith(h.doc,'embed',expect.any(Function))
  expect(host.textContent).toContain('通过静态兼容检查（不等于真机验证）')
  expect(h.notify).toHaveBeenLastCalledWith(expect.stringContaining('兼容模式'))
})

it('surfaces clipboard and package failures and re-enables controls', async () => {
  h.settings.mockResolvedValueOnce({configured:false}); h.compile.mockResolvedValueOnce(receipt)
  h.copy.mockImplementationOnce(async(html:Promise<string>)=>{await html;throw Error('clipboard denied')})
  h.pack.mockRejectedValueOnce(Error('package failed'))
  await mount(); await exportsDialog(); await press(by('copy-wechat')); await press(by('xiumi-package'))
  expect(h.notify.mock.calls).toEqual([['clipboard denied','error'],['package failed','error']])
  expect(by('copy-wechat').disabled).toBe(false); expect(by('xiumi-package').disabled).toBe(false)
})

it('routes explicit toolbar and window commands to isolated child dialogs and clears template selections for a fresh import', async()=>{
  h.child.mockImplementation(({onClose,initialTemplates}:{onClose:()=>void;initialTemplates?:string[]})=>createElement('div',{'data-child':JSON.stringify(initialTemplates??[])},createElement('button',{onClick:onClose},'Close child')))
  await mount()
  for(const id of ['open-ai-settings','open-data','open-article-import','open-import']){
    await press(by(id));expect(host.querySelector('[data-child]')).toBeTruthy()
    await press(named('Close child'));expect(host.querySelector('[data-child]')).toBeNull()
  }
  await act(async()=>{window.dispatchEvent(new CustomEvent('open-import',{detail:{templateIds:['first','second']}}))})
  expect(host.querySelector('[data-child]')?.getAttribute('data-child')).toBe('["first","second"]')
  await press(named('Close child'));await press(by('open-import'))
  expect(host.querySelector('[data-child]')?.getAttribute('data-child')).toBe('[]')
  await press(named('Close child'))
  await act(async()=>{window.dispatchEvent(new Event('open-ai-settings'))})
  expect(host.querySelector('[data-child]')).toBeTruthy()
  await press(named('Close child'))
})

it('forwards title edits, enabled history commands and conflict-copy intent without performing persistence',async()=>{
  h.past=[{}];h.future=[{}];h.conflicted=true
  await mount()
  const title=host.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'用户新标题');title.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(h.setDocFields).toHaveBeenCalledExactlyOnceWith({title:'用户新标题'},'title')
  await press(host.querySelector('button[aria-label="撤销"]')!)
  await press(host.querySelector('button[aria-label="重做"]')!)
  await press(by('save-conflict-copy'))
  expect(h.undo).toHaveBeenCalledOnce();expect(h.redo).toHaveBeenCalledOnce();expect(h.conflict).toHaveBeenCalledOnce()
  expect(h.commit).not.toHaveBeenCalled();expect(h.saveNow).not.toHaveBeenCalled()
})

it('keeps a failed history list readable and permits closing without restore', async () => {
  h.saveNow.mockReturnValue(undefined); h.versions.mockRejectedValueOnce(Error('offline'))
  await mount(); await press(named('历史版本'))
  expect(host.textContent).toContain('还没有保存过版本')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('加载版本列表失败：offline', 'error')
  await press(host.querySelector('button[aria-label="关闭 历史版本"]')!)
  expect(h.commit).not.toHaveBeenCalled()
})

it('does not quit on canceled consent and distinguishes an explicitly unsaved exit', async () => {
  h.dialog.mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true)
  h.flush.mockRejectedValueOnce(Error('save denied')); h.quit.mockRejectedValueOnce(Error('connection closed'))
  await mount(); await press(by('quit-app'))
  expect(h.flush).not.toHaveBeenCalled(); expect(h.quit).not.toHaveBeenCalled()
  await press(by('quit-app')); expect(h.quit).toHaveBeenCalledOnce()
  expect(by('quit-screen').textContent).toContain('没有保存成功')
  expect(by('quit-screen').textContent).not.toContain('内容已保存')
})
