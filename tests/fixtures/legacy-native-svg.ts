import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type { Doc } from '../../src/core/types'

export const nativeSvgProjectId = 'fixture-native-svg-interaction'
export const nativeSvgFixture = new URL('./legacy-backup/upstream-native-svg.zip', import.meta.url)
export async function independentSvgBackup() {
  const zip = await JSZip.loadAsync(await readFile(nativeSvgFixture))
  const entry = `projects/${nativeSvgProjectId}.json`
  const doc: Doc = JSON.parse(await zip.file(entry)!.async('string'))
  // Only the project envelope is reserialized; the three original HTML fragments
  // are unchanged. The full writer-produced archive remains a negative fixture.
  doc.blocks = doc.blocks.filter(({ id }) => ['reviewer-click', 'touch-only', 'discrete-values'].includes(id))
  zip.file(entry, JSON.stringify(doc))
  return { doc, bytes: await zip.generateAsync({ type: 'nodebuffer' }) }
}
