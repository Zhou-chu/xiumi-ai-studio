import { describe, expect, it, vi } from 'vitest'
import { validateDraft } from '../../server/wechat'

vi.mock('../../server/store', () => ({
  DATA: '/private-test-path-not-used',
  readJson: () => { throw Error('Unexpected persistence read') },
  writeJson: () => { throw Error('Unexpected persistence write') },
}))
vi.mock('../../server/assets', () => ({ wechatReady: () => { throw Error('Unexpected asset probe') } }))

describe('draft validation of backgrounds', () => {
  const base = { title: '标题', thumb_media_id: 'm1' }
  it('rejects local and non-WeChat backgrounds', () => {
    expect(validateDraft({ ...base, content: '<section style="background-image: url(&quot;/media/a.jpg&quot;)"></section>' }).join()).toContain('背景图')
    expect(validateDraft({ ...base, content: '<section style="background-image: url(https://img.xiumi.us/a.jpg)"></section>' }).join()).toContain('背景图')
  })
  it('accepts WeChat backgrounds, gradients and svg paint references', () => {
    const content = '<section style="background-image: url(&quot;https://mmbiz.qpic.cn/a/0&quot;)"></section><section style="background-image: linear-gradient(0deg, #fff, #000)"></section><svg><rect fill="url(#a)"></rect></svg>'
    expect(validateDraft({ ...base, content })).toEqual([])
  })
})

describe('draft validation', () => {
  const ok = { title: '标题', content: '<section><img src="https://mmbiz.qpic.cn/x.jpg"></section>', thumb_media_id: 'm1' }
  it('accepts a valid article', () => {
    expect(validateDraft(ok)).toEqual([])
  })
  it('rejects oversize content, local images and missing cover', () => {
    const errs = validateDraft({ title: '', content: `<img src="/media/a.jpg">${'x'.repeat(20000)}`, thumb_media_id: '' })
    expect(errs.join('|')).toMatch(/标题不能为空.*20,000.*未上传到微信.*缺少封面/)
  })
})
