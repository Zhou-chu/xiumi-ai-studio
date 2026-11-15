import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { articleToHtmlBlocks, cardContent, contentLayer, detectSource, extractArticle, splitHtmlBlock } from '../../src/core/wxImport'
import { createBlock } from '../../src/core/blocks'
const parse=(s:string)=>new JSDOM(s).window.document
const root=(s:string)=>parse('<body><main>'+s+'</main>').querySelector('main')!
const serialized=(blocks:ReturnType<typeof articleToHtmlBlocks>)=>blocks.map(b=>b.type === 'html' ? b.props.html : '').join('')

describe('article import boundaries',()=>{
  it.each([
    ['<img>','other'],['<div powered-by="unknown"></div>','other'],['<div powered-by="xiumi"></div>','xiumi'],
    ['<img src="https://qlogo.cn/photo">','wechat'],
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
    expect(serialized(articleToHtmlBlocks(root('<p></p><p>Text</p>')))).toBe('<p>Text</p>')
  })
  it.each(['transform:rotate(1deg)','display:grid','box-shadow:0 0 2px #000','border-width:1px','height:200px','max-height:200px','background-image:url(https://example.com/a.jpg)','display:flex','display:inline-flex'])('preserves non-splittable shell %s',style=>{
    const b=createBlock('html',{html:`<section style="${style}"><p style="background:#eee">A</p><p style="background:#ddd">B</p></section>`})
    const out=articleToHtmlBlocks(root('<p>Prefix</p>'+b.props.html),6,true)
    expect(out).toHaveLength(2);expect(serialized(out.slice(1))).toBe(b.props.html)
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

})

describe('full-page clipboard normalization', () => {
  it('extracts the marked reading body and leaves the source DOM intact', () => {
    const doc = parse('<article><header class="tn-board-head"><h2>Page title</h2></header><main class="tn-article-body"><section style="margin-left:-24px; margin-right:5px; padding-left:24px; padding-right:12px; padding-top:8px; color:red"><p>正文</p><img data-src="//example.invalid/body.jpg"></section></main><footer>阅读与投诉</footer></article>')
    const original = doc.body.innerHTML
    const article = extractArticle(doc)
    expect(article.title).toBe('Page title')
    expect(article.root.textContent).toBe('正文')
    expect(article.root.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/body.jpg')
    const style = article.root.firstElementChild?.getAttribute('style')
    expect(style).toContain('padding-top: 8px')
    expect(style).toContain('color: red')
    expect(style).not.toMatch(/(?:margin|padding)-(?:left|right)/)
    expect(doc.body.innerHTML).toBe(original)
  })

  it('does not accidentally discard short peer content or override explicit WeChat body selection', () => {
    const peers = extractArticle(parse('<main><p>短篇</p></main><aside style="position:fixed">同等的正文内容</aside>'))
    expect(peers.root.textContent).toContain('同等的正文内容')
    const explicit = extractArticle(parse('<main class="tn-article-body"><p>非正文</p></main><div id="js_content"><p>微信正文</p></div>'))
    expect(explicit.root.textContent).toBe('微信正文')
    expect(explicit.source.kind).toBe('wechat')
  })

  it('reveals orphaned fade-in layers without activating transparent hit targets or animated layers', () => {
    const doc = parse('<main id="js_content"><svg viewBox="0 0 100 100"><g opacity="0"><rect opacity="0" width="100" height="100"></rect></g></svg><svg viewBox="0 0 100 100"><g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="1s"></animate></g></svg></main>')
    const { root } = extractArticle(doc)
    const [orphan, animated] = root.querySelectorAll('g')
    expect(orphan.getAttribute('opacity')).toBeNull()
    expect(orphan.querySelector('rect')?.getAttribute('opacity')).toBe('0')
    expect(animated.getAttribute('opacity')).toBe('0')
    expect(animated.querySelector('animate')).not.toBeNull()
    expect(doc.querySelector('g')?.getAttribute('opacity')).toBe('0')
  })
})
