import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('runs isolated Windows package and full packaged browser acceptance without publication', () => {
  const workflow = readFileSync('.github/workflows/package-verification.yml', 'utf8')
  expect(workflow).toContain('runs-on: windows-latest')
  expect(workflow).toContain("branches: ['fix/staging-model-catalog-quality-20261115']")
  expect(workflow).toContain('contents: read')
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow.indexOf('run: pnpm sample')).toBeLessThan(workflow.indexOf('run: pnpm package:win'))
  expect(workflow.indexOf('run: pnpm package:win')).toBeLessThan(workflow.indexOf('run: pnpm verify:package'))
  expect(workflow).toContain('run: pnpm e2e:package --update-snapshots=none')
  expect(workflow).not.toMatch(/secrets\.|release.*upload|gh release|deploy:/)
  expect(workflow).not.toContain('path: release/')
})

it('invokes the strict gate once through CI without a redundant branch push trigger', () => {
  const gate = readFileSync('.github/workflows/strict-unit-stage.yml', 'utf8')
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  expect(ci).toMatch(/branches: \[main, 'fix\/\*\*', 'feat\/\*\*'\]/)
  expect(ci.match(/uses: \.\/\.github\/workflows\/strict-unit-stage\.yml/g)).toHaveLength(1)
  expect(gate).not.toMatch(/^ {2}push:/m)
  expect(gate).toMatch(/^ {2}workflow_call:$/m)
  expect(gate).toMatch(/^ {2}workflow_dispatch:$/m)
  expect(gate).toContain('contents: read')
  expect(gate).toContain('persist-credentials: false')
  expect(gate).toContain('node tests/quality/test-layer-check.mjs')
  expect(gate).toContain('vitest run --config vitest.unit.config.ts --coverage')
  expect(gate).toContain('name: strict-unit-stage-coverage')
})
