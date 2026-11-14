import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('runs isolated Windows package and full packaged browser acceptance without publication', () => {
  const workflow = readFileSync('.github/workflows/package-verification.yml', 'utf8')
  expect(workflow).toContain('runs-on: windows-latest')
  expect(workflow).toContain("branches: ['fix/upstream-package-verification-20261114']")
  expect(workflow).toContain('contents: read')
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow.indexOf('run: pnpm sample')).toBeLessThan(workflow.indexOf('run: pnpm package:win'))
  expect(workflow.indexOf('run: pnpm package:win')).toBeLessThan(workflow.indexOf('run: pnpm verify:package'))
  expect(workflow).toContain('run: pnpm e2e:package --update-snapshots=none')
  expect(workflow).not.toMatch(/secrets\.|release.*upload|gh release|deploy:/)
  expect(workflow).not.toContain('path: release/')
})
