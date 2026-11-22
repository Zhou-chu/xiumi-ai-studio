import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, type Locator } from '@playwright/test'

// Two static, inert fixture pages. This is a reference observation, not a
// claim that the application accepts cross-fragment archives or exports them.
const fixtures = [
  { source: 'upstream', file: 'upstream-native-svg-compiled.html', ids: ['art_trigger', 'art_explicit_target'] },
  { source: 'detached', file: 'synthetic-svg-detached.html', ids: ['xiumi-proof-1', 'xiumi-proof-2'] },
] as const

test.use({ hasTouch: true, offline: true })

const opacity = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).opacity, undefined, { timeout: 150 })

async function sample(locator: Locator): Promise<string | null> {
  // The browser evaluates synchronously, but the host also bounds the protocol
  // response. No dependency on timers/rAF inside a suspended opaque frame.
  const controller = new AbortController()
  try {
    return await Promise.race([
      opacity(locator).catch(() => null),
      delay(200, null, { signal: controller.signal }),
    ])
  } finally {
    controller.abort()
  }
}

async function observe(follower: Locator, target: Locator) {
  const started = performance.now()
  const deadline = started + 650
  const samples: Array<{ elapsedMs: number; timing: string | null; explicitHref: string | null }> = []
  while (performance.now() < deadline) {
    const elapsedMs = Math.round(performance.now() - started)
    const [timing, explicitHref] = await Promise.all([sample(follower), sample(target)])
    samples.push({ elapsedMs, timing, explicitHref })
    await delay(35)
  }
  const summarize = (key: 'timing' | 'explicitHref', expected: string) => {
    const values = [...new Set(samples.flatMap(item => item[key] ?? []))]
    return { status: values.includes(expected) ? 'observed' : values.length ? 'not-observed' : 'unevaluable',
      values, unreadableSamples: samples.filter(item => item[key] === null).length }
  }
  return { timing: summarize('timing', '0.3'), explicitHref: summarize('explicitHref', '0.4'), samples }
}

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
    // Cross-root timing/href remain observations, not release requirements.
    const observed = await observe(follower, explicitTarget)
    await page.reload()
    await expect(follower).toHaveCSS('opacity', '1')
    await expect(explicitTarget).toHaveCSS('opacity', '1')
    observations.push({ source, ...observed, reset: 'verified-opacity-1' })
  }
  const report = JSON.stringify({ chromium: page.context().browser()?.version(), observations, network })
  console.log('native-svg-cross-observation: ' + report)
  await test.info().attach('native-svg-cross-observation', { body: report, contentType: 'application/json' })
  expect(network).toEqual([])
})
