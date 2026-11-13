// @vitest-environment jsdom
import {describe,it,expect} from 'vitest'
import {compileBlock,compileDoc,variantUrl,blockGap,lintWechatHtml,rootStyle} from '../../src/core/compiler'
import {createBlock} from '../../src/core/blocks'
import {resolveTheme} from '../../src/core/themes'
import {textToRich} from '../../src/core/richtext'
import {emptyDoc} from '../../src/editor/store'
const theme=resolveTheme({themeId:'minimal-magazine'})
const image={src:'/media/source.jpg?old=1',width:800,height:600,displayWidth:55}
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
const render=(type:any,props:any={},opts:any={})=>compileBlock(createBlock(type,props),theme,opts)
describe('compiler boundary outputs',()=>{
 it('image variant URLs retain external URLs but deterministically replace local transform queries',()=>{
  expect(variantUrl('/media/a.png?previous=1','4:3',720)).toBe('/media/a.png?fit=4%3A3&w=720');expect(variantUrl('/media/a.png')).toBe('/media/a.png?w=1080');expect(variantUrl('https://example.com/a.png?x=1','1:1')).toBe('https://example.com/a.png?x=1')
 })
 it('all cover variants preserve escaping and optional fields with and without image',()=>{
  for(const variant of ['auto','band','hero','minimal']) for(const populated of [false,true]) {
   const html=render('cover',{variant,title:'Title <&>',titleAlign:populated?'right':'auto',subtitle:populated?'Subtitle':'',meta:populated?'Meta':'',kicker:populated?'Kicker':'',image:populated?image:undefined})
   expect(html).toContain('Title &lt;&amp;&gt;');expect(parse(html).querySelectorAll('img')).toHaveLength(populated?1:0);expect(html.includes('Subtitle')).toBe(populated);expect(html).not.toMatch(/undefined|NaN/)
  }
 })
 it('heading variants render optional numbering/subtitle without collapsing hierarchy',()=>{
  for(const variant of ['auto','number','bar','pill','underline']) for(const extra of [false,true]) {
   const html=render('heading',{variant,title:'Heading',index:extra?'03':'',subtitle:extra?'Subheading':''});expect(html).toContain('Heading');expect(html.includes('Subheading')).toBe(extra);expect(html.includes('03')).toBe(extra);expect(parse(html).querySelectorAll('p').length).toBeGreaterThan(0)
  }
 })
 it('card and quotation variants retain all authored text with absent optional labels',()=>{
  for(const variant of ['auto','accent','fill','outline']) for(const named of [false,true]){const html=render('card',{variant,title:named?'Card title':'',content:textToRich('Card body')});expect(html).toContain('Card body');expect(html.includes('Card title')).toBe(named)}
  for(const variant of ['auto','mark','center','line']) for(const named of [false,true]){const html=render('quote',{variant,text:'Quoted <text>',source:named?'Source':''});expect(html).toContain('Quoted &lt;text&gt;');expect(html.includes('Source')).toBe(named)}
 })
 it('imageText, image and profile optional images preserve dimensions and mapped sources',()=>{
  for(const side of ['left','right'])for(const hasImage of [false,true]){const html=render('imageText',{side,image:hasImage?image:undefined,title:'Image text title',content:textToRich('Body')},{mapImage:(url:string)=>'https://cdn.example.com/'+encodeURIComponent(url)});expect(html).toContain('Body');expect(parse(html).querySelectorAll('img')).toHaveLength(hasImage?1:0);if(hasImage)expect(html).toContain('https://cdn.example.com/')}
  for(const variant of ['auto','plain','frame'])for(const present of [false,true]){const html=render('image',{variant,image:present?image:undefined,caption:present?'Caption':''});if(present){expect(html).toContain('55%');expect(html).toContain('Caption')}else expect(html).not.toContain('<img')}
  for(const present of [false,true]){const html=render('profile',{name:'Person',role:'Role',bio:present?'Biography':'',image:present?image:undefined});expect(html).toContain('Person');expect(parse(html).querySelectorAll('img')).toHaveLength(present?1:0);expect(html.includes('Biography')).toBe(present)}
 })
 it('gallery columns correctly crop rows, preserve captions and handle empty images',()=>{
  expect(render('gallery',{images:[]})).toContain('请添加图片')
  for(const columns of [1,2,3])for(const caption of ['', 'Gallery caption']){const html=render('gallery',{columns,images:[image,{...image,src:'/media/b.png'},{...image,src:'https://example.com/c.png'},{...image,src:'/media/d.png'}],caption});const imgs=parse(html).querySelectorAll('img');expect(imgs).toHaveLength(4);expect(html.includes('Gallery caption')).toBe(!!caption);expect(imgs[0].getAttribute('src')).toContain(columns===1?'w=1080':columns===2?'fit=4%3A3':'fit=1%3A1');expect(html).not.toMatch(/NaN|undefined/)}
 })
 it('timeline, tables, dividers and endings include optional data and valid empty forms',()=>{
  const timeline=render('timeline',{items:[{time:'09:00',title:'Opening',desc:'Details'},{time:'10:00',title:'Close',desc:''}]});expect(timeline).toContain('Details');expect(timeline).toContain('transparent');expect(render('timeline',{items:[]})).toBe('')
  for(const caption of ['', 'Table caption']){const table=render('table',{headers:['Name','Value'],rows:[['a','1'],['b','2']],caption});expect(parse(table).querySelectorAll('td')).toHaveLength(4);expect(table.includes('Table caption')).toBe(!!caption)}
  for(const variant of ['auto','line','space','dots','diamond'])expect(render('divider',{variant})).toMatch(/section|p style/)
  for(const populated of [false,true]){const html=render('ending',{text:populated?'Thank you':'',note:populated?'Note':'',author:populated?'Author':'',image:populated?image:undefined});expect(html).toContain('END');expect(html.includes('Author')).toBe(populated);expect(parse(html).querySelectorAll('img')).toHaveLength(populated?1:0)}
 })
 it('rich nodes preserve marks, font allowlist, explicit alignment, whitespace and links',()=>{
  const rich:any={type:'doc',content:[{type:'paragraph',attrs:{textAlign:'right'},content:[{type:'text',text:'  Marked  text ',marks:[{type:'bold'},{type:'italic'},{type:'underline'},{type:'strike'},{type:'highlight',attrs:{color:'#abc'}},{type:'textStyle',attrs:{color:'#112233',fontSize:'22px',fontFamily:'Noto Serif SC'}},{type:'link',attrs:{href:'https://mp.weixin.qq.com/s/post'}}]},{type:'hardBreak'},{type:'wrapper',content:[{type:'text',text:'Nested'}]},{type:'wrapper'}]},{type:'heading',content:[{type:'text',text:'Rich heading'}]},{type:'paragraph'},{type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'Block quote'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',attrs:{textAlign:'center'},content:[{type:'text',text:'Bullet one'}]}]},{type:'listItem'}]},{type:'orderedList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Number one'}]}]},{type:'listItem',content:[{type:'paragraph'}]}]},{type:'heading'},{type:'unsupported'}]}
  const html=render('paragraph',{content:rich});expect(html).toContain('&nbsp;&nbsp;Marked&nbsp;&nbsp;text&nbsp;');expect(html).toContain('text-align:right');expect(html).toContain('<strong');expect(html).toContain('color:#112233');expect(html).toContain('Rich heading');expect(html).toContain('●');expect(html).toContain('2.');expect(html).toContain('https://mp.weixin.qq.com/s/post');expect(html).toContain('Nested')
  const link=(href:any)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',marks:[{type:'link',attrs:{href}}],text:'Link'}]}]})
  expect(render('paragraph',{content:link('https://example.com')})).not.toContain('<a ');expect(render('paragraph',{content:link('https://example.com')},{externalLinks:'keep'})).toContain('<a ');expect(render('paragraph',{content:link(undefined)})).not.toContain('<a ')
 })
 it('invalid text colors/fonts are not emitted and default marks remain visible',()=>{
  const rich:any={type:'doc',content:[{type:'paragraph',content:[{type:'text',marks:[{type:'textStyle',attrs:{color:'url(javascript:x)',fontFamily:'evil;position:absolute',fontSize:'9999px'}},{type:'highlight'},{type:'bold'},{type:'unknown'}]},{type:'text',text:'Visible',marks:[{type:'bold'}]}]},{type:'bulletList'},{type:'orderedList'}]};const html=render('paragraph',{content:rich});expect(html).not.toContain('javascript');expect(html).not.toContain('position:absolute');expect(html).toContain('Visible');expect(render('paragraph',{content:undefined})).toBe('')
 })
 it('raw HTML maps images and local backgrounds but never imports editor chrome or scripts',()=>{
  const html=render('html',{html:'<section style="background-image:url(&quot;/media/bg.png?x=1&amp;y=2&quot;)"><img src="/media/photo.png?x=1&amp;y=2"><script>alert(1)</script><p>Original font</p></section>'},{mapImage:(url:string)=>'https://cdn.example.com/'+encodeURIComponent(url)});expect(html).not.toContain('<script');expect(html).toContain(encodeURIComponent('/media/bg.png?x=1&y=2'));expect(html).toContain(encodeURIComponent('/media/photo.png?x=1&y=2'));expect(html).toContain('Original font')
 })
 it('nested boxes adapt children but reject recursive boxes and preserve sibling spacing',()=>{
  const child=createBlock('paragraph',{content:textToRich('Inside')});const nested=createBlock('box',{title:'Forbidden nested',children:[]});const box=createBlock('box',{children:[child,nested,createBlock('heading',{title:'Child heading'})]});const html=compileBlock(box,theme);expect(html).toContain('Inside');expect(html).toContain('Child heading');expect(html).not.toContain('Forbidden nested');expect(html).toContain('margin-bottom:16px');expect(compileBlock(createBlock('box',{children:[]}),theme)).not.toContain('undefined')
  const plain=createBlock('html',{html:'<p>Original</p>'});expect(blockGap(plain,plain,theme)).toBe(0);expect(blockGap(plain,undefined,theme)).toBe(0);expect(blockGap(plain,child,theme)).toBe(theme.blockSpacing)
 })
 it('document compile preserves valid neighbors of damaged blocks and reports every static warning',()=>{
  const doc={...emptyDoc(),blocks:[createBlock('paragraph',{content:textToRich('Healthy')}),{id:'bad',type:'unknown',props:{}} as any,createBlock('frame')]};const out=compileDoc(doc);expect(out.html).toContain('Healthy');expect(out.charCount).toBe(out.html.length);expect(out.warnings.some(w=>w.includes('第 2'))).toBe(true);expect(out.warnings.some(w=>w.includes('图片位置'))).toBe(true)
  const warnings=lintWechatHtml('<script></script><style></style><p class="x" id="y" style="position:fixed;color:var(--x)"><img src="http://localhost/a"><img src="https://img.xiumi.us/a"><a href="https://example.com">a</a></p>'+'x'.repeat(20000));expect(warnings).toHaveLength(10);expect(lintWechatHtml('<p>clean</p>')).toEqual([]);expect(rootStyle(theme)).toContain('word-break:break-word')
 })
 it('theme-dependent automatic variants and matching heading font inherit correctly',()=>{
  for(const themeId of ['tsinghua-purple','minimal-magazine','warm-paper']){const t=resolveTheme({themeId});for(const type of ['cover','heading','card','quote','divider'] as const)expect(compileBlock(createBlock(type),{...t,fontHeading:t.fontBody})).not.toContain('undefined')}
 })
})

it('profile reset typography is a style attribute rather than visible CSS text',()=>{
 const html=render('profile',{name:'Ada',role:'Editor',bio:'Biography'})
 expect(parse(html).body.textContent).not.toContain('font-size:')
 expect(parse(html).body.textContent).not.toContain('line-height:')
 const name=[...parse(html).querySelectorAll('p')].find(p=>p.textContent==='Ada')!
 expect(name.parentElement!.getAttribute('style')).toContain('font-size:')
})
