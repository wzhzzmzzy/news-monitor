import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { feedConfigSchema, type FeedConfig } from './config.js'
import { FeedStore, writeJson } from './store.js'
import type { FeedItem } from './collect.js'
import { editionRange, queryNews, loadSnapshotEvidence, shanghaiDay } from './news.js'
import { renderAgentReport, validateAgentReport } from './agent-report.js'
import { runFeed } from './pipeline.js'
import { localizeItems } from './localize.js'

let dir: string, config: FeedConfig
const morning = editionRange('morning', '2026-09-21')
const evening = editionRange('evening', '2026-09-21')
async function observe(time: string, values: Array<[string, string]>) {
  const raw: FeedItem[] = values.map(([id, content]) => ({ id, content, title: `标题${id}`, sourceId: 'rss', sourceName: 'RSS', category: '技术', url: `https://example.com/${id}`, fetchedAt: time, publishedAt: time, contentKind: 'feed-content', raw: {} }))
  const items = await new FeedStore(dir).merge(raw)
  await writeJson(path.join(dir, 'runs', time.replace(/[:.]/g, '-'), 'source-pack.json'), { version: 1, collectedAt: time, items, results: [{ sourceId: 'rss', sourceName: 'RSS', status: 'ok', count: items.length, coverage: 'feed-snapshot', note: '' }] })
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-tool-test-'))
  config = feedConfigSchema.parse({ archiveDir: dir, sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/rss' }], localization: { enabled: false }, curation: { enabled: true } })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T00:00:00Z'))
})
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await fs.rm(dir, { recursive: true, force: true }) })
it('anchors morning and evening in Shanghai independently of machine timezone', () => {
  expect(morning).toEqual({ start: new Date('2026-09-20T02:00:00Z'), end: new Date('2026-09-21T02:00:00Z') })
  expect(evening).toEqual({ start: morning.end, end: new Date('2026-09-21T12:00:00Z') })
  expect(shanghaiDay(new Date('2026-09-20T18:00:00Z'))).toBe('2026-09-21')
  expect(() => editionRange('morning', '2026-02-30')).toThrow()
  expect(() => editionRange('invalid', '2026-09-21')).toThrow()
})
it('compares raw revisions against a frozen baseline, never the mutable latest item', async () => {
  await observe('2026-09-19T12:00:00.000Z', [['old', '旧文章']])
  await observe('2026-09-21T01:00:00.000Z', [['a', '初稿'], ['b', '不变'], ['gone', '未再出现']])
  const before = await queryNews(config, { ...morning, edition: 'morning' })
  const bytes = await fs.readFile(before.snapshotPath, 'utf8')
  await observe('2026-09-21T02:00:00.000Z', [['a', '修订'], ['b', '不变'], ['c', '新文章'], ['old', '旧文章']])
  await observe('2026-09-21T12:00:00.000Z', [['outside', '边界外']])
  await observe('2026-09-21T13:00:00.000Z', [['a', '未来修订']])
  const result = await queryNews(config, { ...evening, edition: 'evening', baseline: before.snapshotPath })
  expect(Object.fromEntries(result.items.map(i => [i.id, i.change]))).toEqual({ a: 'updated', b: 'unchanged', c: 'new', old: 'resurfaced' })
  expect(result.baseline?.items.map(i => i.id)).toEqual(['a', 'b', 'gone'])
  expect(result.counts).toMatchObject({ total: 4, new: 1, updated: 1, unchanged: 1, resurfaced: 1 })
  expect((await loadSnapshotEvidence(result, result.snapshotPath)).items.find(i => i.id === 'a')?.content).toBe('修订')
  expect(await fs.readFile(before.snapshotPath, 'utf8')).toBe(bytes)
  const rerun = await queryNews(config, { ...morning, edition: 'morning' })
  expect(rerun.items).toEqual(before.items)
  expect(rerun.snapshotId).not.toBe(before.snapshotId)
})
it('reports empty and missing coverage without inventing a complete morning baseline', async () => {
  const before = await queryNews(config, { ...morning, edition: 'morning' })
  expect(before.status).toBe('empty')
  expect(before.coverage).toMatchObject({ complete: false, missingSources: ['rss'], observations: [] })
  await observe('2026-09-21T04:00:00.000Z', [['a', '下午首次观察']])
  const result = await queryNews(config, { ...evening, edition: 'evening', baseline: before.snapshotPath })
  expect(result.baseline?.status).toBe('empty')
  expect(result.items[0].change).toBe('new')
  expect(result.items[0].summary).toBeNull()
  expect(result.status).toBe('partial')
})
it('refuses missing/wrong baselines, malformed windows and future cutoffs', async () => {
  await expect(queryNews(config, { ...evening, edition: 'evening' })).rejects.toThrow('baseline')
  const baseline = await queryNews(config, { ...morning, edition: 'morning' })
  await expect(queryNews(config, { start: new Date(+evening.start + 1), end: evening.end, baseline: baseline.snapshotPath })).rejects.toThrow('gaps and overlaps')
  await expect(queryNews(config, { ...editionRange('evening', '2026-09-23'), edition: 'evening', baseline: baseline.snapshotPath })).rejects.toThrow('not ended')
  await expect(queryNews(config, { ...evening, edition: 'morning' })).rejects.toThrow('cutoff')
})
it('collects news and blogs once per edition and includes the batch after the nominal cutoff', async () => {
  config.sources.push({ ...config.sources[0], type: 'rss', id: 'blog', name: 'Blog', channel: 'blogs', url: 'https://blog.example/feed' })
  config.sources.push({ ...config.sources[0], id: 'broken' })
  let completion = '2026-09-22T02:05:00.000Z'
  const collect = vi.fn(async (cfg: FeedConfig) => runFeed(cfg, {}, async source => {
    if (source.id === 'broken') throw new Error('Source offline')
    return [{ id: source.id, sourceId: source.id, sourceName: source.name, category: '技术', title: source.name,
      content: completion, contentKind: 'feed-content' as const, url: `https://${source.id}.example/article`, fetchedAt: new Date().toISOString(), publishedAt: new Date(Date.now() - 60000).toISOString(), raw: {} }]
  }, async (items, cfg) => {
    vi.setSystemTime(new Date(completion))
    return localizeItems(items, cfg)
  }))
  const localize = vi.fn(localizeItems)
  vi.setSystemTime(new Date('2026-09-22T02:00:00Z'))
  const before = await queryNews(config, { ...editionRange('morning', '2026-09-22'), edition: 'morning', refresh: true }, localize, collect)
  expect(collect).toHaveBeenCalledTimes(1)
  expect(before.window).toMatchObject({ start: '2026-09-21T02:00:00.000Z', end: '2026-09-22T02:00:00.000Z' })
  expect(before.items.map(item => item.id)).toEqual(['rss'])
  expect(before.blogs.map(item => item.id)).toEqual(['blog'])
  expect(before.coverage.failedSources).toEqual(['broken'])
  expect(before.status).toBe('partial')
  expect(localize.mock.calls[0][1].localization.blogBatchSize).toBe(0)
  expect(config.localization.blogBatchSize).toBe(20)
  const bytes = await fs.readFile(before.snapshotPath, 'utf8')
  completion = '2026-09-22T12:03:00.000Z'
  vi.setSystemTime(new Date('2026-09-22T12:00:00Z'))
  const after = await queryNews(config, { ...editionRange('evening', '2026-09-22'), edition: 'evening', baseline: before.snapshotPath, refresh: true }, localize, collect)
  expect(collect).toHaveBeenCalledTimes(2)
  expect(after.window).toMatchObject({ start: before.window.end, end: '2026-09-22T12:00:00.000Z' })
  expect(after.items[0].change).toBe('updated')
  expect(after.blogs[0].change).toBe('updated')
  expect(after.baseline?.snapshotId).toBe(before.snapshotId)
  expect(await fs.readFile(before.snapshotPath, 'utf8')).toBe(bytes)
  await loadSnapshotEvidence(after, after.snapshotPath)
})
it('validates refresh dates and baselines before collecting', async () => {
  const collect = vi.fn(runFeed)
  const before = await queryNews(config, { ...morning, edition: 'morning' })
  vi.setSystemTime(new Date('2026-09-22T12:00:00Z'))
  await expect(queryNews(config, { ...morning, refresh: true }, localizeItems, collect)).rejects.toThrow('--edition')
  await expect(queryNews(config, { ...morning, edition: 'morning', refresh: true }, localizeItems, collect)).rejects.toThrow('today')
  await expect(queryNews(config, { ...editionRange('morning', '2026-09-23'), edition: 'morning', refresh: true }, localizeItems, collect)).rejects.toThrow('not ended')
  await expect(queryNews(config, { ...editionRange('evening', '2026-09-22'), edition: 'evening', refresh: true }, localizeItems, collect)).rejects.toThrow('baseline')
  await expect(queryNews(config, { ...editionRange('evening', '2026-09-22'), edition: 'evening', refresh: true, baseline: before.snapshotPath }, localizeItems, collect)).rejects.toThrow('earlier today')
  expect(collect).not.toHaveBeenCalled()
})
it('renders only external decisions, validates citations and retains every unselected item', async () => {
  await observe('2026-09-21T01:00:00.000Z', [['a', '初稿']])
  const baseline = await queryNews(config, { ...morning, edition: 'morning' })
  await observe('2026-09-21T04:00:00.000Z', [['a', '修订'], ['b', '新文章']])
  const snapshot = await queryNews(config, { ...evening, edition: 'evening', baseline: baseline.snapshotPath })
  const report = { version: 'agent-report-v1', snapshotId: snapshot.snapshotId, title: '变化 <script>bad</script>', summary: '由外部编辑比较前后证据。', picks: [{ id: 'a', topic: 'AI', reason: '出现明确新进展。' }], readingIds: [], sections: [{ title: '变化', kind: 'update', body: '<img onerror=bad>前后事实', beforeIds: ['a'], evidenceIds: ['a'] }] }
  expect(() => validateAgentReport({ ...report, snapshotId: baseline.snapshotId }, snapshot)).toThrow('another snapshot')
  expect(() => validateAgentReport({ ...report, readingIds: ['a'] }, snapshot)).toThrow('overlapping')
  expect(() => validateAgentReport({ ...report, sections: [{ ...report.sections[0], evidenceIds: ['fake'] }] }, snapshot)).toThrow('Unknown')
  expect(() => validateAgentReport({ ...report, sections: [{ ...report.sections[0], beforeIds: [] }] }, snapshot)).toThrow('baseline evidence')
  const decisions = path.join(dir, 'agent.json'), htmlFile = path.join(dir, 'result.html')
  await writeJson(decisions, report)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Rendering must not use network')))
  await renderAgentReport(snapshot.snapshotPath, decisions, htmlFile)
  const html = await fs.readFile(htmlFile, 'utf8')
  const { document } = parseHTML(html)
  expect(document.querySelectorAll('[data-entry]')).toHaveLength(3)
  expect(document.querySelectorAll('#panel-timeline article[data-entry]')).toHaveLength(2)
  expect(document.querySelector('#panel-other')).toBeNull()
  expect(document.querySelectorAll('script')).toHaveLength(1)
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(html).toContain('早前：RSS')
  expect(fetch).not.toHaveBeenCalled()
  await expect(renderAgentReport(snapshot.snapshotPath, decisions, htmlFile)).rejects.toThrow('EEXIST')
  await fs.appendFile(path.join(path.dirname(snapshot.snapshotPath), 'reading-pack.json'), ' ')
  await expect(renderAgentReport(snapshot.snapshotPath, decisions, path.join(dir, 'bad.html'))).rejects.toThrow('hash mismatch')
})
it('collection ignores legacy curation enabled and performs only the injected Chinese processing', async () => {
  const localize = vi.fn(async (items: any[]) => ({ items, stats: { enabled: false, total: items.length, ready: 0, cached: 0, generated: 0, pending: 0, failed: 0 } }))
  const result = await runFeed(config, {}, async () => [], localize)
  expect(localize).toHaveBeenCalledOnce()
  expect(result.curation.status).toBe('disabled')
  await expect(fs.access(path.join(dir, 'editorial'))).rejects.toThrow()
})
