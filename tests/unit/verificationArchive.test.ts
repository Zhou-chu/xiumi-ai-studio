import { expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { archiveContainsText } from '../../scripts/verificationArchive'
it('detects a synthetic credential inside compressed entry content', () => {
  const key = 'sk-synthetic-verification-only-123456'
  const zip = zipSync({ 'settings.json': strToU8(JSON.stringify({ key, pad: 'x'.repeat(10000) })) }, { level: 9 })
  expect(Buffer.from(zip).toString('latin1')).not.toContain(key)
  expect(archiveContainsText(zip, key)).toBe(true)
})
it('detects entry names and accepts content without the synthetic credential', () => {
  expect(archiveContainsText(zipSync({ 'secret-name.txt': strToU8('safe') }), 'secret-name')).toBe(true)
  expect(archiveContainsText(zipSync({ 'safe.txt': strToU8('ordinary document') }), 'secret-name')).toBe(false)
})
it('does not treat malformed archives as clean', () => {
  expect(() => archiveContainsText(new Uint8Array([1, 2, 3]), 'key')).toThrow()
})
