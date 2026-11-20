// 第一版验收：导入约 2000 字 + 10 张图的活动推文 → 三种结构不同的排版 → 拖拽修改 → 保存 → 导出 → 复制
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const blockTypes = (page: Page) => page.locator('[data-testid=canvas] [data-block-type]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.blockType))

async function waitSaved(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
}

const canvasImages = '[data-testid=canvas] img'

async function waitImages(page: Page, transientFailures: Set<string>) {
  const images = page.locator(canvasImages)
  await expect(images.first()).toBeAttached()
  await page.waitForFunction(selector => [...document.querySelectorAll<HTMLImageElement>(selector)].every(i => i.complete), canvasImages, { timeout: 10_000 })
  const { broken, retried } = await images.evaluateAll(async (elements, failed) => {
    const retried = new Set<string>()
    const hasPixels = async (image: HTMLImageElement) => {
      try {
        await image.decode()
        return image.naturalWidth > 0 && image.naturalHeight > 0
      } catch {
        return false
      }
    }
    const bad = await Promise.all((elements as HTMLImageElement[]).map(async image => {
      if (await hasPixels(image)) return null
      const source = image.currentSrc || image.src
      const url = new URL(source, location.href)
      // A broken image is also "complete". Retry only the observed loopback
      // socket fault, never a 404, invalid body or ordinary decode failure.
      if (url.origin === location.origin && url.pathname.startsWith('/media/')
        && !url.searchParams.has('e2e-image-retry') && failed.includes(url.href)) {
        retried.add(url.href)
        url.searchParams.set('e2e-image-retry', '1')
        image.src = url.href
        if (await hasPixels(image)) return null
      }
      return source
    }))
    return { broken: bad.filter(src => src !== null), retried: [...retried] }
  }, [...transientFailures])
  for (const url of retried) {
    transientFailures.delete(url)
    console.warn('Retried a canvas image after a transient runner socket error:', url)
  }
  expect(broken, 'Canvas images failed to decode').toEqual([])
}

test('canvas readiness retries only the observed transient media failure and requires real pixels', async ({ page }) => {
  const path = '/media/snapshot-image-fixture.jpg'
  const attempts = new Map<string, number>()
  await page.route(/\/media\/snapshot-image-fixture\.jpg(?:\?|$)/, route => {
    const url = new URL(route.request().url())
    const scenario = url.searchParams.get('scenario')!
    attempts.set(scenario, (attempts.get(scenario) ?? 0) + 1)
    if (scenario === 'missing') return route.fulfill({ status: 404, body: 'not found' })
    if (scenario === 'corrupt') return route.fulfill({ contentType: 'image/jpeg', body: 'no image pixels' })
    if (scenario === 'persistent') return route.abort()
    // Chromium cannot deterministically exhaust Windows sockets on demand. Abort the
    // actual request and inject the observation the runner made for ERR_NO_BUFFER_SPACE.
    return attempts.get(scenario) === 1
      ? route.abort()
      : route.fulfill({ contentType: 'image/jpeg', body: readFileSync('samples/photo-01.jpg') })
  })
  await page.route(/\/snapshot-image-fixture\/(?:recoverable|missing|corrupt|persistent)$/, route => {
    const scenario = new URL(route.request().url()).pathname.split('/').at(-1)
    return route.fulfill({ contentType: 'text/html', body: `<main data-testid="canvas"><img src="${path}?scenario=${scenario}"></main>` })
  })
  await page.goto('/snapshot-image-fixture/recoverable')
  const before = new URL(`${path}?scenario=recoverable`, page.url()).href
  await waitImages(page, new Set([before]))
  expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(attempts.get('recoverable')).toBe(2)
  for (const scenario of ['missing', 'corrupt']) {
    await page.goto(`/snapshot-image-fixture/${scenario}`)
    await expect(waitImages(page, new Set())).rejects.toThrow('Canvas images failed to decode')
    expect(attempts.get(scenario)).toBe(1)
  }
  await page.goto('/snapshot-image-fixture/persistent')
  const persistent = new URL(`${path}?scenario=persistent`, page.url()).href
  await expect(waitImages(page, new Set([persistent]))).rejects.toThrow('Canvas images failed to decode')
  expect(attempts.get('persistent')).toBe(2)
})

async function importSample(page: Page) {
  await page.goto('/')
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await expect(page.locator('.import-step .hint')).toContainText('图片 10 张')
  await page.getByTestId('generate').click()
  await expect(page.locator('.variant')).toHaveCount(3)
}

test('三种排版结构不同，且都使用了全部 10 张图', async ({ page }) => {
  const transientFailures = new Set<string>()
  page.on('requestfailed', request => {
    if (request.resourceType() === 'image' && request.failure()?.errorText === 'net::ERR_NO_BUFFER_SPACE') {
      transientFailures.add(request.url())
    }
  })
  await importSample(page)
  const signatures: string[] = []
  for (const id of ['narrative', 'cards', 'photo']) {
    const card = page.getByTestId(`variant-${id}`)
    const imgs = await card.locator('.mini-inner img').evaluateAll((els) => new Set(els.map((e) => (e as HTMLImageElement).getAttribute('src')!.split('?')[0])).size)
    expect(imgs, id).toBe(10)
  }
  for (const id of ['narrative', 'cards', 'photo']) {
    if (id !== 'narrative') {
      await page.getByTestId('open-import').click()
      await page.getByTestId('load-sample').click()
      await expect(page.locator('.import-step .hint')).toContainText('图片 10 张')
      await page.getByTestId('generate').click()
    }
    await page.getByTestId(`choose-${id}`).click()
    await waitSaved(page)
    signatures.push((await blockTypes(page)).join(','))
    // 视觉回归：展开滚动容器、隐藏面板与提示，画布完整渲染后与基线比较（首次运行生成基线）
    const printCss = await page.addStyleTag({ content: '.app{height:auto}.workspace{display:block}.panel,.toast,.toolbar{display:none!important}.canvas-scroll{overflow:visible}' })
    await page.mouse.move(0, 0)
    await waitImages(page, transientFailures)
    await expect(page.getByTestId('canvas')).toHaveScreenshot(`layout-${id}.png`, { animations: 'disabled' })
    await printCss.evaluate((el) => (el as HTMLElement).remove())
  }
  expect(new Set(signatures).size).toBe(3)
})

test('拖拽添加与排序、撤销重做、保存后刷新仍在', async ({ page }) => {
  await importSample(page)
  await page.getByTestId('choose-cards').click()
  await waitSaved(page)
  const before = await blockTypes(page)

  // 从左侧拖入「时间轴」到画布末尾
  await page.locator('.drop-end').scrollIntoViewIfNeeded()
  const src = (await page.getByTestId('lib-timeline').boundingBox())!
  const dst = (await page.locator('.drop-end').boundingBox())!
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2, { steps: 5 })
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect.poll(async () => (await blockTypes(page)).length).toBe(before.length + 1)
  expect((await blockTypes(page)).at(-1)).toBe('timeline')

  // 撤销 / 重做
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await blockTypes(page)).length).toBe(before.length)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await blockTypes(page)).length).toBe(before.length + 1)

  // 拖动第二个模块的手柄到封面之上
  const second = page.locator('[data-testid=canvas] [data-block-type]').nth(1)
  await second.click()
  const handle = second.locator('.block-toolbar .drag')
  const cover = page.locator('[data-testid=canvas] [data-block-type]').first()
  const hb = (await handle.boundingBox())!
  const cb = (await cover.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 20, { steps: 5 })
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 10, { steps: 15 })
  await page.mouse.up()
  await expect.poll(async () => (await blockTypes(page))[0]).toBe(before[1])

  await waitSaved(page)
  const after = await blockTypes(page)
  await page.reload()
  await expect.poll(async () => (await blockTypes(page)).join(',')).toBe(after.join(','))
})

test('导出 Markdown / JSON / HTML，并以富文本复制到剪贴板', async ({ page }) => {
  await importSample(page)
  await page.getByTestId('choose-narrative').click()
  await waitSaved(page)
  await page.getByTestId('open-export').click()

  const dl = async (name: string) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()])
    return readFileSync((await d.path())!, 'utf8')
  }
  const md = await dl('Markdown')
  expect(md).toMatch(/^# 2026 秋季校园科技文化节/)
  expect((md.match(/!\[/g) ?? []).length).toBeGreaterThanOrEqual(10)
  const json = JSON.parse(await dl('编辑器 JSON'))
  expect(json.blocks.length).toBeGreaterThan(10)
  const html = await dl('微信 HTML（图片内嵌）')
  expect(html).not.toContain('<script')
  expect((html.match(/src="data:image\//g) ?? []).length).toBeGreaterThanOrEqual(10)

  await page.getByTestId('copy-wechat').click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const h = await (await item.getType('text/html')).text()
    return { types: item.types, html: h }
  })
  expect(clip.types).toContain('text/html')
  expect(clip.html).toContain('<section')
  expect(clip.html).not.toMatch(/\sclass=|<script|<style/)
  expect((clip.html.match(/src="data:image\//g) ?? []).length).toBeGreaterThanOrEqual(10)
  await expect(page.locator('.export-section .report')).toContainText('通过静态兼容检查')
})
