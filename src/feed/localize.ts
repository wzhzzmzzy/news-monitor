import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { FeedConfig } from './config.js'
import { writeJson, type StoredItem } from './store.js'
import { resolveLlm, requireLlm } from './llm.js'
import { isBlog } from './blogs.js'
import { LEGACY_PROMPTS_HASH } from './prompts.js'

export const SUMMARY_LIMIT = 200
const VERSION = 'zh-reading-v1'
const hasChinese = (text: string) => /\p{Script=Han}/u.test(text)
export const summarySchema = z.string().trim().min(1)
  .refine(text => Array.from(text).length <= SUMMARY_LIMIT, '摘要不得超过 200 个字符（含标点）')
  .refine(hasChinese, '摘要必须为中文')
const languageSchema = z.enum(['zh', 'other', 'mixed', 'nonlinguistic'])
const partSchema = z.object({
  titleLanguage: languageSchema,
  contentLanguage: languageSchema,
  titleZh: z.string().trim().min(1),
  contentZh: z.string(),
  summaryZh: summarySchema,
})
const reducedSchema = z.object({ summaryZh: summarySchema })
const summaryPartSchema = z.object({ titleZh: z.string().trim().min(1), summaryZh: summarySchema })
const readingSchema = z.object({
  version: z.literal(VERSION), fingerprint: z.string(), model: z.string(), processedAt: z.string(),
  translated: z.boolean(), titleZh: z.string().min(1), contentZh: z.string(),
  summaryZh: summarySchema, chunks: z.number().int().positive(),
  mode: z.enum(['summary', 'full']).optional(),
})
export type ChineseReading = z.infer<typeof readingSchema>
export interface ReadingItem extends StoredItem {
  chinese?: ChineseReading
  chineseStatus?: 'ready' | 'pending' | 'failed' | 'disabled'
  chineseError?: string
}
export interface LocalizationStats {
  enabled: boolean
  total: number
  ready: number
  cached: number
  generated: number
  pending: number
  failed: number
}
export type ReadingRequest = {
  kind: 'translate' | 'summary-part' | 'summarize'
  payload: Record<string, unknown>
  retry: boolean
}
export type ReadingRunner = (request: ReadingRequest) => Promise<unknown>

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function splitContent(text: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid chunk size')
  const chars = Array.from(text)
  const chunks: string[] = []
  for (let offset = 0; offset < chars.length;) {
    let end = Math.min(offset + limit, chars.length)
    if (end < chars.length) {
      const newline = chars.slice(offset, end).lastIndexOf('\n')
      if (newline >= limit / 2) end = offset + newline + 1
    }
    chunks.push(chars.slice(offset, end).join(''))
    offset = end
  }
  return chunks.length ? chunks : ['']
}

function modelRunner(config: NonNullable<FeedConfig['llm']>, prompts: FeedConfig['prompts']): ReadingRunner {
  const resolved = requireLlm(config)
  const model = createOpenAI(resolved)(resolved.model)
  return async request => {
    const result = await generateObject({
      model, mode: config.mode, schema: (request.kind === 'translate' ? partSchema : request.kind === 'summary-part' ? summaryPartSchema : reducedSchema) as z.ZodType<{ summaryZh: string }>,
      maxRetries: config.maxRetries, maxTokens: request.kind === 'translate' ? config.translationMaxTokens : config.summaryMaxTokens,
      temperature: config.temperature, abortSignal: AbortSignal.timeout(config.timeoutMs),
      system: prompts.common + (request.kind === 'translate' ? prompts.translate : request.kind === 'summary-part' ? prompts.summaryPart : prompts.reduce) + (request.retry ? prompts.retry : ''),
      prompt: JSON.stringify(request.payload),
    })
    if (result.finishReason === 'length') throw new Error('Incomplete model output')
    return result.object
  }
}

async function cachedJson<T>(file: string, validate: (value: unknown) => T): Promise<T | undefined> {
  let raw: string
  try { raw = await fs.readFile(file, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  // Derived caches can be regenerated. Original source packs are never modified.
  try { return validate(JSON.parse(raw)) } catch { return undefined }
}

function validatePart(value: unknown, title: string, content: string) {
  const part = partSchema.parse(value)
  for (const [original, language, translated] of [
    [title, part.titleLanguage, part.titleZh], [content, part.contentLanguage, part.contentZh],
  ]) {
    if (language === 'zh' && original.trim() && !hasChinese(original)) throw new Error('Incorrect Chinese language classification')
    if (['other', 'mixed'].includes(language) && original.trim() && (!translated.trim() || !hasChinese(translated))) throw new Error('Missing Chinese translation')
  }
  if (!content.trim() && part.contentZh.trim()) throw new Error('Invented body for empty source')
  return part
}

function packSummaries(summaries: string[], limit: number): string[][] {
  const groups: string[][] = []
  let group: string[] = []
  let length = 0
  for (const summary of summaries) {
    const size = Array.from(summary).length + 1
    if (group.length && length + size > limit) { groups.push(group); group = []; length = 0 }
    group.push(summary)
    length += size
  }
  if (group.length) groups.push(group)
  return groups
}

export async function localizeItems(items: StoredItem[], config: FeedConfig, runner?: ReadingRunner): Promise<{ items: ReadingItem[]; stats: LocalizationStats }> {
  const stats: LocalizationStats = { enabled: config.localization.enabled, total: items.length, ready: 0, cached: 0, generated: 0, pending: 0, failed: 0 }
  if (!config.localization.enabled) return { items: items.map(item => ({ ...item, chineseStatus: 'disabled' })), stats }
  const llm = config.llm
  let resolved: ReturnType<typeof resolveLlm> | undefined
  try { if (llm) resolved = resolveLlm(llm) } catch { /* Pending items retain their originals. */ }
  const available = !!runner || !!resolved?.apiKey
  const run = runner || (available && llm ? modelRunner(llm, config.prompts) : undefined)
  const modelIdentity = { version: VERSION, model: llm?.model || 'unconfigured', baseUrl: resolved?.baseURL || llm?.baseUrl || '', piProvider: llm?.piProvider || '', mode: llm?.mode || 'json' }
  const generationIdentity = { prompts: config.prompts, temperature: llm?.temperature, summaryMaxTokens: llm?.summaryMaxTokens, translationMaxTokens: llm?.translationMaxTokens }
  const legacyCompatible = hash(config.prompts) === LEGACY_PROMPTS_HASH && llm?.temperature === undefined && llm?.summaryMaxTokens === 1024 && llm?.translationMaxTokens === 8192
  const output: ReadingItem[] = new Array(items.length)
  let next = 0
  let blogAttempts = 0
  const order = items.map((item, index) => ({ item, index })).sort((a, b) =>
    Number(isBlog(a.item)) - Number(isBlog(b.item)) ||
    (isBlog(a.item) ? (b.item.publishedAt || b.item.firstSeen).localeCompare(a.item.publishedAt || a.item.firstSeen) : 0))
  const processItem = async (item: StoredItem): Promise<ReadingItem> => {
    const context = { title: item.title, source: item.sourceName, category: item.category, contentKind: item.contentKind }
    const summaryOnly = config.localization.mode === 'summary'
    const identity = { ...modelIdentity, id: item.id, context, content: item.content, chunkChars: config.localization.chunkChars }
    // Prompt and generation changes invalidate both item and step caches.
    // Compatible historical full caches can still supply titles and summaries.
    const fingerprint = hash({ ...identity, ...generationIdentity, readingMode: config.localization.mode, ...(summaryOnly ? { summaryChunkChars: config.localization.summaryChunkChars } : {}) })
    const file = path.join(config.archiveDir, 'chinese', 'items', `${fingerprint}.json`)
    try {
      const cached = await cachedJson(file, value => {
        const reading = readingSchema.parse(value)
        if (reading.fingerprint !== fingerprint) throw new Error('Stale localization')
        return reading
      })
      if (cached) { stats.ready++; stats.cached++; return { ...item, chinese: cached, chineseStatus: 'ready' } }
      const reusable = [
        ...(summaryOnly ? [hash({ ...identity, ...generationIdentity, readingMode: 'full' })] : []),
        ...(legacyCompatible ? [hash(identity)] : []),
      ]
      for (const oldFingerprint of reusable) {
        const full = await cachedJson(path.join(config.archiveDir, 'chinese', 'items', `${oldFingerprint}.json`), value => {
          const reading = readingSchema.parse(value)
          if (reading.fingerprint !== oldFingerprint || reading.mode === 'summary') throw new Error('Stale localization')
          return reading
        })
        if (full) {
          stats.ready++; stats.cached++
          return { ...item, chinese: summaryOnly ? { ...full, fingerprint, mode: 'summary', contentZh: '', translated: false } : full, chineseStatus: 'ready' }
        }
      }
      if (!run) {
        stats.pending++
        return { ...item, chineseStatus: 'pending', chineseError: `尚未配置可用模型；原文已保存，${summaryOnly ? '中文摘要' : '中文翻译和摘要'}待处理。` }
      }
      if (isBlog(item) && blogAttempts++ >= config.localization.blogBatchSize) {
        stats.pending++
        return { ...item, chineseStatus: 'pending', chineseError: `原文已归档，${summaryOnly ? '中文摘要' : '中文翻译和摘要'}排队中；后续采集会继续处理。` }
      }
      async function step<T>(kind: ReadingRequest['kind'], payload: Record<string, unknown>, validate: (value: unknown) => T): Promise<T> {
        const stepFile = path.join(config.archiveDir, 'chinese', 'steps', `${hash({ ...modelIdentity, ...generationIdentity, kind, payload })}.json`)
        const cached = await cachedJson(stepFile, validate)
        if (cached) return cached
        for (let attempt = 0; ; attempt++) {
          try {
            const result = validate(await run!({ kind, payload, retry: attempt > 0 }))
            await writeJson(stepFile, result)
            return result
          } catch (error) { if (attempt >= (llm?.validationRetries ?? 1)) throw error }
        }
      }
      const chunkChars = summaryOnly ? config.localization.summaryChunkChars : config.localization.chunkChars
      const chunks = splitContent(item.content, chunkChars)
      const parts: z.infer<typeof partSchema>[] = []
      const summaryParts: z.infer<typeof summaryPartSchema>[] = []
      for (let i = 0; i < chunks.length; i++) {
        const payload = { ...context, content: chunks[i], part: i + 1, totalParts: chunks.length }
        if (summaryOnly) summaryParts.push(await step('summary-part', payload, value => summaryPartSchema.parse(value)))
        else parts.push(await step('translate', payload, value => validatePart(value, item.title, chunks[i])))
      }
      let summaries = (summaryOnly ? summaryParts : parts).map(part => part.summaryZh)
      while (summaries.length > 1) {
        const reduced: string[] = []
        for (const group of packSummaries(summaries, chunkChars)) {
          if (group.length === 1) reduced.push(group[0])
          else reduced.push((await step('summarize', { ...context, summaries: group }, value => reducedSchema.parse(value))).summaryZh)
        }
        summaries = reduced
      }
      const needsTranslation = (language: string) => language === 'other' || language === 'mixed'
      const translated = !summaryOnly && (needsTranslation(parts[0].titleLanguage) || parts.some(part => needsTranslation(part.contentLanguage)))
      const contentZh = summaryOnly ? '' : parts.every(part => !needsTranslation(part.contentLanguage)) ? item.content
        : parts.map((part, i) => needsTranslation(part.contentLanguage) ? part.contentZh : chunks[i]).join('\n\n')
      const chinese = readingSchema.parse({ version: VERSION, fingerprint, model: modelIdentity.model, processedAt: new Date().toISOString(), translated,
        mode: config.localization.mode,
        titleZh: summaryOnly ? (hasChinese(item.title) ? item.title : summaryParts[0].titleZh) : needsTranslation(parts[0].titleLanguage) ? parts[0].titleZh : item.title, contentZh,
        summaryZh: summaries[0], chunks: chunks.length,
      })
      await writeJson(file, chinese)
      stats.ready++; stats.generated++
      return { ...item, chinese, chineseStatus: 'ready' }
    } catch {
      stats.failed++
      return { ...item, chineseStatus: 'failed', chineseError: `${summaryOnly ? '中文摘要' : '中文翻译或摘要'}生成失败，原文已保留；再次运行可重试并复用成功分段。` }
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.localization.concurrency, items.length) }, async () => {
    while (next < items.length) {
      const { index } = order[next++]
      output[index] = await processItem(items[index])
    }
  }))
  return { items: output, stats }
}

export const localizationIncomplete = (stats: LocalizationStats) => stats.failed > 0 || (stats.enabled && stats.ready < stats.total)

// Reports have a terminal barrier: every eligible article gets its turn,
// regardless of the independent collector's blog budget. Await all workers.
export async function localizeReportItems(items: StoredItem[], config: FeedConfig, localize = localizeItems) {
  const result = await localize(items, { ...config, localization: { ...config.localization, blogBatchSize: items.length } })
  const ids = new Set(items.map(item => item.id))
  if (result.items.length !== items.length || new Set(result.items.map(item => item.id)).size !== items.length || result.items.some(item => !ids.has(item.id))) {
    throw new Error('Report localization returned incomplete candidates')
  }
  // localizeItems has returned, so no worker remains in flight. With no budget
  // exclusion, pending/disabled means unavailable configuration, not a queue.
  const settled = result.items.map(item => item.chineseStatus === 'pending' || item.chineseStatus === 'disabled'
    ? { ...item, chineseStatus: 'failed' as const, chineseError: `本次摘要处理未能执行：${item.chineseError || '中文处理已关闭；请启用 localization 并配置可用模型。'}` }
    : item)
  if (settled.some(item => !['ready', 'failed'].includes(item.chineseStatus || ''))) throw new Error('Report summaries have not settled')
  return { items: settled, stats: { ...result.stats, ready: settled.filter(item => item.chineseStatus === 'ready').length,
    failed: settled.filter(item => item.chineseStatus === 'failed').length, pending: 0 } }
}
