import { once } from 'node:events'
import { createLocalMcp } from './tools'
import { createMcpHttp, serveMcpStdio } from './transport'

async function main() {
  const mcp = createLocalMcp(process.env.XIUMI_API ?? 'http://127.0.0.1:5174')
  const [mode, value = '5175', ...rest] = process.argv.slice(2)
  if (!mode) return serveMcpStdio(mcp, process.stdin, process.stdout)
  const port = Number(value)
  if (mode !== '--http' || rest.length || !/^\d{1,5}$/.test(value) || port < 1 || port > 65535) {
    throw new Error('用法: pnpm mcp [--http 端口]')
  }
  const server = createMcpHttp(mcp, process.env.XIUMI_MCP_TOKEN ?? '').listen(port, '127.0.0.1')
  await once(server, 'listening')
  console.error('XIUMI MCP HTTP 已启动，仅监听本机端口 ' + port)
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'XIUMI MCP 启动失败')
  process.exitCode = 1
})
