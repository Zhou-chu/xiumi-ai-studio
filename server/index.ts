import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { isAbsolute, join } from 'node:path'
import { createApp } from './app'
import { DATA, ROOT } from './store'
import { mountDesktopDataRoutes } from './desktopRoutes'
import { aiStatus } from './ai'
import { wechatStatus } from './wechat'

const systemRoot = process.env.SystemRoot
const ownedPortable = process.platform === 'win32' && process.env.XIUMI_OWNED_PORTABLE_LAUNCH === '1'

try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  /* 没有 .env 时使用默认配置 */
}

const port = Number(process.env.API_PORT ?? 5174)
const app = createApp()
if (ownedPortable && systemRoot && isAbsolute(systemRoot) && !systemRoot.startsWith('\\\\')) {
  const explorer = join(systemRoot, 'explorer.exe')
  mountDesktopDataRoutes(app, () => {
    const address = listener.address()
    if (!address || typeof address === 'string') return undefined
    return {
      origin: `http://127.0.0.1:${address.port}`,
      dataDir: DATA,
      async openFolder(folder) {
        const child = spawn(explorer, [folder], { shell: false, detached: true, stdio: 'ignore' })
        await once(child, 'spawn')
        child.unref()
      },
    }
  })
}
const listener = app.listen(port, '127.0.0.1', async () => {
  const ai = await aiStatus()
  console.log(`XIUMI AI Studio API http://127.0.0.1:${port}  AI:${ai.enabled ? `${ai.name} / ${ai.model}` : '规则模式'}  微信:${wechatStatus().configured ? '已配置' : '未配置'}`)
})
