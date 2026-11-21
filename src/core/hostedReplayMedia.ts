export const HOSTED_REPLAY_PATH = '/api/replay/hosted-xiumi'

const HOSTED_ORIGINS = new Set(['https://mmbiz.qpic.cn', 'https://mmbiz.qlogo.cn'])

export function isHostedReplayImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/[\w./%?=&+-]+$/.test(value)) return false
  try {
    const url = new URL(value)
    return HOSTED_ORIGINS.has(url.origin) && url.pathname !== '/' && !url.username && !url.password && !url.hash
  } catch { return false }
}
