import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FeedConfig } from './config.js'
import type { StoredItem } from './store.js'
import { FeedStore, writeJson } from './store.js'
import { localizeItems, localizationIncomplete, type ReadingItem } from './localize.js'
import { readEvidenceWindow, reportRange } from './runtime.js'
import { belongsToBlog, isBlog } from './blogs.js'
import { runFeed } from './pipeline.js'

const timestamp = z.string().datetime({ offset: true })
const itemSchema = z.object({
  id: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string(), summary: z.string().nullable(), languageStatus: z.enum(['ready', 'pending', 'failed', 'disabled']),
  source: z.string(), sourceId: z.string(), category: z.string(), url: z.string(), discussionUrl: z.string().optional(),
  publishedAt: timestamp.nullable(), observedAt: timestamp, firstSeen: timestamp,
  contentKind: z.enum(['feed-content', 'feed-summary', 'link-metadata', 'title-only', 'post']),
  change: z.enum(['new', 'updated', 'unchanged', 'resurfaced', 'observed']),
})
const windowSchema = z.object({ start: timestamp, end: timestamp, basis: z.enum(['collectedAt', 'publishedAt']) })
const publicationFilterSchema = z.object({
  basis: z.literal('publishedAt'), scope: z.enum(['news', 'blogs']), missingDate: z.literal('exclude'), included: z.number().int().nonnegative(),
  excluded: z.object({ beforeStart: z.number().int().nonnegative(), atOrAfterEnd: z.number().int().nonnegative(), missingDate: z.number().int().nonnegative(), invalidDate: z.number().int().nonnegative() }),
})

export const newsSchema = z.object({
  version: z.literal('news-list-v1'), snapshotId: z.string().uuid(), snapshotPath: z.string(), createdAt: timestamp,
  edition: z.enum(['morning', 'evening', 'custom']), window: windowSchema,
  observedThrough: timestamp.optional(),
  publicationFilter: publicationFilterSchema.extend({ scope: z.literal('news') }).optional(),
  blogPublicationFilter: publicationFilterSchema.extend({ scope: z.literal('blogs') }).optional(),
  status: z.enum(['ready', 'partial', 'empty']), preferences: z.object({ interests: z.string(), maxPicks: z.number().int() }),
  coverage: z.object({ complete: z.literal(false), observations: z.array(timestamp), failedSources: z.array(z.string()), missingSources: z.array(z.string()), incompleteSources: z.array(z.string()).default([]), note: z.string() }),
  items: z.array(itemSchema),
  blogs: z.array(itemSchema).default([]),
  baseline: z.object({ snapshotId: z.string().uuid(), snapshotPath: z.string(), window: windowSchema, observedThrough: timestamp.optional(), status: z.enum(['ready', 'partial', 'empty']), items: z.array(itemSchema), blogs: z.array(itemSchema).default([]), coverage: z.object({ complete: z.literal(false), observations: z.array(timestamp), failedSources: z.array(z.string()), missingSources: z.array(z.string()), incompleteSources: z.array(z.string()).default([]), note: z.string() }) }).nullable(),
  counts: z.record(z.number().int().nonnegative()),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export type NewsList = z.infer<typeof newsSchema>
export type NewsItem = NewsList['items'][number]
export const hashBytes = (text: string) => createHash('sha256').update(text).digest('hex')
// Model wording, fetchedAt, likes and raw transport metadata do not change a revision.
export const contentRevision = (item: StoredItem) => hashBytes(JSON.stringify([item.title, item.content, item.contentKind, item.url]))

export function editionRange(edition: string, day: string) {
  if (!['morning', 'evening'].includes(edition)) throw new Error('--edition must be morning or evening')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('--day must be a valid YYYY-MM-DD')
  const end = new Date(`${day}T${edition === 'morning' ? '10' : '20'}:00:00+08:00`)
  return { start: new Date(+end - (edition === 'morning' ? 24 : 10) * 3600000), end }
}
export function shanghaiDay(now = new Date()) { return new Date(+now + 8 * 3600000).toISOString().slice(0, 10) }

export function parseNews(value: unknown): NewsList {
  const list = newsSchema.parse(value)
  for (const items of [[...list.items, ...list.blogs], [...(list.baseline?.items || []), ...(list.baseline?.blogs || [])]]) {
    if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('Duplicate snapshot item IDs')
  }
  if (Date.parse(list.window.end) <= Date.parse(list.window.start)) throw new Error('Invalid snapshot window')
  if (list.publicationFilter && (list.publicationFilter.included !== list.items.length || list.items.some(item => !item.publishedAt || Date.parse(item.publishedAt) < Date.parse(list.window.start) || Date.parse(item.publishedAt) >= Date.parse(list.window.end)))) throw new Error('Snapshot news does not match its publication window')
  if (list.blogPublicationFilter && (list.blogPublicationFilter.included !== list.blogs.length || list.blogs.some(item => !item.publishedAt || Date.parse(item.publishedAt) < Date.parse(list.window.start) || Date.parse(item.publishedAt) >= Date.parse(list.window.end)))) throw new Error('Snapshot blogs do not match their publication window')
  return list
}
export async function loadNews(file: string) { return parseNews(JSON.parse(await fs.readFile(file, 'utf8'))) }

export async function queryNews(config: FeedConfig, options: { start: Date; end: Date; edition?: 'morning' | 'evening'; baseline?: string; refresh?: boolean }, localize = localizeItems, collect = runFeed): Promise<NewsList> {
  let { start, end } = reportRange({ start: options.start.toISOString(), end: options.end.toISOString() })
  if (options.refresh && !options.edition) throw new Error('--refresh requires --edition')
  if (+end > Date.now()) throw new Error('Window has not ended yet; use a custom window ending now for an interim snapshot')
  if (options.edition === 'evening' && !options.baseline) throw new Error('Evening news requires the actual morning --baseline snapshot')
  const previous = options.baseline ? await loadNews(options.baseline) : undefined
  if (!options.refresh && previous && Date.parse(previous.window.end) !== +start) throw new Error('Baseline end must equal the new window start; gaps and overlaps are not allowed')
  if (options.edition === 'morning' && previous) throw new Error('Morning news uses a 24-hour window, not a baseline')
  if (options.edition) {
    const expected = editionRange(options.edition, shanghaiDay(end))
    if (+expected.start !== +start || +expected.end !== +end) throw new Error('Edition window does not match Asia/Shanghai cutoff')
    if (options.edition === 'evening' && previous?.edition !== 'morning') throw new Error('Evening baseline must be a morning snapshot')
  }
  let observedThrough = end
  if (options.refresh) {
    const day = shanghaiDay(end)
    if (day !== shanghaiDay()) throw new Error('--refresh only supports today; historical editions read the archive without --refresh')
    if (previous && (shanghaiDay(new Date(previous.window.end)) !== day || Date.parse(previous.window.end) >= Date.now())) throw new Error('Evening baseline must end earlier today')
    // The publication cutoff is fixed even when collection finishes later.
    if (previous) start = new Date(previous.window.end)
    if (+start >= +end) throw new Error('Baseline must end before the edition cutoff')
    const result = await collect(config, { publicationWindow: { start, end } })
    // Evidence uses a half-open observation interval; include this batch even
    // when collection and query finish in the same millisecond.
    observedThrough = new Date(Math.max(Date.now(), Date.parse(result.collectedAt)) + 1)
  }
  return new FeedStore(config.archiveDir).withLock(async () => {
    const evidence = await readEvidenceWindow(config.archiveDir, start, observedThrough, { includeUnchangedBlogs: true })
    const classified = evidence.items.map(item => belongsToBlog(item.url, config.sources) ? { ...item, channel: 'blogs' as const } : item)
    // A direct blog article takes precedence over community metadata for its URL.
    const blogUrls = new Set(classified.filter(item => isBlog(item) && item.contentKind !== 'link-metadata').map(item => item.url))
    const publicationFilter: NonNullable<NewsList['publicationFilter']> = { basis: 'publishedAt', scope: 'news', missingDate: 'exclude', included: 0,
      excluded: { beforeStart: 0, atOrAfterEnd: 0, missingDate: 0, invalidDate: 0 } }
    const blogPublicationFilter: NonNullable<NewsList['blogPublicationFilter']> = { ...publicationFilter, scope: 'blogs', excluded: { ...publicationFilter.excluded } }
    const eligible = classified.filter(item => {
      if (isBlog(item) && item.contentKind === 'link-metadata' && blogUrls.has(item.url)) return false
      const filter = isBlog(item) ? blogPublicationFilter : publicationFilter
      // A recent observation does not make an old or undated article recent news.
      if (!item.publishedAt) { filter.excluded.missingDate++; return false }
      if (!timestamp.safeParse(item.publishedAt).success) { filter.excluded.invalidDate++; return false }
      const published = Date.parse(item.publishedAt)
      if (published < +start) { filter.excluded.beforeStart++; return false }
      if (published >= +end) { filter.excluded.atOrAfterEnd++; return false }
      filter.included++
      return true
    })
    // Collection already spent the blog translation budget; reuse its cache here.
    const readingConfig = options.refresh ? { ...config, localization: { ...config.localization, blogBatchSize: 0 } } : config
    const reading = await localize(eligible, readingConfig)
    const old = new Map([...(previous?.items || []), ...(previous?.blogs || [])].map(i => [i.id, i]))
    const all: NewsItem[] = reading.items.map((item): NewsItem => {
      const revision = contentRevision(item)
      const before = old.get(item.id)
      return {
        id: item.id, revision, title: item.chinese?.titleZh || item.title, summary: item.chinese?.summaryZh || null,
        languageStatus: item.chineseStatus || (item.chinese ? 'ready' : 'disabled'),
        source: item.sourceName, sourceId: item.sourceId, category: item.category, url: item.url,
        ...(item.discussionUrl ? { discussionUrl: item.discussionUrl } : {}),
        publishedAt: item.publishedAt || null, observedAt: item.fetchedAt, firstSeen: item.firstSeen,
        contentKind: item.contentKind,
        change: !previous ? 'observed' : before ? before.revision === revision ? 'unchanged' : 'updated' : Date.parse(item.firstSeen) < +start ? 'resurfaced' : 'new',
      }
    }).sort((a, b) => a.id.localeCompare(b.id))
    const blogIds = new Set(reading.items.filter(isBlog).map(item => item.id))
    const items = all.filter(item => !blogIds.has(item.id))
    const blogs = all.filter(item => blogIds.has(item.id)).sort((a, b) => (b.publishedAt || b.observedAt).localeCompare(a.publishedAt || a.observedAt))
    const failedSources = evidence.results.filter(r => r.status === 'failed').map(r => r.sourceId)
    const missingSources = config.sources.filter(s => s.enabled && !evidence.results.some(r => r.sourceId === s.id)).map(s => s.id)
    const incompleteSources = evidence.results.filter(r => r.windowStartReached === false).map(r => r.sourceId)
    const snapshotId = randomUUID()
    const directory = path.join(config.archiveDir, 'snapshots', snapshotId)
    const snapshotPath = path.join(directory, 'news.json')
    const pack = { items: reading.items, stats: reading.stats, results: evidence.results }
    const packed = JSON.stringify(pack, null, 2) + '\n'
    const counts: Record<string, number> = { total: all.length, news: items.length, blogs: blogs.length, new: 0, updated: 0, unchanged: 0, resurfaced: 0, observed: 0 }
    for (const item of all) counts[item.change]++
    const result: NewsList = {
      version: 'news-list-v1', snapshotId, snapshotPath, createdAt: new Date().toISOString(), edition: options.edition || 'custom',
      window: { start: start.toISOString(), end: end.toISOString(), basis: 'publishedAt' },
      observedThrough: observedThrough.toISOString(),
      publicationFilter, blogPublicationFilter,
      status: !all.length ? 'empty' : failedSources.length || missingSources.length || incompleteSources.length || publicationFilter.excluded.missingDate || publicationFilter.excluded.invalidDate || blogPublicationFilter.excluded.missingDate || blogPublicationFilter.excluded.invalidDate || localizationIncomplete(reading.stats) || !reading.stats.enabled ? 'partial' : 'ready',
      preferences: { interests: config.curation.interests, maxPicks: config.curation.maxPicks },
      coverage: { complete: false, observations: evidence.observations, failedSources, missingSources, incompleteSources,
        note: '有限 RSS/X 快照，不能保证全量覆盖。新闻与博客按固定发布时间窗口筛选；observedThrough 单独记录可用采集批次的截止时间，刷新补采不会移动报告截止；无有效发布时间的条目不纳入。历史博客继续归档，重复观察或正文变化不会绕过发布时间限制。未再出现不表示撤稿；原文变化不等于事件进展。' },
      items, blogs,
      baseline: previous ? { snapshotId: previous.snapshotId, snapshotPath: path.resolve(options.baseline!), window: previous.window, observedThrough: previous.observedThrough, status: previous.status, items: previous.items, blogs: previous.blogs, coverage: previous.coverage } : null,
      counts, evidenceSha256: hashBytes(packed),
    }
    parseNews(result)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'reading-pack.json'), packed, { flag: 'wx', mode: 0o600 })
    await writeJson(snapshotPath, result)
    return result
  })
}

export async function loadSnapshotEvidence(snapshot: NewsList, file: string) {
  const bytes = await fs.readFile(path.join(path.dirname(file), 'reading-pack.json'), 'utf8')
  if (hashBytes(bytes) !== snapshot.evidenceSha256) throw new Error('Snapshot evidence hash mismatch')
  const pack = JSON.parse(bytes) as { items: ReadingItem[]; stats: Parameters<typeof import('./view.js').renderFeed>[4]; results: Parameters<typeof import('./view.js').renderFeed>[1] }
  const all = [...snapshot.items, ...snapshot.blogs]
  const blogIds = new Set(snapshot.blogs.map(item => item.id))
  if (pack.items.length !== all.length || new Set(pack.items.map(i => i.id)).size !== pack.items.length) throw new Error('Snapshot evidence IDs mismatch')
  for (const item of pack.items) {
    const listed = all.find(i => i.id === item.id)
    if (isBlog(item) !== blogIds.has(item.id)) throw new Error('Snapshot blog channel mismatch')
    if (!listed || contentRevision(item) !== listed.revision || (item.chinese?.summaryZh || null) !== listed.summary || (item.chinese?.titleZh || item.title) !== listed.title) throw new Error('Snapshot evidence content mismatch')
  }
  return pack
}
