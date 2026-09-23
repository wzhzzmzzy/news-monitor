import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'
import { withBlogCatalog } from './blogs.js'
import { defaultPrompts, promptsSchema } from './prompts.js'

const common = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.string().default('未分类'),
  limit: z.number().int().min(1).max(100).default(10),
  enabled: z.boolean().default(true),
  disabledReason: z.string().optional(),
  channel: z.enum(['news', 'blogs']).optional(),
  siteUrl: z.string().url().refine(value => /^https?:\/\//.test(value)).optional(),
  siteAliases: z.array(z.string().url().refine(value => /^https?:\/\//.test(value))).optional(),
}
const httpUrl = z.string().url().refine(value => /^https?:\/\//.test(value), 'Expected HTTP(S) URL')
// Optional source-level evidence boundary; never asserts that a feed is full text.
const feedContentKind = z.enum(['feed-summary', 'link-metadata']).optional()
export const feedSourceSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('rss'), url: httpUrl, contentKind: feedContentKind }),
  z.object({ ...common, type: z.literal('rsshub'), route: z.string().regex(/^\/(?!\/)[^\s]*$/), baseUrl: httpUrl.optional(), contentKind: feedContentKind }),
  z.object({ ...common, type: z.literal('x-user'), username: z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/) }),
  z.object({ ...common, type: z.literal('x-list'), listId: z.string().regex(/^\d+$/) }),
])
export const feedConfigSchema = z.object({
  archiveDir: z.string().default('./archive/feed-v1'),
  blogCatalog: z.string().min(1).optional(),
  collection: z.object({
    rssConcurrency: z.number().int().min(1).max(8).default(4),
    rssTimeoutMs: z.number().int().min(100).max(600000).default(20000),
    rssRetries: z.number().int().min(0).max(5).default(1),
    retryDelayMs: z.number().int().min(0).max(60000).default(500),
    userAgent: z.string().min(1).max(500).regex(/^[^\r\n]+$/).default('news-monitor/1.0 (personal RSS reader)'),
    xMaxItems: z.number().int().min(100).max(10000).default(1000),
  }).default({}),
  sources: z.array(feedSourceSchema).min(1).refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Source IDs must be unique'),
  opencli: z.object({
    enabled: z.boolean().default(true),
    profile: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(100).max(600000).default(120000),
    maxBufferBytes: z.number().int().min(1024).max(104857600).default(10485760),
  }).default({}),
  prompts: promptsSchema.default(defaultPrompts),
  rsshub: z.object({ baseUrl: httpUrl.default('https://rsshub.app') }).default({}),
  localization: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(['summary', 'full']).default('summary'),
    summaryChunkChars: z.number().int().min(500).max(60000).default(24000),
    chunkChars: z.number().int().min(500).max(6000).default(3000),
    concurrency: z.number().int().min(1).max(4).default(2),
    blogBatchSize: z.number().int().min(0).max(500).default(20),
  }).default({}),
  curation: z.object({
    enabled: z.boolean().default(false),
    minPicks: z.number().int().min(0).max(20).default(10),
    maxPicks: z.number().int().min(1).max(20).default(20),
    selectionCriteria: z.array(z.string().min(1)).min(1).default(['有切实影响并且影响力大、影响程度深、影响范围广', '内容非常优质、非常值得阅读', '属于某领域的重大进展', '非常奇怪，超出常规认知']),
    interests: z.string().min(1).max(1000).default('技术、商业与人文。优先重要变化、原始信息、扎实分析、可复用知识与有启发的观点；降低日常行情碎片、消费品促销上新、标题党、重复报道和缺乏上下文的闲聊的优先级。'),
  }).transform(value => ({ ...value, minPicks: Math.min(value.minPicks, value.maxPicks) })).default({}),
  schedule: z.object({
    collect: z.string().default('*/30 * * * *'),
    report: z.string().optional(),
    timezone: z.string().default('Asia/Shanghai'),
    analyze: z.boolean().default(false),
    sendEmail: z.boolean().default(false),
  }).default({}),
  serverPort: z.number().int().positive().default(12440),
  email: z.object({
    smtpHost: z.string().optional(), smtpPort: z.number().int().positive().optional(),
    smtpUser: z.string().optional(), passwordEnv: z.string().default('NEWS_FEED_SMTP_PASS'),
    emailFromName: z.string().default('News Feed'),
    emailFrom: z.string().email(), emailTo: z.array(z.string().email()).min(1),
  }).optional(),
  llm: z.object({
    model: z.string().min(1),
    piProvider: z.string().min(1).optional(),
    piModelsPath: z.string().min(1).optional(),
    baseUrl: httpUrl.optional(),
    apiKeyEnv: z.string().default('NEWS_FEED_LLM_API_KEY'),
    mode: z.enum(['auto', 'json', 'tool']).default('json'),
    timeoutMs: z.number().int().min(100).max(600000).default(120000),
    maxRetries: z.number().int().min(0).max(5).default(1),
    validationRetries: z.number().int().min(0).max(5).default(1),
    summaryMaxTokens: z.number().int().min(128).max(32768).default(1024),
    translationMaxTokens: z.number().int().min(128).max(32768).default(8192),
    temperature: z.number().min(0).max(2).optional(),
    maxItems: z.number().int().min(1).max(100).default(30),
    maxCharsPerItem: z.number().int().min(200).max(12000).default(4000),
  }).optional(),
})
export type FeedConfig = z.infer<typeof feedConfigSchema>
export type FeedSource = z.infer<typeof feedSourceSchema>

export function parseFeedConfig(raw: unknown): FeedConfig {
  if (raw && typeof raw === 'object' && ['newsApiBaseUrl', 'hotlist_sources', 'stream_sources'].some(key => key in raw)) {
    throw new Error('旧 NewsNow 配置不再支持。请按 config.example.yaml 使用 RSS/X sources；来源映射见 docs/source-migration.md。')
  }
  return feedConfigSchema.parse(raw)
}

// Objects merge recursively; arrays/scalars replace. Only sourceFiles append
// sources, so replacing other arrays never silently duplicates configuration.
type Document = Record<string, unknown>
const isObject = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value)
function merge(base: Document, override: Document): Document {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe configuration key')
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value
  }
  return result
}
async function readDocument(file: string): Promise<unknown> {
  try { return yaml.load(await fs.readFile(file, 'utf8')) }
  catch { throw new Error(`Cannot read YAML configuration: ${file}`) }
}
async function loadDocument(file: string, stack: string[] = []): Promise<Document> {
  const absolute = await fs.realpath(file)
  if (stack.includes(absolute)) throw new Error(`Configuration include cycle: ${absolute}`)
  if (stack.length >= 20) throw new Error('Configuration include depth exceeds 20')
  const raw = await readDocument(absolute)
  if (!isObject(raw)) throw new Error(`Expected a YAML object: ${absolute}`)
  const directory = path.dirname(absolute)
  const includes = z.array(z.string().min(1)).parse(raw.includes ?? [])
  let combined: Document = {}
  for (const include of includes) combined = merge(combined, await loadDocument(path.resolve(directory, include), [...stack, absolute]))
  const own = { ...raw }
  delete own.includes
  const sourceFiles = z.array(z.string().min(1)).parse(own.sourceFiles ?? [])
  delete own.sourceFiles
  if (sourceFiles.length) {
    const sources: unknown[] = []
    for (const sourceFile of sourceFiles) {
      const sourcePath = path.resolve(directory, sourceFile)
      const document = await readDocument(sourcePath)
      sources.push(...z.array(feedSourceSchema).parse(document))
    }
    own.sources = [...sources, ...z.array(feedSourceSchema).parse(own.sources ?? [])]
  }
  // Resolve at the declaring file, before merging a parent override.
  for (const key of ['archiveDir', 'blogCatalog']) if (typeof own[key] === 'string') own[key] = path.resolve(directory, own[key])
  if (isObject(own.llm) && typeof own.llm.piModelsPath === 'string' && !own.llm.piModelsPath.startsWith('~/')) {
    own.llm = { ...own.llm, piModelsPath: path.resolve(directory, own.llm.piModelsPath) }
  }
  return merge(combined, own)
}

export async function loadFeedConfig(file: string): Promise<FeedConfig> {
  const raw = await loadDocument(file)
  const config = parseFeedConfig(raw)
  config.archiveDir = path.resolve(path.dirname(file), config.archiveDir)
  if (config.blogCatalog) config.sources = await withBlogCatalog(config.sources, config.blogCatalog)
  return config
}
