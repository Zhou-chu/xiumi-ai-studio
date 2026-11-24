import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Readable, Writable } from 'node:stream'
import { record, type LocalMcp } from './tools'

const MAX_BODY = 5_000_000
const BATCH_LIMIT = 16
const MAX_BATCH_CONTENT = 16 * 1024 * 1024
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
type RpcId = string | number | null

const fail = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const reply = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const isRpcId = (id: unknown): id is RpcId => id === null || typeof id === 'string' || Number.isSafeInteger(id)

function initialize(params: unknown) {
  const requested = record(params) ? params.protocolVersion : undefined
  const protocolVersion = typeof requested === 'string' && PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0]
  return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'xiumi-ai-studio', version: '0.1.0' } }
}

async function one(mcp: LocalMcp, message: unknown) {
  if (!record(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return fail(null, -32600, 'Invalid Request')
  }
  // A notification has no ID and must never invoke side-effecting tools.
  if (!Object.hasOwn(message, 'id')) return null
  if (!isRpcId(message.id)) return fail(null, -32600, 'Invalid Request')
  const { id, params, method } = message
  switch (method) {
    case 'initialize': return reply(id, initialize(params))
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: mcp.catalog })
    case 'tools/call':
      if (!record(params) || typeof params.name !== 'string') return fail(id, -32602, 'Invalid params')
      return reply(id, await mcp.invoke(params.name, params.arguments))
    case 'resources/list': return reply(id, { resources: [] })
    case 'prompts/list': return reply(id, { prompts: [] })
    default: return fail(id, -32601, 'Method not found')
  }
}

export async function dispatchMcp(mcp: LocalMcp, value: unknown) {
  if (!Array.isArray(value)) return one(mcp, value)
  if (!value.length || value.length > BATCH_LIMIT) return fail(null, -32600, 'Invalid Request')
  const responses = []
  let budget = MAX_BATCH_CONTENT
  for (const item of value) {
    const response = await one(mcp, item)
    if (!response) continue
    const size = Buffer.byteLength(JSON.stringify(response))
    if (size > budget) responses.push(fail(response.id, -32000, 'Batch response limit reached'))
    else {
      budget -= size
      responses.push(response)
    }
  }
  return responses.length ? responses : null
}

function parse(source: string): { valid: true; value: unknown } | { valid: false } {
  try { return { valid: true, value: JSON.parse(source) } }
  catch { return { valid: false } }
}

class PayloadTooLarge extends Error {}

async function requestBody(req: IncomingMessage) {
  let bytes = 0
  const chunks: Buffer[] = []
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new PayloadTooLarge()
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length
    if (bytes > MAX_BODY) throw new PayloadTooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

function authentication(token: string) {
  if (!/^[A-Za-z0-9._~-]{16,256}$/.test(token)) throw new Error('HTTP 需要在 XIUMI_MCP_TOKEN 配置 16–256 字符的本机令牌')
  const expected = Buffer.from('Bearer ' + token)
  return (value: string | undefined) => {
    const supplied = Buffer.from(value ?? '')
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  }
}

function localRequest(req: IncomingMessage) {
  const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(req.headers.host ?? '')
  return match && Number(match[2]) === req.socket.localPort && req.headers.origin === undefined
}

const CALL_PATH = /^\/call\/([\w]+)$/

async function handleHttp(mcp: LocalMcp, req: IncomingMessage, res: ServerResponse) {
  const path = req.url ?? ''
  if (req.method === 'GET' && path === '/tools') return json(res, 200, mcp.catalog)
  const match = CALL_PATH.exec(path)
  if (req.method !== 'POST' || (path !== '/mcp' && !match)) return json(res, 404, { error: '未知接口' })
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: '必须发送 JSON' })
  const data = parse(await requestBody(req))
  if (!data.valid) return json(res, 400, fail(null, -32700, 'Parse error'))
  if (match) {
    const result = await mcp.invoke(match[1], data.value)
    return json(res, result.isError ? 400 : 200, result)
  }
  const result = await dispatchMcp(mcp, data.value)
  if (result !== null) return json(res, 200, result)
  res.writeHead(202, { 'cache-control': 'no-store' })
  res.end()
}

export function createMcpHttp(mcp: LocalMcp, token: string) {
  const allowed = authentication(token)
  const server = createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, (req, res) => {
    if (!localRequest(req)) return json(res, 403, { error: '只允许本机非浏览器请求' })
    if (!allowed(req.headers.authorization)) return json(res, 401, { error: '缺少或错误的 Bearer token' })
    void handleHttp(mcp, req, res).catch(error => {
      if (res.destroyed) return
      if (error instanceof PayloadTooLarge) {
        res.setHeader('Connection', 'close')
        return json(res, 413, { error: '请求太大' })
      }
      return json(res, 400, { error: '无效的本机请求' })
    })
  })
  server.maxConnections = 16
  return server
}

function writeLine(output: Writable, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    output.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve())
  })
}

async function stdioReply(mcp: LocalMcp, output: Writable, line: string) {
  if (!line.trim()) return
  const data = parse(line)
  const result = data.valid ? await dispatchMcp(mcp, data.value) : fail(null, -32700, 'Parse error')
  if (result !== null) await writeLine(output, result)
}

export async function serveMcpStdio(mcp: LocalMcp, input: Readable, output: Writable) {
  let line = ''
  let bytes = 0
  let dropped = false
  input.setEncoding('utf8')
  for await (const chunk of input) {
    const pieces = String(chunk).split('\n')
    for (const [index, piece] of pieces.entries()) {
      bytes += Buffer.byteLength(piece)
      if (bytes > MAX_BODY) { line = ''; dropped = true }
      if (!dropped) line += piece
      if (index + 1 === pieces.length) continue
      if (dropped) await writeLine(output, fail(null, -32600, 'Request too large'))
      else await stdioReply(mcp, output, line)
      line = ''
      bytes = 0
      dropped = false
    }
  }
}
