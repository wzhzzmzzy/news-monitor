import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FeedConfig } from './config.js'
import type { StoredItem } from './store.js'
import { FeedStore, writeJson } from './store.js'
import { localizeItems, localizationIncomplete, type ReadingItem } from './localize.js'
import { readEvidenceWindow, reportRange } from './runtime.js'

const timestamp = z.string().datetime({ offset: true })
const itemSchema = z.object({
  id: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string(), summary: z.string().nullable(), languageStatus: z.enum(['ready', 'pending', 'failed', 'disabled']),
  source: z.string(), sourceId: z.string(), category: z.string(), url: z.string(), discussionUrl: z.string().optional(),
  publishedAt: timestamp.nullable(), observedAt: timestamp, firstSeen: timestamp,
  contentKind: z.enum(['feed-content', 'feed-summary', 'link-metadata', 'title-only', 'post']),
  change: z.enum(['new', 'updated', 'unchanged', 'resurfaced', 'observed']),
})
const windowSchema = z.object({ start: timestamp, end: timestamp, basis: z.literal('collectedAt') })
export const newsSchema = z.object({
  version: z.literal('news-list-v1'), snapshotId: z.string().uuid(), snapshotPath: z.string(), createdAt: timestamp,
  edition: z.enum(['morning', 'evening', 'custom']), window: windowSchema,
  status: z.enum(['ready', 'partial', 'empty']), preferences: z.object({ interests: z.string(), maxPicks: z.number().int() }),
  coverage: z.object({ complete: z.literal(false), observations: z.array(timestamp), failedSources: z.array(z.string()), missingSources: z.array(z.string()), note: z.string() }),
  items: z.array(itemSchema),
  baseline: z.object({ snapshotId: z.string().uuid(), snapshotPath: z.string(), window: windowSchema, status: z.enum(['ready', 'partial', 'empty']), items: z.array(itemSchema), coverage: z.object({ complete: z.literal(false), observations: z.array(timestamp), failedSources: z.array(z.string()), missingSources: z.array(z.string()), note: z.string() }) }).nullable(),
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
  for (const items of [list.items, list.baseline?.items || []]) {
    if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('Duplicate snapshot item IDs')
  }
  if (Date.parse(list.window.end) <= Date.parse(list.window.start)) throw new Error('Invalid snapshot window')
  return list
}
export async function loadNews(file: string) { return parseNews(JSON.parse(await fs.readFile(file, 'utf8'))) }

export async function queryNews(config: FeedConfig, options: { start: Date; end: Date; edition?: 'morning' | 'evening'; baseline?: string }, localize = localizeItems): Promise<NewsList> {
  const { start, end } = reportRange({ start: options.start.toISOString(), end: options.end.toISOString() })
  if (+end > Date.now()) throw new Error('Window has not ended yet; use a custom window ending now for an interim snapshot')
  if (options.edition === 'evening' && !options.baseline) throw new Error('Evening news requires the actual morning --baseline snapshot')
  const previous = options.baseline ? await loadNews(options.baseline) : undefined
  if (previous && Date.parse(previous.window.end) !== +start) throw new Error('Baseline end must equal the new window start; gaps and overlaps are not allowed')
  if (options.edition === 'morning' && previous) throw new Error('Morning news uses a 24-hour window, not a baseline')
  if (options.edition) {
    const expected = editionRange(options.edition, shanghaiDay(end))
    if (+expected.start !== +start || +expected.end !== +end) throw new Error('Edition window does not match Asia/Shanghai cutoff')
    if (options.edition === 'evening' && previous?.edition !== 'morning') throw new Error('Evening baseline must be a morning snapshot')
  }
  return new FeedStore(config.archiveDir).withLock(async () => {
    const evidence = await readEvidenceWindow(config.archiveDir, start, end)
    const reading = await localize(evidence.items, config)
    const old = new Map(previous?.items.map(i => [i.id, i]))
    const items: NewsItem[] = reading.items.map((item): NewsItem => {
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
    const failedSources = evidence.results.filter(r => r.status === 'failed').map(r => r.sourceId)
    const missingSources = config.sources.filter(s => s.enabled && !evidence.results.some(r => r.sourceId === s.id)).map(s => s.id)
    const snapshotId = randomUUID()
    const directory = path.join(config.archiveDir, 'snapshots', snapshotId)
    const snapshotPath = path.join(directory, 'news.json')
    const pack = { items: reading.items, stats: reading.stats, results: evidence.results }
    const packed = JSON.stringify(pack, null, 2) + '\n'
    const counts: Record<string, number> = { total: items.length, new: 0, updated: 0, unchanged: 0, resurfaced: 0, observed: 0 }
    for (const item of items) counts[item.change]++
    const result: NewsList = {
      version: 'news-list-v1', snapshotId, snapshotPath, createdAt: new Date().toISOString(), edition: options.edition || 'custom',
      window: { start: start.toISOString(), end: end.toISOString(), basis: 'collectedAt' },
      status: !items.length ? 'empty' : failedSources.length || missingSources.length || localizationIncomplete(reading.stats) || !reading.stats.enabled ? 'partial' : 'ready',
      preferences: { interests: config.curation.interests, maxPicks: config.curation.maxPicks },
      coverage: { complete: false, observations: evidence.observations, failedSources, missingSources,
        note: '有限 RSS/X 快照，不能保证窗口内所有新闻均已采集；窗口按观察时间，不按发布时间。未再出现的条目不表示撤稿；原始文本变化不等于事件取得进展。' },
      items,
      baseline: previous ? { snapshotId: previous.snapshotId, snapshotPath: path.resolve(options.baseline!), window: previous.window, status: previous.status, items: previous.items, coverage: previous.coverage } : null,
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
  if (pack.items.length !== snapshot.items.length || new Set(pack.items.map(i => i.id)).size !== pack.items.length) throw new Error('Snapshot evidence IDs mismatch')
  for (const item of pack.items) {
    const listed = snapshot.items.find(i => i.id === item.id)
    if (!listed || contentRevision(item) !== listed.revision || (item.chinese?.summaryZh || null) !== listed.summary || (item.chinese?.titleZh || item.title) !== listed.title) throw new Error('Snapshot evidence content mismatch')
  }
  return pack
}
