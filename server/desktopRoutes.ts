import type { Express, Request, Response } from 'express'
import { createDesktopActions } from './desktopActions'

type OwnedConfig = Parameters<typeof createDesktopActions>[0]
type DesktopAction = 'info' | 'open'

export function mountDesktopDataRoutes(app: Express, ownedConfig: () => OwnedConfig | undefined) {
  const action = (kind: DesktopAction) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const config = ownedConfig()
      if (!config) return res.status(404).json({ error: '当前运行方式不支持桌面文件夹' })
      const desktop = createDesktopActions(config)
      const output = kind === 'info'
        ? desktop.info(req.headers)
        : await desktop.open(req.headers, req.body?.target)
      return res.json(output)
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status
      if ((status === 400 || status === 403 || status === 404) && error instanceof Error) {
        return res.status(status).json({ error: error.message })
      }
      return res.status(500).json({ error: '无法使用桌面文件夹，请检查当前安装' })
    }
  }
  app.get('/api/app/info', action('info'))
  app.post('/api/app/open', action('open'))
}
