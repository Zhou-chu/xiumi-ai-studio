import {expect,it} from 'vitest'
import {compileBlock} from '../../src/core/compiler'
import {createBlock} from '../../src/core/blocks'
import {resolveTheme} from '../../src/core/themes'
import {cleanText} from '../../src/core/slots'
it('preserves compiler spaces and normalized line boundaries on long runs',()=>{
 const text='a'+' '.repeat(200000)+'b'
 const html=compileBlock(createBlock('paragraph',{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}}),resolveTheme({themeId:'minimal-magazine'}))
 expect(html).toContain('a'+'&nbsp;'.repeat(200000)+'b')
 expect(cleanText('a'+' '.repeat(200000)+'\n'+' '.repeat(200000)+'b')).toBe('a\nb')
})
it('preserves one interior space but makes edge spaces nonbreaking',()=>{
 for(const text of [' x y ','x y','x  y',' ', 'x\n y','x \ny','x \n y']) {
 const html=compileBlock(createBlock('paragraph',{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}}),resolveTheme({themeId:'minimal-magazine'}))
 expect(html).toContain(text.replace(/(^ +| {2,}| +$)/g,s=>'&nbsp;'.repeat(s.length)))
 }
})
