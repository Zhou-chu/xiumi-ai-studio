import { unzipSync, zipSync } from 'fflate'
/** Only for the small synthetic archive created by the isolated package verifier.
 * Not an upload parser or an untrusted-archive resource budget.
 */
export function archiveContainsText(zip: Uint8Array, text: string): boolean {
  const entries = unzipSync(zip)
  return Object.entries(entries).some(([name, content]) =>
    name.includes(text) || Buffer.from(content).toString('utf8').includes(text))
}

/** 最小的 docx（mammoth 可读） */
export function makeDocx(text: string) {
  const enc = (s: string) => new TextEncoder().encode(s)
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': enc('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': enc(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
    }),
  )
}
