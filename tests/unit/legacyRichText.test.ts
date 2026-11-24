import { describe, expect, it } from 'vitest'
import { acceptsLegacyRichText } from '../../server/legacyRichText'

const budget = () => ({ nodes: 0, characters: 0 })
const rich = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] })
const text = (marks?: unknown) => ({ type: 'text', text: '安全正文', ...(marks === undefined ? {} : { marks }) })

describe('bounded legacy text compatibility', () => {
  it('accepts structured empty paragraphs, safe native styling, and line breaks without altering any input', () => {
    const input = {
      type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null } }, {
        type: 'paragraph', attrs: { textAlign: 'center' }, content: [
          text([{ type: 'underline' }, { type: 'strike' }, { type: 'textStyle', attrs: { color: null, fontFamily: 'Noto Sans SC, sans-serif', fontSize: '18px' } }]),
          { type: 'hardBreak' },
          text([{ type: 'highlight', attrs: { color: '#fff' } }]),
        ],
      }],
    }
    const expected = structuredClone(input)
    expect(acceptsLegacyRichText(input, budget())).toBe(true)
    expect(input).toEqual(expected)
  })

  it.each([
    null,
    { type: 'doc', content: [] },
    { type: 'doc', content: [], attrs: {} },
    { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'start' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: null }] },
    rich({ type: 'hardBreak', attrs: {} }),
    rich({ type: 'text', text: '' }),
    rich({ type: 'text', text: 'x'.repeat(20_001) }),
    rich(text({})),
    rich(text([{ type: 'bold', attrs: {} }])),
    rich(text([{ type: 'bold' }, { type: 'bold' }])),
    rich(text([{ type: 'textStyle', attrs: { fontFamily: 'invalid!', fontSize: '18px' } }])),
    rich(text([{ type: 'textStyle', attrs: { color: 'not-a-color' } }])),
    rich(text([{ type: 'textStyle', attrs: { fontSize: '999px' } }])),
    rich(text([{ type: 'highlight', attrs: { style: '#fff' } }])),
    rich(text([{ type: 'link', attrs: { href: 'https://example.invalid' } }])),
    rich({ type: 'paragraph', content: [text()] }),
  ])('rejects invalid or not-yet-supported content without coercion', value => {
    expect(acceptsLegacyRichText(value, budget())).toBe(false)
  })

  it('applies aggregate node and character limits across text blocks', () => {
    expect(acceptsLegacyRichText(rich(text()), { nodes: 7_998, characters: 0 })).toBe(false)
    const shared = { nodes: 0, characters: 499_995 }
    expect(acceptsLegacyRichText(rich(text()), shared)).toBe(true)
    expect(acceptsLegacyRichText(rich(text()), shared)).toBe(false)
  })
})
