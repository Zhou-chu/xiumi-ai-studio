import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
const generatorPath = '../../templates/eea-germany/build.mjs'

it('reproduces the checked-in template from its generator in an isolated directory', () => {
  const root = resolve(tmpdir())
  const dir = mkdtempSync(join(root, 'xiumi-template-generator-'))
  if (!resolve(dir).startsWith(root + sep)) throw new Error('Refusing cleanup outside temporary directory')
  try {
    copyFileSync('templates/eea-germany/build.mjs', join(dir, 'build.mjs'))
    copyFileSync('templates/eea-germany/template-runtime.mjs', join(dir, 'template-runtime.mjs'))
    execFileSync(process.execPath, [join(dir, 'build.mjs')], { cwd: dir, stdio: 'pipe' })
    const normalize = (text: string) => text.replaceAll('\r\n', '\n')
    expect(normalize(readFileSync(join(dir, 'eea-germany-template.html'), 'utf8')))
      .toBe(normalize(readFileSync('templates/eea-germany/eea-germany-template.html', 'utf8')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('renders without import-time disk writes and writes only the explicit destination', async () => {
  const { generateTemplate, writeTemplate } = await import(generatorPath)
  const expected = readFileSync('templates/eea-germany/eea-germany-template.html', 'utf8').replaceAll('\r\n', '\n')
  expect(generateTemplate().replaceAll('\r\n', '\n')).toBe(expected)
  const root = resolve(tmpdir())
  const dir = mkdtempSync(join(root, 'xiumi-template-export-'))
  if (!resolve(dir).startsWith(root + sep)) throw new Error('Unsafe temp path')
  try {
    const destination = join(dir, 'isolated.html')
    const result = writeTemplate(destination)
    expect(result).toMatchObject({ destination, modules: 15, size: generateTemplate().length })
    expect(readFileSync(destination, 'utf8').replaceAll('\r\n', '\n')).toBe(expected)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
