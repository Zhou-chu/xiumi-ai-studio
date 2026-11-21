import { expect, it, vi } from 'vitest'
import { qualifyLegacyComponent, stageLegacyComponents, type ComponentCollection } from '../../server/legacyComponentRestore'
import { validateDraft } from '../../src/core/components'

const id = 'fixture'
const png = 'image.png'
const source = '/media/image.png?gen=' + 'a'.repeat(64)
const images = new Map([[png, { id: 'image', src: source }]])
function archive(html = '<p>Archived text</p><img src="/media/image.png" alt="example">') {
  return {
    id, schema: 1, rev: 4, createdAt: 1, updatedAt: 2, name: 'fixture', kind: 'mixed', role: 'other',
    tags: ['keep', 19], origin: { kind: 'xiumi', title: 'Imported label', account: 'Demo Account', url: 'https://example.invalid/', via: 'import', attested: true, attestedAt: 300, redistributable: true },
    block: { id: 'archived-block', type: 'html', props: { label: 'HTML', html } },
  }
}

it('recomputes derived fields and never takes archive permission, URL or fingerprint claims', () => {
  const bad = { ...archive(), fingerprint: 'forged', palette: ['#12ab34'], text: 'fake', fixedDecor: 5000 }
  const result = qualifyLegacyComponent(id, bad, images)!
  expect(result.dependencies).toEqual(new Set(['image']))
  expect(result.component).toMatchObject({
    id, rev: 4, createdAt: 1, updatedAt: 2, tags: ['keep'], block: { id: 'archived-block' },
    text: 'Archived text', origin: { kind: 'xiumi', title: 'Imported label', account: 'Demo Account', url: '', via: 'import', attested: false, attestedAt: 0, redistributable: false },
  })
  expect(result.component.fingerprint).toMatch(/^h:[a-f0-9]{8}:/)
  expect(result.component.block.props).toMatchObject({ html: expect.stringContaining(source) })
  // Ordinary saves still require an HTML attestation; only archive validation
  // can retain local inert material without representing a rights assertion.
  expect(validateDraft({ ...bad, origin: {} }).draft).toBeUndefined()
})

it.each([
  { id: 'other' }, { schema: 2 }, { rev: 0 }, { rev: '3' }, { createdAt: -1 }, { updatedAt: Infinity },
  { block: null }, { block: { id: 'x', type: 'heading', props: {} } },
  { block: { id: 'wrong id', type: 'html', props: {} } }, { block: { id: 'x', type: 'html', props: [] } },
  { block: { id: 'x', type: 'html', props: { html: '<p>test</p>', unknown: true } } },
  { block: { id: 'x', type: 'html', props: { html: 1 } } },
])('does not stage incompatible archived metadata: %j', change => {
  expect(qualifyLegacyComponent(id, { ...archive(), ...change }, images)).toBeNull()
})

it.each([
  '',
  '<a href="https://example.invalid/">label</a>',
  '<p style="position: fixed">label</p>',
  '<p style="display: none">label</p>',
  '<p style="color:">label</p>',
  '<p style="color: red: blue">label</p>',
  '<p style="background-color: rgb(0,0,0)">label</p>',
  '<p src="/media/image.png">label</p>',
  '<img alt="no source">',
  '<img src="/media/image.png?gen=' + 'b'.repeat(64) + '">',
  '<p>' + 'a'.repeat(65536) + '</p>',
  '<p>' + '<span></span>'.repeat(251) + '</p>',
])('leaves unsupported HTML unchanged rather than silently altering it', html => {
  expect(qualifyLegacyComponent(id, archive(html), images)).toBeNull()
})

it('reports unresolved indexed dependency, accepts an already qualified current URL, and supports plain fragments', () => {
  expect(qualifyLegacyComponent(id, archive('<img src="/media/missing.png">'), images)).toMatchObject({ missing: true })
  expect(qualifyLegacyComponent(id, archive('<img src="' + source + '">'), images)?.dependencies.has('image')).toBe(true)
  expect(qualifyLegacyComponent(id, { ...archive('<h2>Heading</h2>'), origin: null, role: '?' }, images)).toMatchObject({
    missing: false, component: { origin: { kind: 'other', via: 'block' } },
  })
})

it('previews same-id matches only when dependencies already exist and reports a write-time conflict or failure', async () => {
  const candidate = qualifyLegacyComponent(id, archive(), images)!
  const restoreStatus = vi.fn().mockResolvedValue('alreadyPresent')
  let mode = 'collision'
  const withRestoreEntry: ComponentCollection['withRestoreEntry'] = async (_item, apply) => {
    if (mode === 'unwritable') throw new Error('synthetic write failure')
    return apply(async () => mode === 'collision' ? 'conflict' : 'restored',
      async () => mode === 'same' ? 'alreadyPresent' : 'available')
  }
  const stage = stageLegacyComponents([candidate], { restoreStatus, withRestoreEntry })
  const matched = vi.fn().mockResolvedValue(false)
  expect(await stage.preview(matched)).toMatchObject({ unresolved: [id] })
  expect(matched).toHaveBeenCalledWith(candidate, true)
  expect(await stage.apply(async () => 'ready')).toMatchObject({ conflicts: [id] })
  mode = 'unwritable'
  expect(await stage.apply(async () => 'ready')).toMatchObject({ failed: [id] })
  mode = 'same'
  expect(await stage.apply(async () => 'failed')).toMatchObject({ failed: [id] })
  expect(await stage.apply(async () => 'ready')).toMatchObject({ alreadyPresent: [id] })
})
