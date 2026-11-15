import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bestFrame } from '../../server/assets'

describe('动图取帧', () => {
  /** 每一帧画满前 n 行，其余透明（GIF 的透明只有全透明和不透明两种） */
  const frames = async (rows: number[]) => {
    const w = 8
    const h = 8
    const raw = Buffer.alloc(w * h * 4 * rows.length)
    rows.forEach((n, f) => {
      for (let i = 0; i < w * n; i++) raw.set([30, 120 + f * 20, 230, 255], (f * w * h + i) * 4)
    })
    return sharp(raw, { raw: { width: w, height: h * rows.length, channels: 4, pageHeight: h } }).gif().toBuffer()
  }
  it('picks the fullest frame when the first one is blank', async () => {
    expect(await bestFrame(await frames([0, 4, 8]))).toBe(2)
  })
  it('keeps the first frame of an ordinary animation or a still image', async () => {
    expect(await bestFrame(await frames([8, 8, 8]))).toBe(0)
    expect(await bestFrame(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer())).toBe(0)
  })
})
