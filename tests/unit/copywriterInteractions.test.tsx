// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {Copywriter} from '../../src/editor/Copywriter'
import {api} from '../../src/editor/api'
import {setup,cleanup,mount,host,click,button,byTest,input,state} from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
it('generates with explicit style, length and levels then revises and imports only after confirmation',async()=>{
 const write=vi.spyOn(api,'aiCopywrite').mockResolvedValue({markdown:'# Title\n## Section\nBody'}),done=vi.fn(),accept=vi.fn();await mount(<Copywriter onClose={done} onImport={accept} levels={3} hasText/>);expect((byTest('cw-generate') as HTMLButtonElement).disabled).toBe(true)
 await input(byTest('cw-brief'),'Real event facts');await click(button('理性科普'));await input(byTest('cw-style'),'Custom voice');await click([...host.querySelectorAll('button')].find(b=>b.textContent?.startsWith('短篇')));await click(byTest('cw-levels-2'));await input(host.querySelector('.cw-form .field:last-of-type input'),'Keep facts');await click(byTest('cw-generate'));expect(write).toHaveBeenCalledWith(expect.objectContaining({brief:'Real event facts',style:'Custom voice',levels:2,extra:'Keep facts'}))
 await input(byTest('cw-revise'),'Shorter');await click(byTest('cw-rewrite'));expect(write).toHaveBeenLastCalledWith(expect.objectContaining({previous:'# Title\n## Section\nBody',revise:'Shorter'}));expect((byTest('cw-revise') as HTMLInputElement).value).toBe('')
 vi.mocked(window.confirm).mockReturnValueOnce(false);await click(byTest('cw-import'));expect(accept).not.toHaveBeenCalled();await click(byTest('cw-import'));expect(accept).toHaveBeenCalledWith('# Title\n## Section\nBody');expect(done).toHaveBeenCalled()
})
it('reports failed and empty responses, allows manual writing and demotes excessive headings',async()=>{
 const write=vi.spyOn(api,'aiCopywrite').mockRejectedValueOnce(new Error('Provider failed')).mockResolvedValueOnce({markdown:''}).mockResolvedValue({markdown:'# Generated\n## Section\nText'});const close=vi.fn(),accept=vi.fn();await mount(<Copywriter onClose={close} onImport={accept} levels={0} hasText={false}/>);await input(byTest('cw-brief'),'Facts');await click(byTest('cw-generate'));expect(state().toast?.text).toBe('Provider failed');await click(byTest('cw-generate'));expect(state().toast?.text).toContain('没有返回文案');await click(byTest('cw-generate'));expect(write.mock.calls[2][0].style).toContain('温暖叙事')
 await click(byTest('cw-levels-1'));await input(byTest('cw-result'),'# Title\n## One\n### Two\n#### Three\n首先，【待补充】。');expect(host.textContent).toContain('待补充');expect(host.textContent).toContain('首先');await click(button('把多出的标题改为加粗正文'));expect((byTest('cw-result') as HTMLTextAreaElement).value).not.toContain('### ');await click(byTest('cw-import'));expect(accept).toHaveBeenCalled();expect(window.confirm).not.toHaveBeenCalled();await click(button('取消'));expect(close).toHaveBeenCalledTimes(2)
})
