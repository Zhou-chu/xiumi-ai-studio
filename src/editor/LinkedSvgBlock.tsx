import { renderCrossSvgPreview, type LinkedSvgScene } from '../core/crossSvgPreview'
import type { Block } from '../core/types'

export function LinkedSvgCanvasBody({ block }: { block: Block<'linkedSvg'> }) {
  const scene = block.props.scene
  if (!scene) return <p role="status">跨块 SVG 联动的数据有误</p>
  const html = renderCrossSvgPreview({ ...scene, context: false })
  return html ? <iframe
    title="跨块 SVG 联动"
    sandbox=""
    srcDoc={html}
    width="100%"
    height={Math.min(500, scene.sourceBox.height + scene.followerBox.height + 32)}
    style={{ border: 0 }}
  /> : <p role="status">跨块 SVG 联动的数据有误</p>
}

export function LinkedSvgFields({ scene, onChange }: {
  scene: LinkedSvgScene | null
  onChange: (scene: LinkedSvgScene, field: 'timing' | 'target') => void
}) {
  if (!scene) return <p role="status">跨块 SVG 联动的数据有误</p>
  const field = (key: 'timing' | 'target', label: string) => <label className="field">
    <span>{label}</span>
    <select value={scene[key]} onChange={event => onChange({ ...scene, [key]: Number(event.currentTarget.value) }, key)}>
      {Array.from({ length: 9 }, (_, i) => <option value={i + 1} key={i}>0.{i + 1}</option>)}
    </select>
  </label>
  return <>
    {field('timing', '跟随图形的联动透明度')}
    {field('target', '目标图形的联动透明度')}
    <p className="hint">点击预览中的触发图形可检查联动。可下载本地 HTML 保留效果；不支持发布到公众号或秀米。</p>
  </>
}
