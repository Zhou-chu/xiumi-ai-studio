import type { ArticleImageResult } from '../../server/articleImages'
import type { ComponentDraft, LibraryComponent } from '../core/components'
import type { RoleId } from '../core/roles'
import type { Block, Doc, ImageRef, Theme } from '../core/types'
import { validMediaGeneration } from '../core/managedMediaUrl'

export interface Asset {
  id: string
  file: string
  name: string
  width: number
  height: number
  size: number
  generation?: string
  createdAt: number
}
export interface ProjectSummary {
  id: string
  title: string
  updatedAt: number
  themeId: string
  blockCount: number
}
export interface VersionSummary {
  id: string
  label: string
  createdAt: number
  blockCount: number
}
export interface AiProfile {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  jsonMode: boolean
  /** 思考强度；空 = 不发送，用模型默认值 */
  reasoningEffort?: string
  /** 检测或上游返回的、这个模型接受的思考强度 */
  efforts?: string[]
  /** 上下文窗口（token，0 = 未知） */
  contextWindow?: number
  /** 单次最大输出（token，0 = 未知） */
  maxOutputTokens?: number
  /** 额外的请求参数（JSON 对象） */
  extraBody?: string
  hasKey?: boolean
  readonly?: boolean
}
export interface ModelInfo {
  id: string
  name?: string
  contextWindow?: number
  maxOutput?: number
  efforts?: string[]
  reasoningEfforts?: string[]
}
export interface EffortProbe {
  baseError?: string
  supported: string[]
  rejected: { effort: string; message: string }[]
  ignored: boolean
}
export interface AiSettings {
  activeId: string
  profiles: AiProfile[]
  modelCards?: Pick<AiProfile, 'id' | 'name' | 'provider' | 'model'>[]
}
export interface AiStatus {
  enabled: boolean
  provider: string
  model: string
  name: string
  profileId: string
}
export interface Template {
  id: string
  name: string
  blocks: Block[]
  themeId?: string
  themeOverrides?: Doc['themeOverrides']
  /** 模块 id → 标准名称（用户确认过的）；没有时套用前自动识别 */
  roles?: Record<string, RoleId>
  createdAt: number
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function req<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, ...(signal ? { signal } : {}) }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  // A failed/aborted success body is not an empty document or project list.
  return await res.json() as T
}

export const assetMediaSrc = (a: Asset) =>
  `/media/${a.file}${typeof a.generation === 'string' && validMediaGeneration(a.generation) ? '?gen=' + a.generation : ''}`
export const assetRef = (a: Asset): ImageRef => ({ src: assetMediaSrc(a), assetId: a.id, alt: a.name, width: a.width, height: a.height })

// Match the server's resource-ID grammar before interpolating into a route.
// Encoding alone is insufficient: URL parsers normalize dot path segments.
function resourceId(value: string): string {
  if (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value)) throw new ApiError('Invalid resource ID', 400)
  return encodeURIComponent(value)
}

type DesignCategories<T extends string> = { themes: Record<T, string[]>; templates: Record<T | 'unresolved', string[]> }
const designPlanFields = ['add', 'conflicts', 'alreadyPresent'] as const
const designResultFields = ['restored', 'conflicts', 'alreadyPresent', 'failed'] as const

export interface LegacyRestorePlan {
  modelCards?: Record<typeof designPlanFields[number], string[]>
  projects: { add: string[]; skip: string[]; unsupported: string[] }
  versions?: { add: string[]; skip: string[] }
  assets?: { add: string[]; skip: string[]; alreadyPresent: string[] }
  design?: DesignCategories<typeof designPlanFields[number]>
  components?: Record<typeof designPlanFields[number] | 'unresolved', string[]>
  unsupported: string[]
}
export interface LegacyRestoreResult {
  modelCards?: Record<typeof designResultFields[number], string[]>
  projects: { restored: string[]; skipped: string[]; failed: string[]; unsupported: string[] }
  versions?: { restored: string[]; skipped: string[]; failed: string[] }
  assets?: { restored: string[]; skipped: string[]; failed: string[]; alreadyPresent: string[] }
  design?: DesignCategories<typeof designResultFields[number]>
  components?: Record<typeof designResultFields[number] | 'unresolved', string[]>
  unsupported: string[]
}
const restoreEndpoint = '/api/data/restore'
const restoreToken = /^[a-f0-9]{64}$/
const jsonObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
function designFields<K extends string>(raw: unknown, keys: readonly K[], description = '模板或主题'): Record<K, string[]> {
  const value = jsonObject(raw)
  if (!value) throw new Error('无法读取' + description + '恢复数据')
  const selected = {} as Record<K, string[]>
  for (const key of keys) {
    const entries = value[key]
    if (!stringList(entries)) throw new Error('无法读取' + description + '恢复数据')
    selected[key] = entries
  }
  return selected
}
function decodeDesign<K extends string>(raw: unknown, keys: readonly K[]): DesignCategories<K> | undefined {
  if (raw === undefined) return undefined
  const value = jsonObject(raw)
  return { themes: designFields(value?.themes, keys), templates: designFields(value?.templates, [...keys, 'unresolved']) }
}
function decodePlan(v: unknown): { token: string; plan: LegacyRestorePlan } {
  const body = jsonObject(v), plan = jsonObject(body?.plan), projects = jsonObject(plan?.projects), versions = jsonObject(plan?.versions)
  if (typeof body?.token !== 'string' || !restoreToken.test(body.token) ||
      !projects || !stringList(projects.add) || !stringList(projects.skip) ||
      !stringList(projects.unsupported) || !stringList(plan?.unsupported)) throw new Error('无法读取恢复预览')
  const history = versions && stringList(versions.add) && stringList(versions.skip)
    ? { add: versions.add, skip: versions.skip } : undefined
  if (plan.versions !== undefined && !history) throw new Error('无法读取恢复预览')
  const raw = jsonObject(plan.assets)
  const assets = raw && stringList(raw.add) && stringList(raw.skip) && stringList(raw.alreadyPresent)
    ? { add: raw.add, skip: raw.skip, alreadyPresent: raw.alreadyPresent } : null
  if (plan.assets !== undefined && !assets) throw new Error('无法读取素材恢复预览')
  const modelCards = plan.modelCards === undefined ? undefined : designFields(plan.modelCards, designPlanFields, '模型资料')
  const design = decodeDesign(plan.design, designPlanFields)
  const components = plan.components === undefined ? undefined : designFields(plan.components, [...designPlanFields, 'unresolved'], '组件')
  return { token: body.token, plan: { ...(modelCards && { modelCards }), ...(components && { components }), ...(design && { design }), ...(history ? { versions: history } : {}), ...(assets ? { assets } : {}), projects: { add: projects.add, skip: projects.skip, unsupported: projects.unsupported }, unsupported: plan.unsupported } }
}
function decodeResult(v: unknown): LegacyRestoreResult {
  const body = jsonObject(v), projects = jsonObject(body?.projects), versions = jsonObject(body?.versions)
  if (!projects || !stringList(projects.restored) || !stringList(projects.skipped) ||
      !stringList(projects.failed) || !stringList(projects.unsupported) || !stringList(body?.unsupported)) {
    throw new Error('无法读取恢复结果')
  }
  const history = versions && stringList(versions.restored) && stringList(versions.skipped) && stringList(versions.failed)
    ? { restored: versions.restored, skipped: versions.skipped, failed: versions.failed } : undefined
  if (body.versions !== undefined && !history) throw new Error('无法读取恢复结果')
  const raw = jsonObject(body.assets)
  const assets = raw && stringList(raw.restored) && stringList(raw.skipped) && stringList(raw.failed) && stringList(raw.alreadyPresent)
    ? { restored: raw.restored, skipped: raw.skipped, failed: raw.failed, alreadyPresent: raw.alreadyPresent } : null
  if (body.assets !== undefined && !assets) throw new Error('无法读取素材恢复结果')
  const modelCards = body.modelCards === undefined ? undefined : designFields(body.modelCards, designResultFields, '模型资料')
  const design = decodeDesign(body.design, designResultFields)
  const components = body.components === undefined ? undefined : designFields(body.components, [...designResultFields, 'unresolved'], '组件')
  return { ...(modelCards && { modelCards }), ...(components && { components }), ...(design && { design }), ...(history ? { versions: history } : {}), ...(assets ? { assets } : {}), projects: { restored: projects.restored, skipped: projects.skipped, failed: projects.failed, unsupported: projects.unsupported }, unsupported: body.unsupported }
}

export const api = {
  assets: () => req<Asset[]>('GET', '/api/assets'),
  uploadAssets(files: File[] | FileList) {
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('files', f)
    return req<Asset[]>('POST', '/api/assets', fd)
  },
  cropAsset: async (id: string, box: { x: number; y: number; width: number; height: number }) => req<Asset>('POST', `/api/assets/${resourceId(id)}/crop`, box),
  deleteAsset: async (id: string) => req('DELETE', `/api/assets/${resourceId(id)}`),
  importFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ text: string; assets: Asset[] }>('POST', '/api/import', fd)
  },
  loadSample: () => req<{ text: string; assets: Asset[] }>('POST', '/api/samples/load'),

  async previewLegacyRestore(file: File, signal?: AbortSignal, indexedImages = false, includeDesign = false, includeComponents = false, standaloneImages = false, includeModelCards = false) {
    const payload = new FormData()
    payload.append('file', file)
    const options = new URLSearchParams()
    if (indexedImages) options.set('indexedImages', '1')
    if (includeDesign) options.set('design', '1')
    if (includeComponents) options.set('components', '1')
    if (standaloneImages) options.set('standaloneImages', '1')
    if (includeModelCards) options.set('modelCards', '1')
    return decodePlan(await req<unknown>('POST', options.size ? restoreEndpoint + '?' + options : restoreEndpoint, payload, signal))
  },
  async applyLegacyRestore(token: string, signal?: AbortSignal) {
    if (!restoreToken.test(token)) throw new Error('恢复会话无效')
    return decodeResult(await req<unknown>('POST', `${restoreEndpoint}/${token}/apply`, { confirm: true }, signal))
  },
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  project: async (id: string) => req<Doc>('GET', `/api/projects/${resourceId(id)}`),
  saveProject: async (doc: Doc) => req<{ updatedAt: number; revision?: string }>('PUT', `/api/projects/${resourceId(doc.id)}`, doc),
  deleteProject: async (id: string) => req('DELETE', `/api/projects/${resourceId(id)}`),
  versions: async (id: string) => req<VersionSummary[]>('GET', `/api/projects/${resourceId(id)}/versions`),
  saveVersion: async (doc: Doc, label: string) => req<VersionSummary>('POST', `/api/projects/${resourceId(doc.id)}/versions`, { doc, label }),
  version: async (pid: string, vid: string) => req<{ doc: Doc }>('GET', `/api/projects/${resourceId(pid)}/versions/${resourceId(vid)}`),

  templates: () => req<Template[]>('GET', '/api/templates'),
  saveTemplate: (name: string, blocks: Block[], theme?: Pick<Doc, 'themeId' | 'themeOverrides'>) =>
    req<Template>('POST', '/api/templates', { name, blocks, themeId: theme?.themeId, themeOverrides: theme?.themeOverrides }),
  deleteTemplate: async (id: string) => req('DELETE', `/api/templates/${resourceId(id)}`),
  updateTemplate: async (id: string, patch: { name?: string; roles?: Record<string, RoleId> }) => req<Template>('PUT', `/api/templates/${resourceId(id)}`, patch),
  components: () => req<LibraryComponent[]>('GET', '/api/components'),
  saveComponent: (draft: ComponentDraft) => req<{ component: LibraryComponent; duplicate: boolean }>('POST', '/api/components', draft),
  updateComponent: async (id: string, patch: { name?: string; tags?: string[]; kind?: string; role?: RoleId }) => req<LibraryComponent>('PUT', `/api/components/${resourceId(id)}`, patch),
  deleteComponent: async (id: string) => req('DELETE', `/api/components/${resourceId(id)}`),
  themes: () => req<Theme[]>('GET', '/api/themes'),
  saveTheme: (t: Theme) => req('POST', '/api/themes', t),
  deleteTheme: async (id: string) => req('DELETE', `/api/themes/${resourceId(id)}`),

  aiStatus: () => req<AiStatus>('GET', '/api/ai/status'),
  aiSettings: () => req<AiSettings>('GET', '/api/settings/ai'),
  saveAiSettings: (s: { activeId: string; profiles: AiProfile[] }) => req<AiSettings>('PUT', '/api/settings/ai', s),
  testAi: (p: AiProfile) => req<{ ok: boolean; reply: unknown; ms: number }>('POST', '/api/settings/ai/test', p),
  aiModels: async (p: AiProfile): Promise<ModelInfo[]> => {
    const r = await req<ModelInfo[] | { models: ModelInfo[] }>('POST', '/api/settings/ai/models', p)
    const models = Array.isArray(r) ? r : r?.models
    if (!Array.isArray(models)) throw new Error('服务未返回有效的模型列表')
    return models
  },
  probeEffort: (p: AiProfile) => req<EffortProbe>('POST', '/api/settings/ai/probe-effort', p),
  aiOutline: (text: string, imageNames: string[], imageNotes: string[] = [], profileId?: string) => req<any>('POST', '/api/ai/outline', { text, imageNames, imageNotes, profileId }),
  aiDesign: (brief: unknown, hint: string, profileId?: string) => req<{ designs: any[] }>('POST', '/api/ai/design', { brief, hint, profileId }),
  aiCopywrite: (body: { brief: string; style: string; length: string; levels: number; extra: string; previous?: string; revise?: string; profileId?: string }) => req<{ markdown?: string }>('POST', '/api/ai/copywrite', body),
  aiEnrichCopy: (body: { text: string; photos: unknown[]; keep: string[]; profileId?: string }) => req<{ markdown?: string; changes?: string[] }>('POST', '/api/ai/enrich-copy', body),
  aiPlacePhotos: (body: unknown) => req<{ placements?: unknown[] }>('POST', '/api/ai/place-photos', body),
  aiSuggestInstruction: (context: unknown, profileId?: string, selectedId?: string | string[], signal?: AbortSignal) => req<{ suggestion: string }>('POST', '/api/ai/suggest-instruction', { context, profileId, selectedId }, signal),
  aiEdit: (context: unknown, instruction: string, profileId?: string, selectedId?: string | string[]) => req<{ summary: string; ops: any[] }>('POST', '/api/ai/edit', { context, instruction, profileId, selectedId }),
  fetchReference: (url: string) => req<{ html: string }>('POST', '/api/reference/fetch', { url }),
  fetchArticle: (url: string) => req<{ html: string }>('POST', '/api/article/fetch', { url }),
  importArticleImages: (urls: string[]) => req<ArticleImageResult[]>('POST', '/api/assets/import-article', { urls }),
  fetchAssets: (urls: string[]) => req<Record<string, Asset>>('POST', '/api/assets/fetch', { urls }),

  wechatStatus: () => req<{ configured: boolean; appid: string; ownedReplay?: true }>('GET', '/api/wechat/status'),
  wechatUploadImages: (urls: string[]) => req<Record<string, string>>('POST', '/api/wechat/upload-images', { urls }),
  wechatDraft: (body: { title: string; author: string; digest: string; html: string; cover: string; confirm: true }) =>
    req<{ media_id: string }>('POST', '/api/wechat/draft', body),
}
