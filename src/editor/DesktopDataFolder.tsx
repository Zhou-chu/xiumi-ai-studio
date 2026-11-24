import { useEffect, useRef, useState } from 'react'

export function DesktopDataFolder({ reportFailure }: { reportFailure: (message: string) => void }) {
  const lifetime = useRef<AbortController>(undefined)
  const active = useRef(false)
  const [available, setAvailable] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const discover = async () => {
      try {
        const response = await fetch('/api/app/info', { redirect: 'error', signal: controller.signal })
        if (!response.ok) return
        const info: { canOpenFolder?: unknown } | null = await response.json()
        if (!controller.signal.aborted && info?.canOpenFolder === true) setAvailable(true)
      } catch {
        // An ordinary Web runtime has no desktop folder action.
      }
    }
    void discover()
    return () => controller.abort()
  }, [])

  async function open() {
    const signal = lifetime.current?.signal
    if (!available || active.current || !signal || signal.aborted) return
    active.current = true
    setPending(true)
    try {
      const response = await fetch('/api/app/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"target":"data"}',
        redirect: 'error',
        signal,
      })
      if (!response.ok) throw new Error('Desktop action failed')
      const result: { opened?: unknown } | null = await response.json()
      if (result?.opened !== true) throw new Error('Desktop action was not accepted')
    } catch {
      if (!signal.aborted) reportFailure('无法打开数据目录，请检查当前安装后重试。')
    } finally {
      active.current = false
      if (!signal.aborted) setPending(false)
    }
  }

  return available
    ? <button type="button" disabled={pending} onClick={() => void open()}>{pending ? '正在打开数据目录…' : '打开数据目录'}</button>
    : null
}
