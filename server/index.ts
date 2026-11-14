import { join } from 'node:path'
import { createApp } from './app'
import { ROOT } from './store'
import { aiStatus } from './ai'
import { wechatStatus } from './wechat'

try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  /* 没有 .env 时使用默认配置 */
}

const port = Number(process.env.API_PORT ?? 5174)
createApp().listen(port, '127.0.0.1', async () => {
  const ai = await aiStatus()
  console.log(`XIUMI AI Studio API http://127.0.0.1:${port}  AI:${ai.enabled ? `${ai.name} / ${ai.model}` : '规则模式'}  微信:${wechatStatus().configured ? '已配置' : '未配置'}`)
})
