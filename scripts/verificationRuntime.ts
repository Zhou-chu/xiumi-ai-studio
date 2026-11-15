import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, isAbsolute, join, relative, sep } from 'node:path'
/** Resolve only an unpacked verifier fixture, not an arbitrary installed application. */
export function sharpNativePackage(root: string): string {
  const unpacked = realpathSync(root)
  const sharp = realpathSync(join(unpacked, 'app/node_modules/sharp/package.json'))
  const within = (file: string) => {
    const path = relative(unpacked, file)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('Runtime dependency is outside unpacked root')
  }
  within(sharp)
  const manifest = realpathSync(createRequire(sharp).resolve('@img/sharp-win32-x64/package'))
  within(manifest)
  if (JSON.parse(readFileSync(manifest, 'utf8')).name !== '@img/sharp-win32-x64') throw new Error('Unexpected native runtime package')
  return manifest
}

/** Build the child environment for one packaged verifier fixture. */
export function verificationEnvironment(source: NodeJS.ProcessEnv, local: string, port: number, exists: (file: string) => boolean) {
  const searchPath = (source.PATH ?? '').split(delimiter).filter((p) => p && !['node.exe', 'pnpm.cmd', 'pnpm.exe', 'npm.cmd'].some((f) => exists(join(p, f)))).join(delimiter)
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(source).filter(([k]) => !/^(NODE_|npm_|PNPM|XIUMI_|DATA_DIR|API_PORT|AI_|WECHAT_)/i.test(k) && k.toUpperCase() !== 'PATH'))
  Object.assign(env, { Path: searchPath, LOCALAPPDATA: local, XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1', XIUMI_PORT: String(port) })
  return { searchPath, env }
}

export async function verificationApi(url: string, path: string, init: RequestInit & { json?: unknown } = {}, request: typeof fetch = fetch) {
  const headers: Record<string, string> = { origin: url, ...(init.headers as Record<string, string>) }
  let body = init.body
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const r = await request(url + path, { ...init, headers, body })
  const text = await r.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, data, type: r.headers.get('content-type') ?? '' }
}
export const verificationUpload = (url: string, path: string, field: string, name: string, data: Buffer | string, type: string, send = verificationApi) => {
  const fd = new FormData()
  fd.append(field, new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type }), name)
  return send(url, path, { method: 'POST', body: fd })
}

export async function waitForVerification<T>(fn: () => T | undefined | null | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`等待超时：${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}
export function readVerificationReadyUrl(output: string): string | undefined {
  return output.match(/已启动：(http:\/\/127\.0\.0\.1:\d+)\//)?.[1]
}
