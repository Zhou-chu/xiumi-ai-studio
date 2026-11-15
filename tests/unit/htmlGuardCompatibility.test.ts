import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { compileBlock } from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { THEMES } from '../../src/core/themes'
const parse = (html: string) => new JSDOM(html, {url: 'https://fixture.invalid'}).window.document
it('guards the real stored HTML compiler boundary', () => {
 const b = createBlock('html', {html: '<a href="java&#x73;cript:alert(1)">text</a>', label: 'fixture'})
 expect(parse(compileBlock(b, THEMES[0])).querySelector('a')?.hasAttribute('href')).toBe(false)
})
