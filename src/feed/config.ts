import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'

const common = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: z.string().default('未分类'),
  limit: z.number().int().min(1).max(100).default(10),
  enabled: z.boolean().default(true),
  disabledReason: z.string().optional(),
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
  sources: z.array(feedSourceSchema).min(1).refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Source IDs must be unique'),
  opencli: z.object({ profile: z.string().min(1).optional() }).default({}),
  rsshub: z.object({ baseUrl: httpUrl.default('https://rsshub.app') }).default({}),
  localization: z.object({
    enabled: z.boolean().default(true),
    chunkChars: z.number().int().min(500).max(6000).default(3000),
    concurrency: z.number().int().min(1).max(4).default(2),
  }).default({}),
  curation: z.object({
    enabled: z.boolean().default(true),
    maxPicks: z.number().int().min(1).max(20).default(10),
    interests: z.string().min(1).max(1000).default('技术、商业与人文。优先重要变化、原始信息、扎实分析、可复用知识与有启发的观点；降低日常行情碎片、消费品促销上新、标题党、重复报道和缺乏上下文的闲聊的优先级。'),
  }).default({}),
  schedule: z.object({
    collect: z.string().default('*/30 * * * *'),
    report: z.string().default('5 8,20 * * *'),
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

export async function loadFeedConfig(file: string): Promise<FeedConfig> {
  const config = parseFeedConfig(yaml.load(await fs.readFile(file, 'utf8')))
  config.archiveDir = path.resolve(path.dirname(file), config.archiveDir)
  if (config.llm?.piModelsPath && !config.llm.piModelsPath.startsWith('~/')) {
    config.llm.piModelsPath = path.resolve(path.dirname(file), config.llm.piModelsPath)
  }
  return config
}
