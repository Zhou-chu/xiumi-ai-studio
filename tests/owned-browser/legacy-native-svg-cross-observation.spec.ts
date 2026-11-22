import { expect, test, type Locator } from '@playwright/test'

// Two static, inert fixture pages. This is a reference observation, not a
// claim that the application accepts cross-fragment archives or exports them.
const fixtures = [
  { source: 'upstream', file: 'upstream-native-svg-compiled.html', ids: ['art_trigger', 'art_explicit_target'] },
  { source: 'detached', file: 'synthetic-svg-detached.html', ids: ['xiumi-proof-1', 'xiumi-proof-2'] },
] as const

test.use({ hasTouch: true, offline: true })

const css = (l: Locator, property: string) => l.evaluate((element, key) => getComputedStyle(element).getPropertyValue(key), property)

test('observes upstream and detached SVG timing and href separately in offline Chromium', async ({ page }) => {
  const network: string[] = []
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  const observations = []
  for (const { source, file, ids } of fixtures) {
    await page.goto(new URL('../fixtures/legacy-backup/' + file, import.meta.url).href)
    const doc = source === 'detached' ? page.frameLocator('iframe[sandbox=""]') : page
    const svg = doc.locator('svg')
    await expect(svg).toHaveCount(5)
    const trigger = doc.locator('#' + ids[0])
    const explicitTarget = doc.locator('#' + ids[1])
    const follower = svg.nth(3).locator('rect')
    const click = svg.nth(0).locator('rect')
    const touch = svg.nth(1).locator('rect')
    await expect(click).toHaveCSS('visibility', 'visible')
    await expect(touch).toHaveCSS('opacity', '1')
    await expect(follower).toHaveCSS('opacity', '1')
    await expect(explicitTarget).toHaveCSS('opacity', '1')
    if (source === 'detached') {
      await page.getByRole('button', { name: 'Outer decoy' }).click()
      await expect(follower).toHaveCSS('opacity', '1')
      await expect(explicitTarget).toHaveCSS('opacity', '1')
    }
    await click.click()
    await expect(click).toHaveCSS('visibility', 'hidden')
    await touch.click()
    await expect(touch).toHaveCSS('opacity', '1')
    await touch.tap()
    await expect(touch).toHaveCSS('opacity', '0.2')
    await trigger.click()
    // Give native SMIL scheduled frames a bounded window. Upstream support for
    // either cross-root effect is an observation, not a release requirement.
    const observed = []
    for (let i = 0; i < 8; i++) {
      await follower.evaluate(element => new Promise<void>(resolve => element.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
      observed.push([await css(follower, 'opacity'), await css(explicitTarget, 'opacity')])
    }
    await page.reload()
    await expect(follower).toHaveCSS('opacity', '1')
    await expect(explicitTarget).toHaveCSS('opacity', '1')
    observations.push({ source, timing: [...new Set(observed.map(item => item[0]))],
      explicitHref: [...new Set(observed.map(item => item[1]))],
      reset: [await css(follower, 'opacity'), await css(explicitTarget, 'opacity')] })
  }
  const report = JSON.stringify({ chromium: page.context().browser()?.version(), observations, network })
  console.log('native-svg-cross-observation: ' + report)
  await test.info().attach('native-svg-cross-observation', { body: report, contentType: 'application/json' })
  expect(network).toEqual([])
})
