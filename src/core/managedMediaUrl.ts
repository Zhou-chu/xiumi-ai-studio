const managedMediaPath = /^\/media\/[\w-]+\.(?:jpg|png)$/

export const validMediaGeneration = (value: string) => /^[0-9a-f]{64}$/.test(value)

/** Drop previous dimensions while carrying only a known managed image generation. */
export function variantUrl(src: string, fit?: string, w = 1080): string {
  if (!src.startsWith('/media/')) return src
  const [path, existing = ''] = src.split('#', 1)[0].split('?', 2)
  const q = new URLSearchParams()
  if (fit) q.set('fit', fit)
  q.set('w', String(w))
  if (managedMediaPath.test(path)) {
    const generations = new URLSearchParams(existing).getAll('gen')
    if (generations.length === 1 && validMediaGeneration(generations[0])) q.set('gen', generations[0])
  }
  return `${path}?${q}`
}
