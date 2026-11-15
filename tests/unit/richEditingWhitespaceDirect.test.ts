import { expect, it } from 'vitest'

import { textToRich, richToPlain } from '../../src/core/richtext'

it('preserves editing spaces and blank paragraphs without changing import defaults', () => {
  const input = '  首段  \n\n 尾段 '
  expect(richToPlain(textToRich(input, { preserveWhitespace: true }), { preserveWhitespace: true })).toBe(input)
  expect(richToPlain(textToRich(input))).toBe('首段\n尾段')
})

it('changing module alignment replaces inline alignment while retaining marks', async () => {
  const { setRichAlignment } = await import('../../src/core/richtext')
  const rich = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '正文', marks: [{ type: 'bold' }] }] }] }
  expect(setRichAlignment(rich, 'right')).toMatchObject({ content: [{ attrs: { textAlign: 'right' }, content: [{ marks: [{ type: 'bold' }] }] }] })
  expect(rich.content[0].attrs.textAlign).toBe('center')
})

it('flattens list paragraphs once while preserving intentional blank paragraphs', () => {
  const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
  const rich = { type: 'doc', content: [p('活动安排'), { type: 'bulletList', content: [
    { type: 'listItem', content: [p('签到')] },
    { type: 'listItem', content: [p('合影'), p(''), p('结束')] },
  ] }, p('')] }
  const plain = richToPlain(rich, { preserveWhitespace: true })
  expect(plain).toBe('活动安排\n签到\n合影\n\n结束\n')
  expect(richToPlain(textToRich(plain, { preserveWhitespace: true }), { preserveWhitespace: true })).toBe(plain)
})
