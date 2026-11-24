import type { Request } from 'express'

/** Archive routes must never accept a rebound hostname or cross-origin fetch. */
export function localArchiveOrigin(req: Request): boolean {
  const host = req.get('host') ?? ''
  const origin = req.get('origin')
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) &&
    (!origin || origin === `http://${host}` || origin === `https://${host}`) &&
    !['cross-site', 'same-site'].includes(req.get('sec-fetch-site') ?? '')
}
