import { describe, expect, it } from 'vitest'
import { archivedRichLinkHref, markdownLinkDestination, richLinkHref } from '../../src/core/richLink'

describe('bounded editorial link data', () => {
  it.each(['https://example.org/a(b)?x=1&y=2', 'http://example.org/', 'MAILTO:editor@example.org?subject=Draft'])('keeps %s unchanged', href => {
    expect(archivedRichLinkHref(href)).toBe(href)
  })
  it.each([undefined, '', '/article', 'ftp://example.org', 'https://', 'https://example.org/two words', 'https://example.org/' + 'a'.repeat(2049), 'mailto:editor'])('declines an unsupported or malformed destination (%s)', href => {
    expect(archivedRichLinkHref(href)).toBeUndefined()
  })
  it.each(['/docs', './chapter', '#section', 'tel:+12025550123'])('keeps existing editor/export destination %s without enabling legacy admission', href => {
    expect(richLinkHref(href)).toBe(href)
    expect(archivedRichLinkHref(href)).toBeUndefined()
  })
  it('emits literal parentheses and protects entity-like query text', () => {
    expect(markdownLinkDestination('https://example.org/a(b)?x=1&copy;')).toBe('<https://example.org/a(b)?x=1&amp;copy;>')
  })
})
