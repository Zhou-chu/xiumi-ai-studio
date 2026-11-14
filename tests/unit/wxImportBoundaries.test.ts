import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { articleToHtmlBlocks, articleToMarkdown, cardContent, contentLayer, detectSource, extractArticle, splitHtmlBlock } from '../../src/core/wxImport'
import { createBlock } from '../../src/core/blocks'
const parse=(s:string)=>new JSDOM(s).window.document
const root=(s:string)=>parse('<body><main>'+s+'</main>').querySelector('main')!
const serialized=(blocks:ReturnType<typeof articleToHtmlBlocks>)=>blocks.map(b=>(b.props as any).html).join('')

describe('article import boundaries',()=>{
  it.each([
    ['<img>','other'],['<div powered-by="unknown"></div>','other'],['<div powered-by="xiumi"></div>','xiumi'],
    ['<img src="https://qlogo.cn/photo">','wechat'],['<section style="background-image:url(https://img.xiumi.us/a.jpg)"></section>','xiumi'],
    ['<img data-src="//img.xiumi.us/a.jpg">','xiumi'],['<div id="js_content"></div>','wechat'],
  ])('detects source from %s',(s,kind)=>expect(detectSource(parse(s))).toBe(kind))
  it('prioritizes metadata, falls back to script title and heading, and sanitizes clones only',()=>{
    const a=extractArticle(parse('<meta property="og:title" content=" Meta "><meta name="author" content="A"><meta property="og:description" content="D"><meta property="og:image" content="http://example.com/a.jpg"><meta property="og:article:author" content="Account"><div class="rich_media_content"><p onclick="evil()">body</p></div>'))
    expect(a).toMatchObject({title:'Meta',author:'A',digest:'D',account:'Account',cover:'https://example.com/a.jpg'});expect(a.root.innerHTML).not.toContain('onclick')
    expect(extractArticle(parse('<script>var msg_title="Script title"</script><h1>Other</h1>')).title).toBe('Script title')
    expect(extractArticle(parse('<h1>Heading</h1>')).title).toBe('Heading')
    expect(extractArticle(parse('<p>body</p>')).title).toBe('')
    expect(extractArticle(parse('<div id="activity-name">Activity</div><div id="js_name">Name</div>'),'https://mp.weixin.qq.com/s/a').source).toMatchObject({kind:'wechat',title:'Activity',account:'Name'})
  })
  it('stops content descent at own text, unsupported or layout elements',()=>{
    for(const s of ['own<section><p>body</p></section>','<article><p>body</p></article>','<section style="display:grid"><p>body</p></section>']){
      const r=root(s);expect(contentLayer(r).layer).toBe(r)
    }
    const r=root('<section style="background:#eee"><div><p>A</p><p>B</p></div></section>');expect(contentLayer(r).wrappers).toHaveLength(1)
  })
  it('escapes loose text, skips comments, groups plain text and retains blank blocks',()=>{
    const r=root(' A &amp; B &lt; C <!--comment--><p></p><p>One</p><p>Two</p><p style="background:#eee">Styled</p><p></p>')
    const blocks=articleToHtmlBlocks(r,1);expect(blocks.length).toBeGreaterThan(2)
    const out=serialized(blocks);expect(out).toContain('A &amp; B &lt; C');expect(out).not.toContain('comment');expect(out).toContain('<p></p>')
    expect(serialized(articleToHtmlBlocks(root('<p></p><p>Text</p>')))).toContain('<p></p>')
  })
  it.each(['transform:rotate(1deg)','display:grid','box-shadow:0 0 2px #000','border-width:1px','height:200px','max-height:200px','background-image:url(https://example.com/a.jpg)','display:flex','display:inline-flex'])('preserves non-splittable shell %s',style=>{
    const b=createBlock('html',{html:`<section style="${style}"><p style="background:#eee">A</p><p style="background:#ddd">B</p></section>`})
    const out=articleToHtmlBlocks(root('<p>Prefix</p>'+b.props.html),6,true);expect(out).toHaveLength(2);expect((out[1].props as any).html).toContain('A');expect((out[1].props as any).html).toContain('B')
  })
  it('preserves rows formed by inline-block columns and non-section shells',()=>{
    for(const s of ['<article style="background:#eee"><p>A</p><p>B</p></article>','<section><div style="display:inline-block;width:40%;background:#eee">A</div><div style="display:inline-block;width:40%;background:#ddd">B</div></section>'])expect(articleToHtmlBlocks(root('<p>Prefix</p>'+s),6,true)).toHaveLength(2)
    expect(splitHtmlBlock(createBlock('html',{html:'<p>A</p>'}),()=>parse('<body>'))).toBeNull()
  })
  it.each(['padding:4px','padding:4px 8px','padding:4px 8px 12px','padding:4px 8px 12px 16px'])('splits repeat backgrounds and carries edge decoration %s',padding=>{
    const b=createBlock('html',{html:`<section style="background-image:url(https://example.com/a.jpg);background-repeat:repeat-y;${padding};margin:10px;border:1px solid #000;border-radius:8px;font-size:16px"><p style="background:#eee">A</p><p style="background:#ddd">B</p><p style="background:#ccc">C</p></section>`,source:{kind:'original',title:'T',url:'',account:''}})
    const parts=splitHtmlBlock(b,parse)!;expect(parts).toHaveLength(3);expect(parts[0].props.source).toEqual(b.props.source)
    expect(parts[1].props.html).toContain('border-top: none');expect(parts[1].props.html).toContain('padding-top: 0');expect(parts[1].props.html).toContain('border-radius: 0 0 0 0')
    expect(cardContent.get(parts[0])).toBeUndefined() // returned clones carry source metadata, not WeakMap identity
  })
  it.each(['margin:10px','margin-top:20px;margin-bottom:10px','margin:1em','margin:-5px','margin:10px;overflow:hidden','margin:10px;padding-top:4px','margin:10px;border-top:1px solid #000','margin:10px;min-height:20px'])('keeps or conservatively skips collapse for %s',style=>{
    const r=root(`<section style="background:#eee"><div style="${style}"><p style="margin:15px">A</p></div><div style="${style}"><p style="margin:5px">B</p></div></section>`)
    const blocks=articleToHtmlBlocks(r,1,true);expect(serialized(blocks)).toContain('A');expect(serialized(blocks)).toContain('B')
  })
  it('retains naked image/decoration labels and inherited styles in forced cards',()=>{
    const r=root('<section style="background:#eee;color:#123456"><div style="border:1px solid #000"><img src="https://example.com/a.jpg"></div><div style="border:1px solid #000"><hr></div><div style="background:#ddd"><p>A</p><p>B</p></div></section>')
    const blocks=articleToHtmlBlocks(r,1,true);expect(blocks.length).toBeGreaterThan(1);expect(serialized(blocks)).toContain('#123456')
  })
  it('converts semantic markdown, inherited size, tables, images and deduplicated headers',()=>{
    const a=extractArticle(parse('<h1>Title</h1><main id="js_content"><h2>Title</h2><p style="font-size:20px">01</p><section style="font-size:20px"><p>Section</p></section><p><strong>Bold heading</strong></p><p>A long sentence with punctuation.</p><blockquote>Quote</blockquote><li>List item</li><table><tr><td>A|B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></table><table></table><img><img src="https://example.com/a.jpg"><img src="https://example.com/a.jpg"><figure><span><img src="https://example.com/b.jpg"></span></figure><p></p></main>'))
    const result=articleToMarkdown(a);expect(result.images).toEqual(['https://example.com/a.jpg','https://example.com/b.jpg'])
    expect(result.markdown).toContain('## Section');expect(result.markdown).toContain('> Quote');expect(result.markdown).toContain('- List item');expect(result.markdown).toContain('| A/B | C |');expect(result.markdown).not.toContain('## 01');expect(result.markdown).not.toContain('## Title')
    expect(articleToMarkdown(extractArticle(parse('<p>Text</p><p>Other</p>'))).markdown).toContain('Text')
  })
})
it('does not strip a unique top-level unsafe shell before split checks',()=>{
  for(const style of ['height:200px','max-height:200px','box-shadow:0 0 2px #000','background-image:url(https://example.com/a.jpg)','border-width:1px']){
    const b=createBlock('html',{html:`<section style="${style}"><p style="background:#eee">A</p><p style="background:#ddd">B</p></section>`})
    expect(splitHtmlBlock(b,parse)).toBeNull()
    expect(serialized(articleToHtmlBlocks(root(b.props.html)))).toContain(style)
  }
})
it('preserves nested unordered and ordered list semantics in Markdown',()=>{
  const a=extractArticle(parse('<div id="js_content"><ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul><ol start="3"><li>Third<ol><li>Inner</li></ol></li><li>Fourth</li></ol></div>'))
  const md=articleToMarkdown(a).markdown
  expect(md).toContain('- First\n  - Nested\n- Second')
  expect(md).toContain('3. Third\n   1. Inner\n4. Fourth')
})
it('keeps safe ordered starts including zero but strips invalid and unrelated start attributes',()=>{
  const a=extractArticle(parse('<div id="js_content"><ol start="0"><li>Zero<img src="https://example.com/a.jpg"></li></ol><ol start="-2"><li>Negative</li></ol><ol start="bad"><li>Default</li></ol><p start="3">Paragraph</p><ul><li>Plain</li></ul></div>'))
  const md=articleToMarkdown(a);expect(md.markdown).toContain('0. Zero');expect(md.markdown).toContain('-2. Negative');expect(md.markdown).toContain('1. Default');expect(md.images).toEqual(['https://example.com/a.jpg'])
  expect(a.root.querySelector('p')?.hasAttribute('start')).toBe(false)
  expect(a.root.querySelectorAll('ol')[2].hasAttribute('start')).toBe(false)
  a.root.querySelector('ol')!.setAttribute('start','bad')
  expect(articleToMarkdown(a).markdown).toContain('1. Zero')
})
