import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

type DragMode = 'observe' | 'native'
type DragEventRow = {
  phase: string
  target: number | null
  hovered: number | null
  x: number | null
  y: number | null
  scrollY: number | null
  photoTransfer: boolean
}
type PhotoProbe = {
  records: DragEventRow[]
  finish: () => { records: DragEventRow[]; dropped: number }
}
type ProbeWindow = Window & { xiumiPhotoProbe?: PhotoProbe }

export async function diagnosePhotoDrag(page: Page, photos: Locator, testInfo: TestInfo, mode: DragMode) {
  await page.evaluate(() => {
    const imageSelector = 'img[data-photo]'
    const canvas = document.querySelector('[data-testid=canvas]')
    // Identity is just a zero-based slot among the three generated test photos.
    // No DOM attributes, URLs, transfer payload, body text or images are retained.
    const visibleSlots = [...(canvas?.querySelectorAll(imageSelector) ?? [])].slice(0, 3)
    const slot = (node: EventTarget | null) => {
      const photo = node instanceof Element ? node.closest(imageSelector) : null
      const index = photo ? visibleSlots.indexOf(photo) : -1
      return index < 0 ? null : index
    }
    const records: DragEventRow[] = []
    let dropped = 0
    function record(event: Event) {
      if (records.length >= 120) { dropped++; return }
      const cursor = event instanceof MouseEvent ? event : null
      const hovered = cursor ? document.elementFromPoint(cursor.clientX, cursor.clientY) : null
      records.push({
        phase: event.type,
        target: slot(event.target),
        hovered: slot(hovered),
        x: cursor?.clientX ?? null,
        y: cursor?.clientY ?? null,
        scrollY: document.querySelector('.canvas-scroll')?.scrollTop ?? null,
        photoTransfer: event instanceof DragEvent && (event.dataTransfer?.types.includes('application/x-xiumi-photo') ?? false),
      })
    }
    const names = ['mousedown', 'mouseup', 'dragstart', 'dragover', 'drop', 'dragend']
    names.forEach(name => document.addEventListener(name, record, { capture: true, passive: true }))
    const target = window as ProbeWindow
    target.xiumiPhotoProbe = {
      records,
      finish() {
        names.forEach(name => document.removeEventListener(name, record, true))
        delete target.xiumiPhotoProbe
        return { records, dropped }
      },
    }
  })
  try {
    if (mode === 'observe') {
      await photos.nth(0).dragTo(photos.nth(1))
      return
    }
    const source = photos.nth(0)
    const target = photos.nth(1)
    const phase = async (name: string) => page.evaluate(kind =>
      (window as ProbeWindow).xiumiPhotoProbe?.records.filter(row => row.phase === kind) ?? [], name)
    await source.scrollIntoViewIfNeeded()
    const start = await source.boundingBox()
    if (!start) throw new Error('The source photo is not visible')
    const startX = start.x + start.width / 2
    const startY = start.y + start.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 16, startY, { steps: 4 })
    // Record genuine events before moving the viewport, never dispatch DragEvent.
    await expect.poll(async () => (await phase('dragstart')).map(row => row.target)).toEqual([0])
    await target.scrollIntoViewIfNeeded()
    const end = await target.boundingBox()
    if (!end) throw new Error('The destination photo is not visible')
    const endX = end.x + end.width / 2
    const endY = end.y + end.height / 2
    await page.mouse.move(endX, endY, { steps: 4 })
    await page.mouse.move(endX + 1, endY)
    await expect.poll(async () => (await phase('dragover')).some(row => row.hovered === 1)).toBe(true)
    await page.mouse.up()
    await expect.poll(async () => (await phase('drop')).map(row => row.target)).toEqual([1])
  } finally {
    if (mode === 'native') await page.mouse.up().catch(() => undefined)
    try {
      const diagnostic = await page.evaluate(() => (window as ProbeWindow).xiumiPhotoProbe?.finish())
      if (diagnostic) await testInfo.attach('photo-drag-diagnostic', {
        body: JSON.stringify({ mode, ...diagnostic }),
        contentType: 'application/json',
      })
    } catch {
      // A diagnostic attachment must not change the result of the gesture/assertions.
    }
  }
}
