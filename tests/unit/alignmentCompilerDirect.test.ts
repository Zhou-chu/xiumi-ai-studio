// @vitest-environment jsdom
import { expect, it } from 'vitest'

import { textToRich } from '../../src/core/richtext'

it('exported paragraphs preserve deliberate indentation and repeated spaces', async () => {
  const { compileBlock } = await import('../../src/core/compiler')
  const { createBlock } = await import('../../src/core/blocks')
  const { THEMES } = await import('../../src/core/themes')
  const html = compileBlock(createBlock('paragraph', { content: textToRich('  缩进  间隔 ', { preserveWhitespace: true }) }), THEMES[0])
  const dom = new DOMParser().parseFromString(html, 'text/html')
  expect(dom.querySelector('p')?.textContent).toBe('\u00a0\u00a0缩进\u00a0\u00a0间隔\u00a0')
})

it('exports heading and list alignment', async () => {
  const { compileBlock } = await import('../../src/core/compiler')
  const { createBlock } = await import('../../src/core/blocks')
  const { THEMES } = await import('../../src/core/themes')
  const content = { type: 'doc', content: [
    { type: 'heading', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'Heading' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Item' }] }] }] },
  ] }
  const dom = new DOMParser().parseFromString(compileBlock(createBlock('paragraph', { content }), THEMES[0]), 'text/html')
  expect([...dom.querySelectorAll('p')].map(p => p.style.textAlign)).toEqual(['right', 'center'])
})
