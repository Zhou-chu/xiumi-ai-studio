// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {useStore,emptyDoc,normalizeDoc,selectedBlock,loadCustomThemes,saveNow,saveBeforeLeave,saveConflictCopy} from '../../src/editor/store'
import {api,ApiError} from '../../src/editor/api'
import {createBlock} from '../../src/core/blocks'
import {THEMES} from '../../src/core/themes'
const s=()=>useStore.getState()
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(api,'saveProject').mockResolvedValue({updatedAt:1,revision:'r'});s().load({...emptyDoc(),blocks:[{...createBlock('heading'),id:'a'},{...createBlock('paragraph'),id:'b'}]})})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks()})
it('normalizes malformed document metadata and persists repaired blocks',async()=>{
 const normalized=normalizeDoc({id:null,title:4,author:false,digest:null,themeId:0,cover:{src:1},blocks:[],createdAt:0,updatedAt:0} as any)
 expect(normalized).toMatchObject({title:'',author:'',digest:'',themeId:'tsinghua-purple',cover:undefined});expect(normalized.id).toBeTruthy();expect(normalized.createdAt).toBeGreaterThan(0)
 s().load({...emptyDoc(),blocks:[{id:'bad',type:'heading',props:{title:42}}]} as any);await saveNow();expect(api.saveProject).toHaveBeenCalled();expect(s().toast).not.toBeNull()
})
it('inserts, duplicates, moves and removes within a parent; invalid targets do not create history',()=>{
 const box=createBlock('box');box.id='box';box.props.children=[{...createBlock('heading'),id:'child'}];s().insertBlock(box,0);s().select('child');const id=s().insertBlock('paragraph',1,'box');expect(selectedBlock(s())?.id).toBe(id)
 s().duplicateBlock(id);const clone=s().selectedId!;expect(clone).not.toBe(id);s().moveBlock(clone,0);expect((s().doc.blocks[0] as typeof box).props.children[0].id).toBe(clone)
 s().removeBlock(clone);expect(s().selectedId).toBe('child');s().removeBlock('child');s().removeBlock(id);expect(s().selectedId).toBe('box')
 const before=s().doc;s().duplicateBlock('missing');s().removeBlock('missing');s().moveBlock('missing',0);s().replaceBlock('missing',[createBlock('heading')]);s().replaceBlock('a',[]);s().moveBlockTo('missing',null,0);expect(s().doc).toBe(before)
 s().moveBlockTo('a','box',0);expect((s().doc.blocks[0] as typeof box).props.children[0].id).toBe('a');s().moveBlockTo('a',null,0);s().moveBlock('a',2);expect(s().doc.blocks.at(-1)?.id).toBe('a')
 s().select('a');s().removeBlock('a');expect(s().selectedId).toBe('b');s().load({...emptyDoc(),blocks:[createBlock('paragraph')]});s().select(s().doc.blocks[0].id);s().removeBlock(s().selectedId!);expect(s().selectedId).toBeNull()
})
it('explicit batch insert and replacement preserve clone isolation; edits/picks clear safely',()=>{
 const source=createBlock('heading');s().insertBlocks([source],0);expect(s().doc.blocks[0].id).not.toBe(source.id);s().select('a');s().insertBlocks([createBlock('paragraph')]);s().replaceBlock('b',[{...createBlock('heading'),id:'replacement'}]);expect(s().selectedId).toBe('replacement')
 s().setEditing('replacement');s().select('replacement');expect(s().editingId).toBe('replacement');s().setPicking('replacement');s().select('replacement');expect(s().pickingId).toBe('replacement');s().setPicking(null);s().setEditing(null);expect(s().editingId).toBeNull();expect(s().pickingId).toBeNull();s().removeSelected();expect(selectedBlock(s())).toBeNull();s().removeSelected()
})
it('coalesces bounded history, handles empty history and closes review on redo',()=>{
 s().undo();s().redo();s().setDocFields({title:'one'},'title');s().setDocFields({title:'two'},'title');expect(s().past).toHaveLength(1);vi.advanceTimersByTime(1600);s().setDocFields({title:'three'},'title');expect(s().past).toHaveLength(2)
 s().undo();s().propose('review',[{op:'setMeta',title:'AI'}]);s().redo();expect(s().proposal).toBeNull();expect(s().toast?.text).toContain('AI')
 for(let i=0;i<110;i++)s().setDocFields({title:String(i)});expect(s().past).toHaveLength(100)
})
it('rejects out of scope and invalid operations without mutations, supports rejection and empty resolution',()=>{
 s().resolveProposal('all','accepted');s().propose('scope',[{op:'remove',id:'b'},{op:'unknown'}],'a');expect(s().proposal?.errors).toHaveLength(2);s().clearProposal();expect(s().proposal).toBeNull()
 s().propose('invalid',[{op:'unknown'}]);expect(s().proposal?.errors.length).toBe(1)
 s().propose('reject',[{op:'setMeta',title:'AI'}]);const doc=s().doc;s().resolveProposal('all','rejected');expect(s().doc).toBe(doc);expect(s().proposal?.items[0].status).toBe('rejected')
})
it('toast expiration cannot clear a more recent message and theme loading tolerates failure',async()=>{
 s().notify('first');vi.advanceTimersByTime(1000);s().notify('second','error');vi.advanceTimersByTime(2200);expect(s().toast?.text).toBe('second');vi.advanceTimersByTime(1000);expect(s().toast).toBeNull()
 vi.spyOn(api,'themes').mockResolvedValue([{...THEMES[0],id:'custom-boundary',name:'Custom boundary'}]);await loadCustomThemes();expect(s().themes.some(t=>t.id==='custom-boundary')).toBe(true);vi.mocked(api.themes).mockRejectedValue(new Error('offline'));await expect(loadCustomThemes()).resolves.toBeUndefined()
})
it('conflict copy rejects duplicate requests and late success/error cannot touch a loaded draft',async()=>{
 expect(await saveConflictCopy()).toBe(false)
 useStore.setState({saveConflict:true,saveStatus:'error'});let resolve!:(x:{updatedAt:number;revision:string})=>void;vi.mocked(api.saveProject).mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const pending=saveConflictCopy();expect(await saveConflictCopy()).toBe(false);s().load({...emptyDoc(),title:'New draft'});resolve({updatedAt:1,revision:'copy'});expect(await pending).toBe(false);expect(s().doc.title).toBe('New draft')
 useStore.setState({saveConflict:true});let reject!:(x:Error)=>void;vi.mocked(api.saveProject).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}));const failed=saveConflictCopy();s().load({...emptyDoc(),title:'Next draft'});reject(new Error('old error'));expect(await failed).toBe(false);expect(s().saveStatus).toBe('saved')
})
it('save failure prevents navigation, conflict stops writes and old rejection cannot overwrite fresh status',async()=>{
 vi.mocked(api.saveProject).mockRejectedValueOnce(new ApiError('revision conflict',409));expect(await saveBeforeLeave()).toBe(false);expect(s().saveConflict).toBe(true);const count=vi.mocked(api.saveProject).mock.calls.length;expect(await saveNow()).toBe(false);expect(api.saveProject).toHaveBeenCalledTimes(count)
 s().load(emptyDoc());let reject!:(e:Error)=>void;vi.mocked(api.saveProject).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}));const pending=saveNow();s().load(emptyDoc());reject(new Error('old failure'));expect(await pending).toBe(false);expect(s().saveStatus).toBe('saved')
})
