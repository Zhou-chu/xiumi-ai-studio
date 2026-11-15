import { useLayoutEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { api, type Asset } from './api'
import { Modal } from './Modal'
import { useStore } from './store'

const RATIOS: [string, number | undefined][] = [
  ['自由', undefined],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['公众号封面 2.35:1', 2.35],
]

type CropModalProps = { asset: Asset; onClose: () => void; onDone: (a: Asset) => void }

export function CropModal(props: CropModalProps) {
  return <CropSession key={props.asset.id} {...props} />
}

function CropSession({ asset, onClose, onDone }: CropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState<number | undefined>(4 / 3)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef<symbol | null>(null)
  const pending = useRef(false)
  useLayoutEffect(() => {
    active.current = Symbol()
    return () => { active.current = null }
  }, [])
  const dismiss = () => {
    active.current = null
    onClose()
  }
  const save = async () => {
    const session = active.current
    if (!session || !area || pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const a = await api.cropAsset(asset.id, area)
      if (active.current === session) {
        useStore.getState().notify('已另存为新素材（原图保留）')
        onDone(a)
      } else {
        window.dispatchEvent(new Event('assets-changed'))
      }
    } catch (e: any) {
      if (active.current === session) useStore.getState().notify(e.message, 'error')
    } finally {
      pending.current = false
      if (active.current === session) setBusy(false)
    }
  }
  return (
    <Modal title={`裁剪：${asset.name}`} onClose={dismiss} width={720}>
      <div className="crop-area">
        <Cropper
          image={`/media/${asset.file}`}
          crop={crop}
          zoom={zoom}
          aspect={aspect ?? asset.width / asset.height}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, px) => setArea(px)}
          objectFit="contain"
        />
      </div>
      <div className="row gap">
        {RATIOS.map(([label, r]) => (
          <button key={label} className={aspect === r ? 'on' : ''} onClick={() => setAspect(r)}>
            {label}
          </button>
        ))}
        <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </div>
      <div className="modal-actions">
        <button onClick={dismiss}>取消</button>
        <button
          className="primary"
          disabled={!area || busy}
          onClick={save}
        >
          {busy ? '处理中…' : '裁剪并另存'}
        </button>
      </div>
    </Modal>
  )
}
