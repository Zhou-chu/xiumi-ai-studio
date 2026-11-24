import { buildFromDesign, normalizeDesign } from '../../src/core/aiDesign'
import { createBlock, newId } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import { applyOps, summarize, validateOp } from '../../src/core/ops'
import { parseArticle } from '../../src/core/outline'
import { allThemes } from '../../src/core/themes'
import { flatBlocks } from '../../src/core/tree'
import type { Block, Doc, ImageRef } from '../../src/core/types'
import { localApi, loopbackApi, McpError, readBoundedResponse, type LocalApi } from './api'

export { loopbackApi }
const MAX_ASSET = 3 * 1024 * 1024
const B64_LIMIT = 4 * 1024 * 1024
const MAX_EMBEDDED = 6 * 1024 * 1024
const MAX_INLINE_OUTPUT = 8 * 1024 * 1024
const MAX_TOOL_OUTPUT = 12 * 1024 * 1024
const MEDIA = /^\/media\/[\w.-]+\.(?:png|jpe?g|webp|gif)(?:\?[\w%.,=+&~-]*)?$/i
const SAFE_ID = /^[\w-]{1,64}$/
const RASTER_TYPE = /^image\/(?:png|jpeg|webp|gif)$/
type Args = Record<string, unknown>
type Field = {
  type: 'string' | 'boolean' | 'array' | 'object'
  description?: string
  maxLength?: number
  maxItems?: number
  pattern?: string
  enum?: string[]
  items?: Field
}
type ToolSchema = { type: 'object'; properties: Record<string, Field>; required: string[]; additionalProperties: false }
type Tool = { name: string; description: string; inputSchema: ToolSchema; run: (args: Args) => Promise<unknown> }
type Asset = { id: string; file: string; name: string; width: number; height: number }
const str = (maxLength = 2000): Field => ({ type: 'string', maxLength })
const ident: Field = { type: 'string', pattern: SAFE_ID.source }
const bool: Field = { type: 'boolean' }
const list = (items: Field, maxItems: number): Field => ({ type: 'array', items, maxItems })
const text = (args: Args, key: string) => args[key] as string | undefined
export const record = (input: unknown): input is Args => input !== null && typeof input === 'object' && !Array.isArray(input)

function check(field: Field, value: unknown): boolean {
  switch (field.type) {
    case 'string': return typeof value === 'string' && value.length <= (field.maxLength ?? 2000)
      && (field.pattern === undefined || new RegExp(field.pattern).test(value))
      && (field.enum === undefined || field.enum.includes(value))
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value) && value.length <= (field.maxItems ?? 0)
      && value.every(item => field.items !== undefined && check(field.items, item))
    case 'object': return record(value)
  }
}

function argumentsFor(schema: ToolSchema, args: unknown): Args {
  if (args === undefined) args = {}
  if (!record(args)) throw new McpError('工具参数必须是对象')
  for (const key of schema.required) if (!Object.hasOwn(args, key)) throw new McpError('缺少参数 ' + key)
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key) || !check(schema.properties[key], value)) throw new McpError('参数不受支持或不符合约束')
  }
  return args
}

function tool(name: string, description: string, run: Tool['run'], properties: Record<string, Field> = {}, required: string[] = []): Tool {
  return { name, description, run, inputSchema: { type: 'object', properties, required, additionalProperties: false } }
}
const projectPath = (a: Args, field = 'project_id') => '/api/projects/' + text(a, field)
const versionPath = (a: Args) => projectPath(a) + '/versions'

type BlockSummary = { id: string; type: Block['type']; text: string; children?: BlockSummary[] }
function blockSummary(block: Block): BlockSummary {
  return {
    id: block.id, type: block.type, text: summarize(block).replace(/\s+/g, ' ').slice(0, 80),
    ...(block.type === 'box' && { children: block.props.children.map(blockSummary) }),
  }
}

function overview(doc: Doc) {
  const blocks = flatBlocks(doc.blocks)
  return {
    id: doc.id, title: doc.title, author: doc.author, digest: doc.digest, themeId: doc.themeId, revision: doc.revision,
    updatedAt: doc.updatedAt, hasCover: Boolean(doc.cover), blockCount: blocks.length, blocks: doc.blocks.map(blockSummary),
  }
}

async function save(api: LocalApi, doc: Doc): Promise<Doc> {
  const saved = await api.json<{ updatedAt: number; revision: string }>('/api/projects/' + doc.id, 'PUT', doc)
  return { ...doc, updatedAt: saved.updatedAt, revision: saved.revision }
}

function blankDoc(title: string): Doc {
  const now = Date.now()
  return {
    id: newId(), title, author: '', digest: '', themeId: 'tsinghua-purple',
    blocks: [createBlock('cover'), createBlock('heading'), createBlock('paragraph'), createBlock('ending')],
    createdAt: now, updatedAt: now,
  }
}

async function createProject(api: LocalApi, args: Args) {
  const title = text(args, 'title')
  const article = text(args, 'text')
  if (!article) return { created: overview(await save(api, blankDoc(title ?? '未命名推文'))) }
  const ids = (args.image_asset_ids ?? []) as string[]
  const assets = ids.length ? await api.json<Asset[]>('/api/assets') : []
  const refs = ids.flatMap((id): ImageRef[] => {
    const a = assets.find(asset => asset.id === id)
    return a && MEDIA.test('/media/' + a.file) ? [{ src: '/media/' + a.file, assetId: a.id, alt: a.name, width: a.width, height: a.height }] : []
  })
  const outline = parseArticle(article)
  const doc = buildFromDesign(outline, refs, normalizeDesign(undefined, outline.sections.length))
  if (title) doc.title = title
  return { created: overview(await save(api, doc)) }
}

async function editProject(api: LocalApi, args: Args) {
  const doc = await api.json<Doc>(projectPath(args))
  if (doc.revision !== args.revision) throw new McpError('项目已被修改，请重新读取 revision')
  const rejected: { index: number; error: string }[] = []
  const dryRun = args.dry_run !== false
  let current = doc
  for (const [index, input] of (args.ops as Args[]).entries()) {
    const result = validateOp(current, input)
    if (!result.op || result.error) rejected.push({ index, error: result.error ?? '无效操作' })
    else if (!dryRun && result.op.op === 'remove') rejected.push({ index, error: '删除模块仅可预览，不能由 MCP 保存' })
    else current = applyOps(current, [result.op])
  }
  const applied = (args.ops as Args[]).length - rejected.length
  return dryRun || !applied
    ? { applied, rejected, dryRun, preview: overview(current) }
    : { applied, rejected, dryRun: false, project: overview(await save(api, current)) }
}

async function upload(api: LocalApi, args: Args) {
  const name = text(args, 'filename')!
  const encoded = text(args, 'base64')!
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new McpError('图片必须为标准 Base64')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > MAX_ASSET || bytes.toString('base64') !== encoded) throw new McpError('图片编码无效或超过 3 MiB')
  const form = new FormData()
  form.append('files', new Blob([new Uint8Array(bytes)]), name)
  return api.json('/api/assets', 'POST', form)
}

async function compile(api: LocalApi, args: Args) {
  const doc = await api.json<Doc>(projectPath(args))
  const urls = new Set<string>()
  compileDoc(doc, { mapImage: src => { if (MEDIA.test(src)) urls.add(src); return src } })
  const mapped = new Map<string, string>()
  let remaining = MAX_EMBEDDED
  for (const src of urls) {
    if (args.images !== 'embed') { mapped.set(src, api.origin + src); continue }
    if (mapped.size >= 64 || remaining <= 0) throw new McpError('内嵌图片数量或容量超限')
    const response = await api.request(src)
    const type = response.headers.get('content-type') ?? ''
    if (!RASTER_TYPE.test(type)) {
      await response.body?.cancel()
      throw new McpError('只能内嵌本机素材中的光栅图片')
    }
    const bytes = await readBoundedResponse(response, remaining)
    remaining -= bytes.length
    mapped.set(src, 'data:' + type + ';base64,' + bytes.toString('base64'))
  }
  let emitted = 0
  const result = compileDoc(doc, { mapImage: src => {
    const image = mapped.get(src) ?? src
    if (image.startsWith('data:')) {
      emitted += image.length
      if (emitted > MAX_INLINE_OUTPUT) return ''
    }
    return image
  } })
  if (emitted > MAX_INLINE_OUTPUT) throw new McpError('输出内嵌图片累计容量超限')
  return { title: doc.title, charCount: result.charCount, warnings: result.warnings, ...(args.include_html === false ? {} : { html: result.html }) }
}

function tools(api: LocalApi) {
  const project = { project_id: ident }
  return [
    tool('xiumi_status', '查看本机 API 和 AI 配置状态；本工具不联系外部服务', async () => {
      const ai = await api.json<{ enabled: boolean }>('/api/ai/status')
      return { ready: true, ai: { enabled: ai.enabled }, publishAllowedByMcp: false }
    }),
    tool('xiumi_list_projects', '列出本机项目', () => api.json('/api/projects')),
    tool('xiumi_get_project', '查看项目概要或完整文档', async a => {
      const doc = await api.json<Doc>(projectPath(a, 'id'))
      return a.full ? doc : overview(doc)
    }, { id: ident, full: bool }, ['id']),
    tool('xiumi_get_block', '查看指定模块', async a => {
      const doc = await api.json<Doc>(projectPath(a))
      const block = flatBlocks(doc.blocks).find(block => block.id === a.block_id)
      if (!block) throw new McpError('模块不存在')
      return block
    }, { ...project, block_id: ident }, ['project_id', 'block_id']),
    tool('xiumi_list_versions', '列出项目历史版本', a => api.json(versionPath(a)), project, ['project_id']),
    tool('xiumi_list_assets', '列出本机素材', () => api.json('/api/assets')),
    tool('xiumi_list_themes', '列出内置和自定义主题', async () => [...allThemes(), ...await api.json<{ id: string; name: string }[]>('/api/themes')].map(({ id, name }) => ({ id, name }))),
    tool('xiumi_list_templates', '列出本机模板', () => api.json('/api/templates')),
    tool('xiumi_list_components', '列出本机复用组件', () => api.json('/api/components')),
    tool('xiumi_upload_asset', '上传至多 3 MiB 的 PNG、JPEG、GIF 或 WebP 字节；不接受文件路径', a => upload(api, a), {
      filename: { ...str(100), pattern: '^[A-Za-z0-9_-]{1,90}\\.(?:png|jpe?g|gif|webp)$' }, base64: str(B64_LIMIT),
    }, ['filename', 'base64']),
    tool('xiumi_create_project', '用本地规则新建空白或排版文稿', a => createProject(api, a), {
      title: str(), text: str(100_000), image_asset_ids: list(ident, 50),
    }),
    tool('xiumi_apply_ops', '校验 DocOp；需要读取时的 revision。默认仅预览，dry_run:false 才保存非删除操作', a => editProject(api, a), {
      ...project, revision: str(100), ops: list({ type: 'object' }, 100), dry_run: bool,
    }, ['project_id', 'revision', 'ops']),
    tool('xiumi_save_version', '将当前稿件保存为历史版本', async a => {
      const doc = await api.json<Doc>(projectPath(a))
      return api.json(versionPath(a), 'POST', { doc, label: text(a, 'label') ?? 'MCP 保存' })
    }, { ...project, label: str(200) }, ['project_id']),
    tool('xiumi_compile', '返回 HTML；默认本机素材地址，显式选择 embed 内嵌光栅素材，不写入客户端指定文件', a => compile(api, a), {
      ...project, images: { type: 'string', enum: ['local', 'embed'] }, include_html: bool,
    }, ['project_id']),
    tool('xiumi_export_markdown', '返回 Markdown 文本', async a => ({
      markdown: docToMarkdown(await api.json<Doc>(projectPath(a))),
    }), project, ['project_id']),
  ]
}

type ToolResult = { isError?: true; content: [{ type: 'text'; text: string }] }

export function createLocalMcp(config: string) {
  const toolList = tools(localApi(config))
  const byName = new Map(toolList.map(item => [item.name, item]))
  const catalog = toolList.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  return {
    catalog,
    async invoke(name: unknown, args: unknown): Promise<ToolResult> {
      try {
        const selected = typeof name === 'string' ? byName.get(name) : undefined
        if (!selected) throw new McpError('工具不存在或当前未启用')
        const result = JSON.stringify(await selected.run(argumentsFor(selected.inputSchema, args)))
        if (Buffer.byteLength(result) > MAX_TOOL_OUTPUT) throw new McpError('工具返回内容超出容量限制')
        return { content: [{ type: 'text', text: result }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof McpError ? error.message : '本机操作失败' }] }
      }
    },
  }
}

export type LocalMcp = ReturnType<typeof createLocalMcp>
