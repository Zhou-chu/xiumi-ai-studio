import type { Doc } from '../core/types'
type Save = (doc: Doc) => Promise<{ revision?: string; updatedAt?: number }>

/** Wizard-local receipts survive partial failures, never force a stale overwrite. */
export function createVariantSaver(save: Save, read: (id: string) => Promise<Doc>) {
  const receipts = new Map<string, { fingerprint: string; saved: Doc }>()
  return { async saveAll(docs: Doc[], isCurrent: () => boolean): Promise<Doc[] | null> {
    const result: Doc[] = []
    for (const doc of docs) {
      if (!isCurrent()) return null
      const fingerprint = JSON.stringify(doc)
      const receipt = receipts.get(doc.id)
      if (receipt?.fingerprint === fingerprint) {
        let current: Doc
        try {
          current = await read(doc.id)
        } catch (error) {
          if (!isCurrent()) return null
          if ((error as { status?: number })?.status === 404) {
            throw new Error('已保存的方案已被其他页面删除，请关闭此窗口并在项目中核对，或重新生成方案。', { cause: error })
          }
          throw error
        }
        if (!isCurrent()) return null
        if (!current.revision || current.revision !== receipt.saved.revision) {
          throw new Error('已保存的方案已被其他页面修改，请关闭此窗口并在项目中核对，或重新生成方案。')
        }
        result.push(current)
      }
      else {
        const response = await save({ ...doc, revision: receipt?.saved.revision ?? doc.revision })
        const saved = { ...doc, ...response }
        receipts.set(doc.id, { fingerprint, saved })
        result.push(saved)
      }
      if (!isCurrent()) return null
    }
    return result
  } }
}
