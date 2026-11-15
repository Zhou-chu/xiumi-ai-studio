import { spawnSync } from 'node:child_process'

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `xiumi-${p}-`))

const write = (file: string, data: string | Buffer) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, data)
}

function loadPaths(env: Record<string, string>) {
  const script = `import('./server/paths.ts').then((p) => console.log(JSON.stringify({ DATA: p.DATA, ROOT: p.ROOT, files: p.loadedEnvFiles, model: process.env.AI_MODEL ?? null, wx: process.env.WECHAT_APPID ?? null })))`
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATA_DIR|XIUMI_|AI_|WECHAT_)/.test(k)))
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: join(import.meta.dirname, '..', '..'), env: { ...clean, ...env }, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop()!)
}

describe('配置加载顺序', () => {
  it('源码运行：仓库 .env 里的 DATA_DIR 在数据目录确定之前生效', () => {
    const root = tmp('repo')
    const target = join(root, '自定义 数据')
    write(join(root, '.env'), `DATA_DIR=${target}\nAI_MODEL=from-repo-env\n`)
    const r = loadPaths({ XIUMI_RESOURCES: root })
    expect(r.DATA).toBe(target)
    expect(r.model).toBe('from-repo-env')
  })
  it('打包运行：数据在 LOCALAPPDATA，读数据目录的 .env，不读程序目录的 .env，系统环境变量优先', () => {
    const local = tmp('local appdata')
    const res = tmp('resources')
    write(join(res, '.env'), 'AI_MODEL=should-not-load\n')
    write(join(local, 'XIUMI AI Studio', '.env'), 'WECHAT_APPID=wx-from-data\nAI_MODEL=from-data-env\n')
    const r = loadPaths({ XIUMI_PACKAGED: '1', XIUMI_RESOURCES: res, LOCALAPPDATA: local, AI_MODEL: 'from-system' })
    expect(r.DATA).toBe(join(local, 'XIUMI AI Studio'))
    expect(r.ROOT).toBe(res)
    expect(r.wx).toBe('wx-from-data')
    expect(r.model).toBe('from-system')
    expect(r.files).toEqual([join(local, 'XIUMI AI Studio', '.env')])
  })
  it('XIUMI_DATA_DIR 可以指定数据目录（路径含中文和空格）', () => {
    const d = join(tmp('custom'), '我的 数据')
    expect(loadPaths({ XIUMI_PACKAGED: '1', XIUMI_DATA_DIR: d, LOCALAPPDATA: tmp('x') }).DATA).toBe(d)
  })
})
