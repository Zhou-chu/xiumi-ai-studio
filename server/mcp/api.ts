const API_TIMEOUT_MS = 15_000
const MAX_RESPONSE = 12 * 1024 * 1024

export function loopbackApi(config: string): string {
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::([\d]{1,5}))?\/?$/.exec(config)
  if (!match || Number(match[1]) > 65535 || Number(match[1]) === 0) {
    throw new Error('XIUMI_API 必须是本机 HTTP 地址，例如 http://127.0.0.1:5174')
  }
  return 'http://127.0.0.1' + (match[1] ? ':' + Number(match[1]) : '')
}

export class McpError extends Error {}

export async function readBoundedResponse(response: Response, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  if (!response.body) return Buffer.alloc(0)
  for await (const chunk of response.body as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>) {
    bytes += chunk.length
    if (bytes > limit) throw new McpError('本机响应超出容量限制')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function localApi(config: string) {
  const origin = loopbackApi(config)
  const request = async (path: string, method = 'GET', body?: FormData | unknown) => {
    const form = body instanceof FormData
    let response: Response
    try {
      response = await fetch(origin + path, {
        method, body: form ? body : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: body === undefined || form ? undefined : { 'content-type': 'application/json' },
      })
    } catch {
      throw new McpError('无法连接 XIUMI AI Studio 本机 API，请先启动应用')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new McpError(response.status === 409 ? '项目已被修改，请重新读取 revision' : '本机请求失败（HTTP ' + response.status + '）')
    }
    return response
  }
  const json = async <T>(path: string, method?: string, body?: unknown): Promise<T> => {
    const response = await request(path, method, body)
    return JSON.parse((await readBoundedResponse(response, MAX_RESPONSE)).toString('utf8')) as T
  }
  return { origin, request, json }
}

export type LocalApi = ReturnType<typeof localApi>
