import console from 'node:console'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL, URL } from 'node:url'
import { cruise } from 'dependency-cruiser'
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config'

const source = '^(?:src|server)/'
const forbidden = [
  {
    name: 'core-no-editor',
    severity: 'error',
    from: { path: '^src/core/' },
    to: { path: '^src/editor/' },
  },
  {
    name: 'client-no-server',
    severity: 'error',
    from: { path: '^src/' },
    to: { path: '^server/' },
  },
  {
    name: 'no-cycles',
    severity: 'error',
    from: { path: source },
    to: { path: source, circular: true },
  },
  {
    name: 'resolve-local-imports',
    severity: 'error',
    from: { path: source },
    to: { couldNotResolve: true, path: '^\\.{1,2}/' },
  },
]
const rules = new Set(forbidden.map(rule => rule.name))

function normalizedPath(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid dependency path in architecture report')
  return value.replaceAll('\\', '/')
}

export function architectureKey(violation) {
  const rule = violation?.rule?.name
  if (!rules.has(rule)) throw new Error('Unknown rule in architecture report')
  const cycle = violation.cycle
  if (rule === 'no-cycles' && (!Array.isArray(cycle) || cycle.length === 0)) {
    throw new Error('Missing cycle path in architecture report')
  }
  return JSON.stringify([rule, normalizedPath(violation.from), normalizedPath(violation.to), ...(cycle ?? []).map(step => normalizedPath(step.name))])
}

function assertBaseline(baseline) {
  if (!Array.isArray(baseline) || baseline.length !== new Set(baseline).size) throw new Error('Invalid architecture baseline')
  for (const key of baseline) {
    try {
      const [name, from, to, ...cycle] = JSON.parse(key)
      if (architectureKey({ rule: { name }, from, to, cycle: cycle.map(step => ({ name: step })) }) !== key) throw new Error('Not canonical')
    } catch {
      throw new Error('Invalid architecture baseline entry')
    }
  }
}

export function compareArchitecture(violations, baseline) {
  assertBaseline(baseline)
  const current = new Set(violations.map(architectureKey))
  const known = new Set(baseline)
  return {
    introduced: [...current].filter(key => !known.has(key)).sort(),
    stale: [...known].filter(key => !current.has(key)).sort(),
  }
}

async function checkArchitecture() {
  const tsConfig = extractTSConfig('tsconfig.json')
  if (!tsConfig?.options) throw new Error('Dependency Cruiser could not load the project TS config')
  const { output } = await cruise(['src', 'server'], {
    validate: true,
    outputType: 'json',
    doNotFollow: { path: '(^|/)node_modules/' },
    ruleSet: { forbidden },
    tsPreCompilationDeps: true,
  }, {}, { tsConfig })
  const { summary, modules } = JSON.parse(output)
  if (!Array.isArray(summary?.violations) || !modules?.some(module => module.source === 'src/main.tsx')
    || !modules?.some(module => module.source === 'server/index.ts')) {
    throw new Error('Dependency Cruiser returned an incomplete architecture report')
  }
  const baseline = JSON.parse(await readFile(new URL('./dependency-architecture-baseline.json', import.meta.url), 'utf8'))
  const { introduced, stale } = compareArchitecture(summary.violations, baseline)
  for (const key of introduced) console.error(`New architecture violation: ${key}`)
  for (const key of stale) console.error(`Remove stale architecture exception: ${key}`)
  if (introduced.length || stale.length) process.exitCode = 1
  else console.log(`Architecture passed: ${modules.filter(module => new RegExp(source).test(module.source)).length} source modules, ${baseline.length} exact known violations.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkArchitecture()
}
