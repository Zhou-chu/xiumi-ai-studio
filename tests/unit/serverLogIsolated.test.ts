import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { format } from 'node:util'
const h = vi.hoisted(() => ({
  append: vi.fn<(file: string, data: string) => void>(),
  mkdir: vi.fn(),
  read: vi.fn<() => string[]>(),
  remove: vi.fn(),
}))
vi.mock('node:fs', () => ({
  appendFileSync: h.append, mkdirSync: h.mkdir, readdirSync: h.read, rmSync: h.remove,
}))
const { addSecret, redact, teeConsoleToFile } = await import('../../server/log')
const levels = ['log', 'info', 'warn', 'error'] as const
const output = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error }
const dir = '/fixture-log-dir'
const local = new Date(2025, 4, 10, 12, 13, 14)
const file = join(dir, 'xiumi-2025-05-10.log')

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(local)
  for (const stub of Object.values(h)) stub.mockReset()
  h.read.mockReturnValue([])
  for (const level of levels) {
    output[level].mockReset()
    console[level] = output[level]
  }
})
afterEach(() => {
  for (const level of levels) console[level] = originals[level]
  vi.useRealTimers()
})

it('masks registered long values and known auth formats while preserving neighboring details', () => {
  const synthetic = 'synthetic-observer-token'
  addSecret(undefined); addSecret('abc'); addSecret(synthetic)
  expect(redact('fixture abc value=' + synthetic + ' Authorization: Bearer sample.fake sk-SYNTHETIC123 {"apiKey":"fixture"} trace=8'))
    .toBe('fixture abc value=*** Authorization: Bearer *** sk-*** {"apiKey":"***"} trace=8')
})
it('creates the log directory, prunes only old matching filenames and returns the current daily path', () => {
  h.read.mockReturnValueOnce(['debug.log', 'xiumi-2025-05-09.log', 'xiumi-2025-05-07.log', 'xiumi-2025-05-08.log', 'xiumi-latest.log'])
  expect(teeConsoleToFile(dir, 2)).toBe(file)
  expect(h.mkdir).toHaveBeenCalledExactlyOnceWith(dir, { recursive: true })
  expect(h.read).toHaveBeenCalledExactlyOnceWith(dir)
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(join(dir, 'xiumi-2025-05-07.log'), { force: true })
})
it('forwards a safe message for every level and masks formatted auth in the daily file', () => {
  teeConsoleToFile(dir)
  for (const level of levels) console[level]('code=%d, token: %s', 9, 'ak-SYNTHETIC123')
  expect(h.append.mock.calls).toEqual(levels.map(level => [file, local.toISOString() + ' [' + level + '] code=9, token: ak-***\n']))
  for (const level of levels) expect(format(...output[level].mock.calls[0])).toBe('code=9, token: ak-***')
})
it('writes against the current date after midnight and retains output if cleanup or append fails', () => {
  h.read.mockImplementationOnce(() => { throw Error('synthetic read failure') })
  h.append.mockImplementationOnce(() => { throw Error('synthetic write failure') })
  expect(teeConsoleToFile(dir)).toBe(file)
  vi.setSystemTime(new Date(2025, 4, 11, 12))
  expect(() => console.warn('continued')).not.toThrow()
  expect(h.append.mock.calls[0][0]).toBe(join(dir, 'xiumi-2025-05-11.log'))
  expect(format(...output.warn.mock.calls[0])).toBe('continued')
})
it('applies registered-value masking to nested console objects as well as the file sink', () => {
  addSecret('fixture-accepted-marker')
  teeConsoleToFile(dir)
  console.error({ diagnostic: { value: 'fixture-accepted-marker', id: 87 } })
  const visible = format(...output.error.mock.calls[0])
  const written = h.append.mock.calls[0][1]
  expect(written.includes('fixture-accepted-marker')).toBe(false)
  expect(visible.includes('fixture-accepted-marker')).toBe(false)
  expect(visible).toMatch(/value: '\*\*\*', id: 87/)
})
it('redacts joined authorization values without clobbering neighboring format substitution', () => {
  teeConsoleToFile(dir)
  console.info('Authorization: Bearer %s request=%d', 'synthetic-bearer-value', 8)
  const visible = format(...output.info.mock.calls[0])
  expect(visible.includes('synthetic-bearer-value')).toBe(false)
  expect(visible).toBe('Authorization: Bearer *** request=8')
  expect(h.append.mock.calls[0][1]).toContain('Authorization: Bearer *** request=8')
})
it('retains the Error header and stack while masking a registered value in both sinks', () => {
  addSecret('synthetic-error-marker')
  teeConsoleToFile(dir)
  console.error(new Error('service failed with synthetic-error-marker'))
  const visible = format(...output.error.mock.calls[0])
  expect(visible).toContain('Error: service failed with ***')
  expect(visible).toContain('at ')
  expect(h.append.mock.calls[0][1]).toContain(visible)
})

const log = { addSecret, redact }
describe('日志打码', () => {
  it('去掉登记过的密钥和常见密钥格式', () => {
    log.addSecret('my-very-secret-value')
    const s = log.redact('key=my-very-secret-value auth: Bearer abc.def sk-1234567890abcdef {"apiKey":"zzz999"} appsecret=qwerty123')
    expect(s).not.toMatch(/my-very-secret-value|abc\.def|1234567890abcdef|zzz999|qwerty123/)
  })
})
