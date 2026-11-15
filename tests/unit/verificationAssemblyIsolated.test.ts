import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { delimiter, join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { makeDocx } from '../../scripts/verificationArchive'
import { verificationEnvironment } from '../../scripts/verificationRuntime'

afterEach(() => vi.useRealTimers())

it('creates the exact baseline Word fixture in memory with the main relationship and document text', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2025, 0, 2, 13, 0, 0))
  const bytes = makeDocx('合成模板 Office fixture')
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('655d6f872e2e454fc2991c4af07b7babfd3db63a4f3aabeaa36cb009cb68cca1')
  const entries = unzipSync(bytes)
  expect(Object.keys(entries).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
  expect(strFromU8(entries['[Content_Types].xml'])).toContain('PartName="/word/document.xml"')
  expect(strFromU8(entries['_rels/.rels'])).toContain('Target="word/document.xml"')
  expect(strFromU8(entries['word/document.xml'])).toContain('<w:t>合成模板 Office fixture</w:t>')
})
it('filters tool directories and hostile/inherited env families while leaving normal variables', () => {
  const env = {
    PATH: ['/keep', '', '/node', '/pnpm', '/pnpm-exe', '/npm', '/ordinary', '/keep'].join(delimiter), Path: 'duplicate',
    USERPROFILE: '/synthetic-home', SYSTEMROOT: '/synthetic-os', KEEP_PATH: 'preserved',
    NODE_OPTIONS: 'fake', NPM_CONFIG_FAKE: 'fake', pNpM_TEST: 'fake', xiumi_old: 'fake',
    data_dir: 'fake', api_port: 'fake', AI_API_KEY: 'fake', WeChat_AppSecret: 'fake',
    LOCALAPPDATA: '/not-the-fixture', XIUMI_NO_BROWSER: '0',
  }
  const pairs = [['/node','node.exe'],['/pnpm','pnpm.cmd'],['/pnpm-exe','pnpm.exe'],['/npm','npm.cmd']]
  const paths = new Set(pairs.map(p => join(...p)))
  const contains = vi.fn((path: string) => paths.has(path))
  const before = { ...env }
  const computed = verificationEnvironment(env, '/fixture-local-data', 5390, contains)
  const keep = ['/keep','/ordinary','/keep'].join(delimiter)
  expect(computed).toEqual({
    searchPath: keep,
    env: {
      Path: keep, USERPROFILE: '/synthetic-home', SYSTEMROOT: '/synthetic-os', KEEP_PATH: 'preserved',
      LOCALAPPDATA: '/fixture-local-data', XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1', XIUMI_PORT: '5390',
    },
  })
  expect(env).toEqual(before)
  expect(contains.mock.calls.flat()).toEqual(expect.arrayContaining([...paths]))
})
it('uses an empty sanitized path for an absent input path and never consults tool presence', () => {
  const contains = vi.fn(() => { throw Error('unexpected tool lookup') })
  expect(verificationEnvironment({ AI_BASE_URL: 'fake', LANG: 'zh-CN' }, '/fixture', 12345, contains)).toEqual({
    searchPath: '',
    env: { Path: '', LANG: 'zh-CN', LOCALAPPDATA: '/fixture', XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1', XIUMI_PORT: '12345' },
  })
  expect(contains).not.toHaveBeenCalled()
})
