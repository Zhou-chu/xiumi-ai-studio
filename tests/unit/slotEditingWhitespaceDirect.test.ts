// @vitest-environment jsdom
import { expect, it } from 'vitest'

it('imported HTML slot editing retains spaces and empty lines on reopen', async () => {
  const { extractSlots, fillSlots } = await import('../../src/core/slots')
  const html = '<section><p style="color:red">原文段落</p></section>'
  const next = fillSlots(html, { t0: '  开头  \n\n结尾 ' }, { split: false, bold: false, preserveWhitespace: true })
  expect(extractSlots(next, undefined, true)[0]).toMatchObject({ text: '  开头  \n\n结尾 ' })
})

it('imported slot alignment changes only the selected paragraph', async () => {
  const { setSlotAlign } = await import('../../src/core/slots')
  const next = setSlotAlign('<p style="color:red"><strong>第一段</strong></p><p>第二段</p>', 't0', 'right')
  const dom = new DOMParser().parseFromString(next, 'text/html')
  expect(dom.querySelector('p')?.style.textAlign).toBe('right')
  expect(dom.querySelector('strong')?.textContent).toBe('第一段')
  expect(dom.querySelectorAll('p')[1].style.textAlign).toBe('')
})

it('keeps English word gaps breakable when editing imported slots', async () => {
  const { fillSlots } = await import('../../src/core/slots')
  const html = fillSlots('<p>text</p>', { t0: '  hello world  again ' }, { preserveWhitespace: true })
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('p')?.textContent).toBe('\u00a0\u00a0hello world\u00a0\u00a0again\u00a0')
})

it('aligns inline or bare slots without changing siblings', async () => {
  const { setSlotAlign } = await import('../../src/core/slots')
  for (const html of ['<section>lead<p>sibling</p></section>', '<span>lead</span><p>sibling</p>']) {
    const dom = new DOMParser().parseFromString(setSlotAlign(html, 't0', 'right'), 'text/html')
    const sibling = [...dom.querySelectorAll('p')].find(el => el.textContent === 'sibling')!
    expect(sibling.closest('[style*="text-align"]')).toBeNull()
    expect(dom.querySelector('[style*="text-align"]')?.textContent).toBe('lead')
  }
})

it('preserves blank lines in bare imported text slots', async () => {
  const { fillSlots, extractSlots } = await import('../../src/core/slots')
  const next = fillSlots('<section>lead<p>sibling</p></section>', { t0: ' a\n\nb ' }, { preserveWhitespace: true })
  expect(extractSlots(next, undefined, true)[0]).toMatchObject({ text: ' a\n\nb ' })
})

it('aligns inline paragraph slots without breaking their inherited style or siblings', async () => {
  const { setSlotAlign, slotAligns } = await import('../../src/core/slots')
  for (const title of ['章节标题', '<span>章节标题</span>', '<strong><span>章节标题</span></strong>']) {
    let html = `<p style="font-size:18px;color:red">${title}<svg><text>01</text></svg></p>`
    for (const align of ['center', 'right', 'left'] as const) {
      html = setSlotAlign(html, 't0', align)
      const dom = new DOMParser().parseFromString(html, 'text/html')
      expect(dom.querySelectorAll('p')).toHaveLength(1)
      const p = dom.querySelector('p')!
      expect(p.style.fontSize).toBe('18px')
      expect(p.style.color).toBe('red')
      expect(p.textContent).toBe('章节标题01')
      expect(p.querySelector('svg')).not.toBeNull()
      expect(p.querySelector('svg')!.closest('[style*="text-align"]')).toBeNull()
      expect(slotAligns(html).t0.align).toBe(align)
    }
  }
})
