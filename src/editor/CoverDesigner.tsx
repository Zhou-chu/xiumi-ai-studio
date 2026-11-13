import { Help } from './Help'
// 封面设计：在 canvas 上合成 900×383（2.35:1）公众号封面，导出 PNG 存入素材库。
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveTheme } from '../core/themes'
import { api, assetRef, type Asset } from './api'
import { Modal } from './Modal'
import { useStore } from './store'

const W = 900
const H = 383
type Layout = 'gradient' | 'block' | 'band'

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line)
      line = ch
    } else line += ch
  }
  if (line) lines.push(line)
  return lines
}

export function CoverDesigner({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const { setDocFields, notify } = useStore.getState()
  const { themeId, themeOverrides } = doc
  const theme = useMemo(() => resolveTheme({ themeId, themeOverrides }), [themeId, themeOverrides])
  const canvas = useRef<HTMLCanvasElement>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [bg, setBg] = useState<string | undefined>(doc.cover?.src ?? (doc.blocks.find((b) => b.type === 'cover') as any)?.props.image?.src)
  const [title, setTitle] = useState(doc.title)
  const [kicker, setKicker] = useState((doc.blocks.find((b) => b.type === 'cover') as any)?.props.kicker ?? '')
  const [layout, setLayout] = useState<Layout>('gradient')
  const [busy, setBusy] = useState(false)
  const [titleTooLong, setTitleTooLong] = useState(false)
  const [renderedKey, setRenderedKey] = useState('')
  const renderKey = JSON.stringify([bg, title, kicker, layout, theme])
  const currentRenderKey = useRef(renderKey)
  currentRenderKey.current = renderKey
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  useEffect(() => {
    api.assets().then(setAssets).catch(() => {})
  }, [])

  useEffect(() => {
    setRenderedKey('')
    let cancelled = false
    ;(async () => {
      const cv = canvas.current
      if (!cv) return
      const ctx = cv.getContext('2d')!
      const c = theme.colors
      ctx.fillStyle = c.primary
      ctx.fillRect(0, 0, W, H)
      if (bg) {
        try {
          const img = await loadImg(`${bg.split('?')[0]}?w=1200`)
          if (cancelled) return
          const s = Math.max(W / img.width, H / img.height)
          ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s)
        } catch {
          /* 图片加载失败时保留纯色背景 */
        }
      }
      if (cancelled) return
      const font = (size: number, weight = 700) => `${weight} ${size}px "PingFang SC","Microsoft YaHei",sans-serif`
      if (layout === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, W * 0.75, 0)
        g.addColorStop(0, c.primary + 'F2')
        g.addColorStop(0.55, c.primary + 'B3')
        g.addColorStop(1, c.primary + '00')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      } else if (layout === 'block') {
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.fillRect(48, 64, W * 0.56, H - 128)
        ctx.fillStyle = c.primary
        ctx.fillRect(48, 64, 8, H - 128)
      } else {
        ctx.fillStyle = c.primary + 'E6'
        ctx.fillRect(0, H - 130, W, 130)
      }
      const dark = layout === 'block'
      ctx.fillStyle = dark ? c.accent : '#ffffff'
      ctx.font = font(22, 600)
      const x = layout === 'block' ? 80 : 56
      let y = layout === 'band' ? H - 92 : layout === 'block' ? 112 : 110
      if (kicker && layout !== 'band') {
        ctx.fillText(kicker, x, y)
        y += 52
      }
      ctx.fillStyle = dark ? c.text : '#ffffff'
      let size = layout === 'band' ? 36 : 44
      const maxW = layout === 'band' ? W - 112 : W * 0.5
      const maxLines = layout === 'band' ? 2 : 3
      ctx.font = font(size)
      let lines = wrap(ctx, title, maxW)
      // Fit ordinary long titles without sacrificing readable type. If the
      // full title still cannot fit, explicitly block exporting a partial one.
      while (lines.length > maxLines && size > 24) {
        size -= 1
        ctx.font = font(size)
        lines = wrap(ctx, title, maxW)
      }
      const overflow = lines.length > maxLines
      lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.3))
      setTitleTooLong(overflow)
      setRenderedKey(renderKey)
    })()
    return () => {
      cancelled = true
    }
  }, [bg, title, kicker, layout, theme, renderKey])

  const save = async () => {
    if (renderedKey !== renderKey || titleTooLong) {
      notify('封面尚未准备好或标题过长，请缩短标题并等待预览更新。', 'error')
      return
    }
    const expected = useStore.getState().doc
    setBusy(true)
    try {
      const blob = await new Promise<Blob>((r) => canvas.current!.toBlob((b) => r(b!), 'image/jpeg', 0.92))
      const [a] = await api.uploadAssets([new File([blob], `cover-${Date.now()}.jpg`, { type: 'image/jpeg' })])
      if (!active.current) return
      if (useStore.getState().doc !== expected || currentRenderKey.current !== renderKey) {
        notify('等待期间文稿或封面已变化，已保留当前内容。生成图片仍可从素材库选择。', 'error')
        window.dispatchEvent(new Event('assets-changed'))
        return
      }
      setDocFields({ cover: assetRef(a) })
      window.dispatchEvent(new Event('assets-changed'))
      notify('封面已生成并设置')
      onClose()
    } catch (e: any) {
      if (active.current) notify(e.message, 'error')
    } finally {
      if (active.current) setBusy(false)
    }
  }

  return (
    <Modal title="封面设计（900×383，2.35:1）" onClose={onClose} width={980}>
      <canvas ref={canvas} width={W} height={H} className="cover-canvas" />
      {titleTooLong && <p role="alert" className="warn">标题过长，超出当前版式的可用空间，预览未显示完整标题。请缩短标题或切换版式后再生成；不会导出截断的标题。</p>}
      <Help title="封面裁切">公众号会从封面中裁出 1:1 区域作为小图，重要内容尽量放在左侧 383px 内。</Help>
      <div className="row gap wrap">
        <div className="seg">
          {(['gradient', 'block', 'band'] as Layout[]).map((l) => (
            <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>{{ gradient: '渐变叠字', block: '白底标题框', band: '底部色带' }[l]}</button>
          ))}
        </div>
        <input value={kicker} placeholder="小标签" onChange={(e) => setKicker(e.target.value)} />
        <input className="grow" value={title} placeholder="标题" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="asset-strip">
        <button className={!bg ? 'on' : ''} onClick={() => setBg(undefined)}>纯色</button>
        {assets.map((a) => (
          <img key={a.id} className={bg?.startsWith(`/media/${a.file}`) ? 'on' : ''} src={`/media/${a.file}?fit=1:1&w=120`} alt="" onClick={() => setBg(`/media/${a.file}`)} />
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        {bg && <button onClick={() => { const a = assets.find((x) => bg.startsWith(`/media/${x.file}`)); if (a) { setDocFields({ cover: assetRef(a) }); notify('已直接使用原图作为封面'); onClose() } }}>直接用原图</button>}
        <button className="primary" disabled={busy || titleTooLong || renderedKey !== renderKey} onClick={save}>{busy ? '生成中…' : '生成并设为封面'}</button>
      </div>
    </Modal>
  )
}
