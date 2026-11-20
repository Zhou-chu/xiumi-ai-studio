import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { argv, cwd } from 'node:process'

const require = createRequire(import.meta.url)
// esbuild is already a frozen dependency of the application's TS runner.
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const stage = await realpath(resolve(argv[2]))
if (stage === await realpath(cwd())) throw new Error('Bundle output must be an isolated staging directory')

await build({
  entryPoints: ['server/index.ts'],
  outfile: join(stage, 'server', 'index.mjs'),
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  packages: 'external',
  legalComments: 'eof',
  logLevel: 'warning',
})
