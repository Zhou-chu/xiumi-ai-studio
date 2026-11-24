import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

const fixtureRoot = new URL('./legacy-backup/', import.meta.url)
const load = async (name: string) => JSZip.loadAsync(await readFile(new URL(name + '.zip', fixtureRoot)))

export async function seedDirectoryDesign(source: string) {
  const [design, images, components] = await Promise.all([load('upstream-design'), load('upstream-template-only'), load('upstream-component')])
  const pngPath = 'assets/fixture-template-only-teal.png'
  const templatePath = 'templates/fixture-template-image.json'
  const componentPath = 'components/archived-component.json'
  const themePath = 'themes/custom-fixture.json'
  const template = JSON.parse(await images.file(templatePath)!.async('string'))
  const component = JSON.parse(await components.file(componentPath)!.async('string'))
  const theme = await design.file(themePath)!.async('nodebuffer')
  const png = await images.file(pngPath)!.async('nodebuffer')
  template.themeId = 'custom-fixture'
  const upstreamText = JSON.parse(await design.file('templates/fixture-template.json')!.async('string'))
  template.blocks.unshift(upstreamText.blocks[0])
  component.block.props.html = component.block.props.html.replace('/media/archived-component-photo.png', '/media/fixture-template-only-teal&#46;png')
  const fixtures = new Map<string, Buffer>([
    [themePath, theme], [templatePath, Buffer.from(JSON.stringify(template))],
    [componentPath, Buffer.from(JSON.stringify(component))], [pngPath, png],
    ['assets/_index.json', await images.file('assets/_index.json')!.async('nodebuffer')],
  ])
  for (const category of ['themes', 'templates', 'components', 'assets']) await mkdir(join(source, category), { recursive: true })
  for (const [path, bytes] of fixtures) await writeFile(join(source, path), bytes)
  return { fixtures, themePath, pngPath, templatePath, componentPath, png, theme }
}
