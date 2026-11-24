import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../core/types'
import { api } from './api'
import { stageHostedReplayUpload } from './hostedReplayClient'
import { download, prepareHostedReplayXiumi } from './wechatOutput'

export function useHostedReplayAction({ doc, safeName, notify, enabled }: {
  doc: Doc; safeName: string; notify: (message: string, mood?: 'error') => void; enabled: boolean
}) {
  const activeExport = useRef(false)
  const hostedRunning = useRef(false)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    activeExport.current = true
    return () => { activeExport.current = false }
  }, [])
  const runHostedReplay = async () => {
    if (!enabled || hostedRunning.current) return
    hostedRunning.current = true
    setBusy('正在预备本机素材…')
    try {
      const assets = await api.assets()
      if (!activeExport.current) return
      const plan = prepareHostedReplayXiumi(doc, assets)
      await plan.run({
        stage: stageHostedReplayUpload,
        confirmUpload: ({ images }) => {
          if (!activeExport.current || !confirm(
            `将把 ${images} 项图片发送到微信公众平台图床（不是秀米）。不会创建草稿或发布。\n\n部分上传后可能失败，已上传的图片无法撤回。是否允许上传？`,
          )) return false
          setBusy('上传图片到微信…')
          return true
        },
        confirmDownload: ({ actualParts }) => activeExport.current && confirm(
          `图片已上传到微信，重新编译后的实际分包为 ${actualParts} 份。是否下载？\n\n取消只停止本地下载，无法撤回已上传的图片。`,
        ),
        download: file => {
          download(`${safeName}-${file.name}`, file.blob)
          notify(file.parts > 1 ? `已下载 ${file.parts} 份，解压后依次导入秀米` : '已下载，在秀米“导入 HTML 代码”里使用')
        },
      })
    } catch (error) {
      notify(error instanceof Error ? error.message : '回放导出没有完成。', 'error')
    } finally {
      hostedRunning.current = false
      setBusy('')
    }
  }

  return [busy, runHostedReplay] as const
}
