import { expect, it } from 'vitest'
import { richCharCount, richToMarkdown, richToPlain, setRichAlignment, textToRich } from '../../src/core/richtext'
import type { RichNode, RichText } from '../../src/core/types'

const plain = (text: string): RichNode => ({ type: 'text', text })
const paragraph = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content })
const rich = (...content: RichNode[]): RichText => ({ type: 'doc', content })
const item = (...content: RichNode[]): RichNode => ({ type: 'listItem', content })

it('preserves meaningful whitespace, CRLF empty paragraphs and inline bold without editing plain segments',()=>{
 const r=textToRich(' a **bold** tail \r\n\r\n b **next**  ',{preserveWhitespace:true})
 expect(r.content).toEqual([paragraph(plain(' a '),{...plain('bold'),marks:[{type:'bold'}]},plain(' tail ')),
  paragraph(),paragraph(plain(' b '),{...plain('next'),marks:[{type:'bold'}]},plain('  '))])
 expect(textToRich('  \n\n  ')).toEqual(rich(paragraph()))
})

it('converts absent, incomplete and nested rich nodes to plain text without losing actual breaks',()=>{
 expect(richToPlain(undefined)).toBe('')
 expect(richToPlain(rich(paragraph(plain(' a '),{type:'hardBreak'},plain(' b '),{type:'text'}),paragraph(plain(' c '))),{preserveWhitespace:true})).toBe(' a \n b \n c ')
 expect(richCharCount(rich(paragraph(plain(' A '),{type:'hardBreak'},plain(' B '))))).toBe(2)
})

it('serializes marks, breaks, bullets, ordered items and generic block containers',()=>{
 const doc=rich({type:'blockWrapper',content:[
  paragraph({type:'inlineWrapper',content:[{...plain('Anchor'),marks:[{type:'bold'},{type:'italic'},{type:'link',attrs:{href:'https://example.invalid'}}]}]},{type:'hardBreak'},{...plain('loose'),marks:[{type:'ignore'},{type:'link'}]}),
  {type:'bulletList',content:[item(paragraph(plain('first')),paragraph(plain('cont.'))),item()]},
  {type:'orderedList',content:[item(paragraph(plain('alpha'))),item(paragraph(plain('beta')))]},
 ]})
 expect(richToMarkdown(undefined)).toBe('')
 expect(richToMarkdown({type:'doc'})).toBe('')
 expect(richToMarkdown(doc)).toBe('[***Anchor***](https://example.invalid)  \n[loose]()\n\n- first cont.\n- \n\n1. alpha\n2. beta')
})

it('sets alignment only on paragraph and heading descendants and preserves existing attrs and marks',()=>{
 const node:RichNode={...plain('keep'),marks:[{type:'bold'}]}
 const doc=rich({type:'heading',attrs:{level:3,textAlign:'right'},content:[node]}, {type:'blockquote',attrs:{quote:true},content:[paragraph(plain('body'))]})
 const untouched=structuredClone(doc)
 expect(setRichAlignment(doc,'justify')).toEqual(rich({type:'heading',attrs:{level:3,textAlign:'justify'},content:[node]},
 {type:'blockquote',attrs:{quote:true},content:[{...paragraph(plain('body')),attrs:{textAlign:'justify'}}]}))
 expect(doc).toEqual(untouched)
})

it('preserves marked editor heading text at its configured level in Markdown',()=>{
 const heading:RichNode={type:'heading',attrs:{level:3},content:[plain('Available '),{...plain('heading'),marks:[{type:'bold'}]}]}
 expect(richToMarkdown(rich(paragraph(plain('Before')),heading,paragraph(plain('After'))))).toBe('Before\n\n### Available **heading**\n\nAfter')
})

it.each([undefined,0,3.5,7,'2'])('uses the editor heading level for malformed metadata %s',level=>{
 expect(richToMarkdown(rich({type:'heading',attrs:{level},content:[plain('Keep title')]}))).toBe('### Keep title')
})

it('keeps the supported upper level and never invents an orphan marker for an empty heading',()=>{
 expect(richToMarkdown(rich({type:'heading',attrs:{level:6},content:[plain('Boundary')]}))).toBe('###### Boundary')
 expect(richToMarkdown(rich({type:'heading',attrs:{level:2}}))).toBe('')
})
