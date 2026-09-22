import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { feedConfigSchema, type FeedConfig } from './config.js'
import { type FeedItem } from './collect.js'
import { FeedStore, writeJson } from './store.js'
import { editionRange, loadSnapshotEvidence, parseNews, queryNews } from './news.js'
import { localizeItems } from './localize.js'
import { runFeed } from './pipeline.js'

let dir: string, config: FeedConfig
const morning = editionRange('morning', '2026-09-21')
const evening = editionRange('evening', '2026-09-21')
const item = (id: string, publishedAt?: string, url = `https://news.example/${id}`): FeedItem => ({
  id, title: id, content: id, sourceId: 'rss', sourceName: 'RSS', category: '技术', url,
  publishedAt, fetchedAt: '2026-09-21T01:00:00.000Z', contentKind: 'feed-content', raw: {},
})
async function observe(time: string, raw: FeedItem[]) {
  const items = await new FeedStore(dir).merge(raw.map(i => ({ ...i, fetchedAt: time })))
  const file = path.join(dir, 'runs', time.replace(/[:.]/g, '-'), 'source-pack.json')
  await writeJson(file, { version: 1, collectedAt: time, items, results: [{ sourceId: 'rss', sourceName: 'RSS', status: 'ok', count: items.length, coverage: 'feed-snapshot', note: '' }] })
  return file
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-publication-window-'))
  config = feedConfigSchema.parse({ archiveDir: dir, localization: { enabled: false }, sources: [
    { id: 'rss', name: 'RSS', type: 'rss', url: 'https://news.example/feed' },
    { id: 'blog', name: 'Blog', type: 'rss', url: 'https://blog.example/feed', siteUrl: 'https://blog.example', channel: 'blogs', enabled: false },
  ] })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
})
afterEach(async () => { vi.useRealTimers(); await fs.rm(dir, { recursive: true, force: true }) })

it('excludes stale, undated and future news before snapshot translation while preserving raw evidence and blogs', async () => {
  const file = await observe('2026-09-21T01:00:00.000Z', [
    item('old', '2026-09-18T12:00:00Z'), item('missing'),
    item('at-start', morning.start.toISOString()), item('recent', '2026-09-21T08:30:00+08:00'),
    item('at-end', morning.end.toISOString()), item('old-blog', '2020-01-01T00:00:00Z', 'https://blog.example/post'),
  ])
  const original = await fs.readFile(file, 'utf8')
  const localize = vi.fn(localizeItems)
  const snapshot = await queryNews(config, { ...morning, edition: 'morning' }, localize)
  expect(snapshot.items.map(i => i.id)).toEqual(['at-start', 'recent'])
  expect(snapshot.blogs.map(i => i.id)).toEqual(['old-blog'])
  expect(localize.mock.calls[0][0].map(i => i.id).sort()).toEqual(['at-start', 'old-blog', 'recent'])
  expect(snapshot).toMatchObject({ publicationFilter: { basis: 'publishedAt', scope: 'news', missingDate: 'exclude', included: 2,
    excluded: { beforeStart: 1, atOrAfterEnd: 1, missingDate: 1, invalidDate: 0 } } })
  expect((await loadSnapshotEvidence(snapshot, snapshot.snapshotPath)).items).toHaveLength(3)
  expect(await fs.readFile(file, 'utf8')).toBe(original)
  expect(() => parseNews({ ...snapshot, items: snapshot.items.map(i => ({ ...i, publishedAt: morning.end.toISOString() })) })).toThrow('publication window')
  const legacy = { ...snapshot } as Record<string, unknown>
  delete legacy.publicationFilter
  expect(parseNews(legacy).snapshotId).toBe(snapshot.snapshotId)
})

it('keeps the morning baseline but excludes morning articles reobserved or edited in the evening', async () => {
  const morningItem = item('morning', '2026-09-21T01:00:00Z')
  await observe('2026-09-21T01:30:00.000Z', [morningItem])
  const before = await queryNews(config, { ...morning, edition: 'morning' })
  const bytes = await fs.readFile(before.snapshotPath, 'utf8')
  await observe('2026-09-21T11:30:00.000Z', [
    { ...morningItem, content: 'Updated text with the same original publication date' },
    item('at-start', evening.start.toISOString()), item('evening', '2026-09-21T11:00:00Z'), item('at-end', evening.end.toISOString()),
  ])
  const after = await queryNews(config, { ...evening, edition: 'evening', baseline: before.snapshotPath })
  expect(after.items.map(i => i.id)).toEqual(['at-start', 'evening'])
  expect(after.baseline?.items.map(i => i.id)).toEqual(['morning'])
  expect(await fs.readFile(before.snapshotPath, 'utf8')).toBe(bytes)
})

it('keeps the nominal publication cutoff after refreshed collection and translation', async () => {
  vi.setSystemTime(new Date('2026-09-22T02:00:00Z'))
  const collect = async (cfg: FeedConfig) => runFeed(cfg, {}, async () => {
    vi.setSystemTime(new Date('2026-09-22T02:01:00Z'))
    return [item('old', '2026-09-21T02:01:00Z'), item('fresh', '2026-09-22T02:00:30Z')]
  }, async (items, cfg) => {
    vi.setSystemTime(new Date('2026-09-22T02:05:00Z'))
    return localizeItems(items, cfg)
  })
  const snapshot = await queryNews(config, { ...editionRange('morning', '2026-09-22'), edition: 'morning', refresh: true }, localizeItems, collect)
  expect(snapshot.window).toMatchObject({ start: '2026-09-21T02:00:00.000Z', end: '2026-09-22T02:00:00.000Z' })
  expect(snapshot.items.map(i => i.id)).toEqual(['old'])
  expect(snapshot.observedThrough).toBe('2026-09-22T02:05:00.001Z')
})

it('filters invalid dates in custom windows and preserves source coverage when no news qualifies', async () => {
  await observe('2026-09-21T01:00:00.000Z', [item('invalid', 'not-a-date'), item('missing'), item('old', '2020-01-01T00:00:00Z')])
  const snapshot = await queryNews(config, morning)
  expect(snapshot.items).toEqual([])
  expect(snapshot.status).toBe('empty')
  expect(snapshot.coverage).toMatchObject({ observations: ['2026-09-21T01:00:00.000Z'], failedSources: [], missingSources: [] })
  expect(snapshot).toMatchObject({ publicationFilter: { included: 0, excluded: { beforeStart: 1, atOrAfterEnd: 0, missingDate: 1, invalidDate: 1 } } })
})
