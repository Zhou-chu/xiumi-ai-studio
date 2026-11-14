import { unzipSync } from 'fflate'
/** Only for the small synthetic archive created by the isolated package verifier.
 * Not an upload parser or an untrusted-archive resource budget.
 */
export function archiveContainsText(zip: Uint8Array, text: string): boolean {
  const entries = unzipSync(zip)
  return Object.entries(entries).some(([name, content]) =>
    name.includes(text) || Buffer.from(content).toString('utf8').includes(text))
}
