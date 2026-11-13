import { describe, it, expect } from 'vitest'
import { collectArticleImages } from '../../src/core/articleImages'
import { aiContext } from '../../src/core/quickActions'
import { limitToSelection } from '../../src/core/ops'
import { editPrompt, scopeEditResult } from '../../server/aiEdit'
const doc: any = { title: 'title', themeId: 'classic', blocks: [{ id: 'box', type: 'box', props: { children: [{ id: 'a', type: 'paragraph', props: { content: 'selected' } }, { id: 'secret', type: 'paragraph', props: { content: 'PRIVATE SIBLING' } }] } }, { id: 'b', type: 'paragraph', props: { content: 'second' } }] }
describe('multi-selection boundaries', () => {
  it('sends exactly selected children without parent/sibling context', () => {
    const ctx = aiContext(doc, ['a', 'b'])
    expect(ctx.blocks.map(b => b.id)).toEqual(['a', 'b'])
    expect(JSON.stringify(ctx)).not.toContain('PRIVATE SIBLING')
  })
  it('rejects an entire mixed batch and invalid explicit selections', () => {
    const good = [{ op: 'update', id: 'a' }, { op: 'update', id: 'b' }]
    expect(limitToSelection(doc, ['a','b'], good).ops).toEqual(good)
    expect(limitToSelection(doc, ['a','b'], [...good,{ op:'update',id:'secret' }]).ops).toEqual([])
    expect(limitToSelection(doc, [], good).ops).toEqual([])
    expect(limitToSelection(doc, ['a','missing'], good).ops).toEqual([])
  })
  it('collects images only within the explicit union, never cover or siblings', () => {
    const images: any = { ...doc, cover: { src: 'cover' }, blocks: [{ id:'a', type:'image', props:{ src:'one' } },{ id:'b',type:'image',props:{src:'two'} },{ id:'secret',type:'image',props:{src:'private'} }] }
    expect(collectArticleImages(images, ['a','b'])).toEqual(['one','two'])
    expect(collectArticleImages(images, [])).toEqual([])
  })
  it('server checks every selected id and every returned operation', () => {
    const context = { blocks: [{ id:'a' },{ id:'b' }] }
    expect(() => editPrompt(context, 'edit', ['a','b'])).not.toThrow()
    expect(() => editPrompt(context, 'edit', ['a','missing'])).toThrow()
    expect(() => editPrompt(context, 'edit', [])).toThrow()
    expect(() => scopeEditResult({ ops:[{op:'update',id:'a'},{op:'remove',id:'b'}] }, ['a','b'])).toThrow()
    expect(scopeEditResult({ ops:[{op:'update',id:'a'}] }, ['a','b']).ops).toHaveLength(1)
  })
})
