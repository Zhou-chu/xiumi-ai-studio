// Owner-local policy. An ordinary Web/server runtime does not install this adapter.
import { isAbsolute, resolve } from 'node:path'

type Header = string | string[] | undefined
type BrowserHeaders = { host?: Header; origin?: Header; 'sec-fetch-site'?: Header }

interface OwnedDesktopConfig {
  origin: string
  dataDir: string
  logDir?: string
  openFolder?: (folder: string) => Promise<void>
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

function isConfiguredAbsolutePath(path: string) {
  return isAbsolute(path) && resolve(path) === path && !path.startsWith('\\\\')
}

export function createDesktopActions({ origin, dataDir, logDir, openFolder }: OwnedDesktopConfig) {
  const bound = new URL(origin)
  if (bound.protocol !== 'http:' || bound.hostname !== '127.0.0.1' || !bound.port || origin !== bound.origin) {
    throw new TypeError('Desktop actions require a fixed IPv4 loopback listener')
  }
  if (!isConfiguredAbsolutePath(dataDir) || (logDir !== undefined && !isConfiguredAbsolutePath(logDir))) {
    throw new TypeError('Desktop actions require configured absolute local folders')
  }

  function authorize(headers: BrowserHeaders, requireOrigin: boolean) {
    if (headers.host !== bound.host || headers['sec-fetch-site'] !== 'same-origin') {
      throw httpError(403, '仅允许本机桌面页面使用')
    }
    if ((requireOrigin || headers.origin !== undefined) && headers.origin !== origin) {
      throw httpError(403, '仅允许本机桌面页面使用')
    }
  }

  return {
    info(headers: BrowserHeaders) {
      authorize(headers, false)
      return { dataDir, logDir: logDir ?? null, canOpenFolder: openFolder !== undefined }
    },
    async open(headers: BrowserHeaders, target: unknown) {
      authorize(headers, true)
      if (target !== 'data' && target !== 'logs') throw httpError(400, '未知的目标')
      const folder = target === 'data' ? dataDir : logDir
      if (!openFolder || !folder) throw httpError(404, '当前运行方式不支持打开此文件夹')
      await openFolder(folder)
      return { opened: true, path: folder }
    },
  }
}
