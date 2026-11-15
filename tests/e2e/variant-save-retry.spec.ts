import { expect, test } from '@playwright/test'

for (const change of ['none', 'edited', 'deleted'] as const) {
  test(`variant retry validates the persisted revision after partial failure: ${change}`, async ({ page }) => {
    const id = 'variant-retry-' + Date.now()
    const title = 'Original retained ' + change
    const original = { id, title, author: '', digest: '', themeId: 'minimal-magazine', blocks: [], createdAt: Date.now(), updatedAt: Date.now() }
    expect((await page.request.put('/api/projects/' + id, { data: original })).ok()).toBe(true)
    await page.goto('/')
    await expect(page.locator('.title-input')).toHaveValue(title)
    await page.getByTestId('open-import').click()
    await page.getByTestId('load-sample').click()
    await page.getByTestId('generate').click()
    await expect(page.getByTestId('save-all-variants')).toBeVisible()
    const writes = new Map<string, number>()
    const validationReads = new Set<string>()
    let failed = false
    await page.route('**/api/projects/*', async route => {
      const req = route.request()
      const target = new URL(req.url()).pathname.split('/').at(-1)!
      if (target === id) return route.continue()
      if (req.method() === 'GET') validationReads.add(target)
      if (req.method() !== 'PUT') return route.continue()
      writes.set(target, (writes.get(target) ?? 0) + 1)
      if (writes.size === 2 && !failed) {
        failed = true
        return route.fulfill({ status: 503, json: { error: 'Temporary variant write failure' } })
      }
      return route.continue()
    })
    await page.getByTestId('save-all-variants').click()
    await expect(page.getByTestId('variant-save-error')).toContainText('Temporary variant write failure')
    await expect(page.locator('.title-input')).toHaveValue(title)
    const first = writes.keys().next().value!
    const persisted = await (await page.request.get('/api/projects/' + first)).json()
    expect(persisted.revision).toEqual(expect.any(String))
    if (change === 'edited') {
      const response = await page.request.put('/api/projects/' + first, { data: { ...persisted, title: 'Remote winner' } })
      expect(response.ok()).toBe(true)
      const newer = await (await page.request.get('/api/projects/' + first)).json()
      expect(newer.revision).not.toBe(persisted.revision)
    } else if (change === 'deleted') {
      expect((await page.request.delete('/api/projects/' + first)).ok()).toBe(true)
      expect((await page.request.get('/api/projects/' + first)).status()).toBe(404)
    }
    await page.getByTestId('save-all-variants').click()
    if (change === 'none') {
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.title-input')).not.toHaveValue(title)
    } else {
      await expect(page.getByTestId('variant-save-error')).toContainText(change === 'edited' ? '已被其他页面修改' : '已被其他页面删除')
      await expect(page.locator('.title-input')).toHaveValue(title)
      expect([...writes.values()]).toEqual([1, 1])
      const current = await page.request.get('/api/projects/' + first)
      if (change === 'edited') expect((await current.json()).title).toBe('Remote winner')
      else expect(current.status()).toBe(404)
    }
    expect(writes.get(first)).toBe(1)
    expect(validationReads.has(first)).toBe(true)
  })
}
