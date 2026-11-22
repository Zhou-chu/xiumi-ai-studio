import { join } from 'node:path'
import { collection, DATA } from './store'
import { publicAiSettings, withAiSettingsLock } from './settings'

type ModelCard = { id: string; name: string; provider: 'openai' | 'anthropic'; model: string }
const cards = collection<ModelCard>(join(DATA, 'model-cards'))
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
const idPattern = /^[a-zA-Z0-9_-]{1,40}$/
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/
const key = (id: string) => id.toLowerCase()

function descriptor(value: unknown): ModelCard | undefined {
  const p = object(value)
  if (!p || typeof p.id !== 'string' || !idPattern.test(p.id) || key(p.id) === 'env' ||
      (p.provider !== 'openai' && p.provider !== 'anthropic') ||
      typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || /\p{C}/u.test(p.name) ||
      typeof p.model !== 'string' || !modelPattern.test(p.model) || p.model.includes('://')) return undefined
  return { id: p.id, name: p.name, provider: p.provider, model: p.model }
}

export function archivedModelCards(value: unknown): ModelCard[] {
  const input = object(object(value)?.ai)?.profiles
  if (!Array.isArray(input) || input.length > 128) return []
  const used = new Set<string>(), duplicates = new Set<string>()
  const eligible: ModelCard[] = []
  for (const raw of input) {
    const p = object(raw)
    if (typeof p?.id === 'string' && idPattern.test(p.id)) {
      const id = key(p.id)
      if (used.has(id)) duplicates.add(id)
      used.add(id)
    }
    const card = descriptor(raw)
    if (card) eligible.push(card)
  }
  return eligible.filter(card => !duplicates.has(key(card.id)))
}

export async function restoredModelCards(): Promise<ModelCard[]> {
  return (await cards.list()).flatMap(item => {
    const card = descriptor(item)
    return card ? [card] : []
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

async function occupiedModels() {
  const [settings, existing] = await Promise.all([publicAiSettings(), restoredModelCards()])
  return {
    live: new Set(settings.profiles.map(p => key(p.id))),
    existing: new Map(existing.map(card => [key(card.id), card.id])),
  }
}

function blocked(card: ModelCard, occupied: Awaited<ReturnType<typeof occupiedModels>>) {
  return occupied.live.has(key(card.id)) || (occupied.existing.has(key(card.id)) && occupied.existing.get(key(card.id)) !== card.id)
}

export function stageModelCards(incoming: ModelCard[]) {
  return {
    async preview() {
      const occupied = await occupiedModels()
      const result = { add: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[] }
      for (const card of incoming) {
        const status = blocked(card, occupied) ? 'conflict' : await cards.restoreStatus(card)
        result[status === 'available' ? 'add' : status === 'alreadyPresent' ? 'alreadyPresent' : 'conflicts'].push(card.id)
      }
      return result
    },
    apply: () => withAiSettingsLock(async () => {
      const occupied = await occupiedModels()
      const result = { restored: [] as string[], alreadyPresent: [] as string[], conflicts: [] as string[], failed: [] as string[] }
      for (const card of incoming) {
        try {
          const status = blocked(card, occupied) ? 'conflict' : await cards.withRestoreEntry(card, (restore) => restore())
          result[status === 'conflict' ? 'conflicts' : status].push(card.id)
        } catch {
          result.failed.push(card.id)
        }
      }
      return result
    }),
  }
}
