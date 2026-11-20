import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { createProjectBackup } from './projectBackup'
import { saveNow, useStore } from './store'

export default function ProjectBackupModal({ onClose }: { onClose: () => void }) {
  const running = useRef(false)
  const dismissed = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    dismissed.current = false
    return () => { dismissed.current = true }
  }, [])
  const close = () => { dismissed.current = true; onClose() }
  const download = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      if (useStore.getState().saveStatus !== 'saved' && !await saveNow()) throw new Error('当前文稿尚未保存，未生成备份。请保存后重试。')
      if (dismissed.current) return
      const bytes = await createProjectBackup()
      if (dismissed.current) return
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `xiumi-projects-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (!dismissed.current) setError(failure instanceof Error ? failure.message : '未能生成备份。')
    } finally {
      running.current = false
      if (!dismissed.current) setBusy(false)
    }
  }
  return <Modal title="项目和素材备份" onClose={close}>
    <p>将已保存的项目和本机素材下载为 ZIP。不包含历史版本、模板、组件、自定义主题或账户配置。</p>
    <p className="hint">仅下载到本机，不上传。此版本不支持从这里恢复或迁移备份。</p>
    <p className="hint">备份前请确认项目引用的本机原图仍在素材库中。缺少已引用的素材时，离线恢复会停止，不修改原数据目录。</p>
    {error && <p role="alert" className="warn">{error}</p>}
    <div className="modal-actions">
      <button onClick={close}>关闭</button>
      <button className="primary" onClick={() => void download()} disabled={busy}>{busy ? '正在生成备份…' : '下载 ZIP 备份'}</button>
    </div>
  </Modal>
}
