import assert from 'node:assert/strict'
import { test } from 'node:test'
import { architectureKey, compareArchitecture } from '../../scripts/quality/dependency-architecture.mjs'

const edge = (from, to, rule = 'client-no-server') => ({ from, to, rule: { name: rule } })
const loop = (middle) => ({...edge('src/a.ts','src/b.ts','no-cycles'), cycle: [{ name: 'src/b.ts' }, { name: middle }, { name: 'src/a.ts' }]})

test('the exact existing import passes, but a different edge fails', () => {
  const existing = edge('src/legacy.ts', 'server/http.ts')
  const newEdge = edge('src/new.ts', 'server/http.ts')
  const baseline = [architectureKey(existing)]
  assert.deepEqual(compareArchitecture([existing], baseline), { introduced: [], stale: [] })
  assert.deepEqual(compareArchitecture([existing,newEdge], baseline), { introduced: [architectureKey(newEdge)], stale: [] })
})

test('a cycle that shares an existing edge but takes a different path is new', () => {
  const first = loop('src/c.ts')
  const next = loop('src/d.ts')
  assert.deepEqual(compareArchitecture([first,next], [architectureKey(first)]), { introduced: [architectureKey(next)], stale: [] })
})

test('a fixed exception has to be removed so the old violation cannot return', () => {
  const key = architectureKey(edge('src/a.ts','server/http.ts'))
  assert.deepEqual(compareArchitecture([], [key]), { introduced: [], stale: [key] })
})

test('paths are portable and invalid reports fail closed', () => {
  assert.equal(architectureKey(edge('src\\a.ts','server\\b.ts')), architectureKey(edge('src/a.ts','server/b.ts')))
  assert.throws(() => architectureKey({ ...edge('src/a.ts','src/b.ts','no-cycles') }), /cycle/i)
  assert.throws(() => compareArchitecture([edge('src/a.ts','server/b.ts')], ['invalid']), /baseline/i)
})

test('introduced and stale findings keep deterministic code-unit order', () => {
  const edgeAt = name => edge(`src/${name}.ts`, 'server/http.ts')
  const stale = ['ä-old', 'a-old', 'Z-old'].map(name => architectureKey(edgeAt(name)))
  assert.deepEqual(compareArchitecture(['ä', 'a', 'Z'].map(edgeAt), stale), {
    introduced: ['Z', 'a', 'ä'].map(name => architectureKey(edgeAt(name))),
    stale: ['Z-old', 'a-old', 'ä-old'].map(name => architectureKey(edgeAt(name))),
  })
})
