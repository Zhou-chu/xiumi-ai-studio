import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { collection } from '../../server/store'
import { qualifyLegacyDesign, stageLegacyDesign } from '../../server/legacyDesignRestore'

const fixture = new URL('../fixtures/legacy-backup/upstream-design.zip', import.meta.url)

async function readFixture() {
  const zip = await JSZip.loadAsync(await readFile(fixture))
  const theme = JSON.parse(await zip.file('themes/custom-fixture.json')!.async('string'))
  const template = JSON.parse(await zip.file('templates/fixture-template.json')!.async('string'))
  return { theme, template }
}

it('holds the matching custom theme against ordinary deletion during dependent template publication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-template-lock-'))
  let unblock!: () => void
  let wake!: () => void
  const release = new Promise<void>(resolve => { unblock = resolve })
  const entered = new Promise<void>(resolve => { wake = resolve })
  try {
    const themes = collection(join(dir, 'themes')), templates = collection(join(dir, 'templates'))
    const { theme, template } = await readFixture()
    const stage = stageLegacyDesign({
      templates: [qualifyLegacyDesign('templates', template.id, template)!],
      themes: [qualifyLegacyDesign('themes', theme.id, theme)!],
    }, { themes, templates })
    const real = templates.withRestoreEntry
    vi.spyOn(templates, 'withRestoreEntry').mockImplementationOnce(async (item, action) => {
      wake()
      await release
      await expect(themes.get(theme.id)).resolves.toEqual(theme)
      return real(item, action)
    })
    const applies = stage.apply()
    // Fail promptly if publication leaves before the expected dependency lock.
    await Promise.race([entered, applies.then(() => { throw new Error('Template publication never reached') })])
    const deleting = themes.remove(theme.id)
    try { await expect(themes.get(theme.id)).resolves.toEqual(theme) }
    finally {
      unblock()
      await Promise.all([applies, deleting])
    }
    expect((await applies).templates.restored).toEqual([template.id])
    await expect(themes.get(theme.id)).resolves.toBeNull()
    await expect(templates.get(template.id)).resolves.toEqual(template)
  } finally {
    unblock()
    await rm(dir, { recursive: true, force: true })
  }
})

it('qualifies only bounded, known theme fields and finite rendering tokens', async () => {
  const { theme, template } = await readFixture()
  for (const update of [{ fontSize: 1e20 }, { fontBody: 'system-ui; color:red' },
    { colors: { ...theme.colors, extra: '#fff' } }, { colors: { ...theme.colors, primary: 'url(bad)' } },
    { name: { unexpected: true } }, { customData: true }]) {
    expect(qualifyLegacyDesign('themes', theme.id, { ...theme, ...update })).toBeNull()
  }
  expect(qualifyLegacyDesign('themes', 'tsinghua-purple', { ...theme, id: 'tsinghua-purple' })).toBeNull()
  expect(qualifyLegacyDesign('templates', template.id, { ...template, themeOverrides: { madeUp: true } })).toBeNull()
  expect(qualifyLegacyDesign('templates', template.id, { ...template, roles: { missing: 'h1' } })).toBeNull()
})

it('keeps native box qualification shallow, ordered, bounded, and unique in a template', async () => {
  const { template } = await readFixture()
  const [heading, quote] = template.blocks
  const box = { id: 'box', type: 'box', props: { title: 'Box title', label: 'Box label', variant: 'paper', children: [heading, quote] } }
  const qualify = (blocks: unknown[]) => qualifyLegacyDesign('templates', template.id, { ...template, roles: { box: 'h1' }, blocks })
  expect(qualify([box])).toMatchObject({ blocks: [box] })
  expect(qualify([box, heading])).toBeNull()
  for (const props of [
    { children: [heading, heading] },
    { children: [{ ...box, id: 'distinct-nested-box' }] },
    { children: [{ id: 'html', type: 'html', props: { html: 'unqualified HTML' } }] },
    { children: Array.from({ length: 65 }, (_, id) => ({ ...heading, id: 'wide-' + id })) },
    { children: 'not the native child array' },
    { title: { text: 'not native box title' } },
    { variant: 'other' },
    { extra: 'not a recognized box field' },
  ]) expect(qualify([{ ...box, props: { ...box.props, ...props } }])).toBeNull()
  const many = Array.from({ length: 1999 }, (_, id) => ({ ...heading, id: 'many-' + id }))
  expect(qualify([box, ...many])).toBeNull()
})
