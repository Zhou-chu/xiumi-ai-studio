/* global window, document, navigator, DataTransfer, ClipboardEvent, console */
import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const browser = await chromium.launch({ headless: true })
try {
  for (const mode of ['api', 'fallback']) {
    const context = await browser.newContext()
    await context.route('https://**/*', route => route.abort())
    await context.addInitScript(({ mode }) => {
      window.__copies = []
      if (mode === 'api') {
        Object.defineProperty(navigator, 'clipboard', { value: { write: async items => {
          window.__copies.push(await items[0].getType('text/html').then(blob => blob.text()))
        } } })
      } else {
        Object.defineProperty(navigator, 'clipboard', { value: undefined })
        document.execCommand = command => {
          if (command !== 'copy') return false
          const data = new DataTransfer()
          document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, cancelable: true }))
          window.__copies.push(data.getData('text/html'))
          return true
        }
      }
    }, { mode })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(pathToFileURL(resolve('templates/eea-germany/eea-germany-template.html')).href)
    await page.locator('.demo .copy').first().click()
    await page.waitForFunction(() => window.__copies.length === 1)
    await page.locator('#copy-all').click()
    await page.waitForFunction(() => window.__copies.length === 2)
    const result = await page.evaluate(() => ({ copies: window.__copies.map(html => html.length), modules: document.querySelectorAll('.demo').length, success: document.querySelector('.demo .copy').classList.contains('done'), toast: document.getElementById('toast').textContent }))
    if (errors.length || !result.success || result.modules !== 15 || result.copies[1] <= result.copies[0]) throw new Error(JSON.stringify({ mode, errors, result }))
    console.log(JSON.stringify({ mode, errors, ...result }))
    await context.close()
  }
} finally { await browser.close() }
