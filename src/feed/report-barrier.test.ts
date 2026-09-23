import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseFeedConfig, type FeedConfig } from './config.js'
import { queryNews, loadSnapshotEvidence, editionRange } from './news.js'
import { localizeItems, type ReadingRunner } from './localize.js'
import { FeedStore, writeJson } from './store.js'
import { runFeed } from './pipeline.js'
import { validateAgentReport } from './agent-report.js'

let dir: string, config: FeedConfig
const time = '2026-09-21T01:00:00.000Z'
const range = editionRange('morning', '2026-09-21')
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-barrier-'))
  config = parseFeedConfig({ archiveDir: dir, localization: { blogBatchSize: 0, concurrency: 2 }, llm: { model: 'fake', validationRetries: 0 }, sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' }] })
})
afterEach(async () => { vi.useRealTimers(); await fs.rm(dir, { recursive: true, force: true }) })
function article(id: string, blog = false) {
  return { id, sourceId: 'rss', sourceName: 'RSS', title: id, content: id, category: '技术', url: `https://example.com/${id}`, publishedAt: time, fetchedAt: time, contentKind: 'feed-content' as const, raw: {}, ...(blog ? { channel: 'blogs' as const } : {}) }
}
async function seed(count: number, blog: boolean) {
  const items = await new FeedStore(dir).merge(Array.from({ length: count }, (_, i) => article(`item-${i}`, blog)))
  await writeJson(path.join(dir, 'runs', 'initial', 'source-pack.json'), { version: 1, collectedAt: time, items, results: [] })
}
const decision = (snapshotId: string) => ({ version: 'agent-report-v1', snapshotId, title: '早报', summary: '', picks: [], readingIds: [], sections: [] })

it('waits for every eligible blog beyond the collection budget, including the last slow and failed requests', async () => {
  await seed(23, true)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  const runner = vi.fn<ReadingRunner>(async request => {
    if (request.payload.title === 'item-22') { started(); await gate }
    if (request.payload.title === 'item-1') throw new Error('Model failed')
    return { titleZh: '中文标题', summaryZh: '新闻摘要。' }
  })
  let returned = false
  const job = queryNews(config, range, (items, cfg) => localizeItems(items, cfg, runner)).then(value => { returned = true; return value })
  await entered
  try {
    expect(returned).toBe(false)
    await expect(fs.access(path.join(dir, 'snapshots'))).rejects.toThrow()
  } finally { release() }
  const snapshot = await job
  expect(snapshot.blogs).toHaveLength(23)
  expect(snapshot.blogs.filter(item => item.languageStatus === 'ready')).toHaveLength(22)
  expect(snapshot.blogs.filter(item => item.languageStatus === 'failed')).toHaveLength(1)
  expect(runner).toHaveBeenCalledTimes(23)
  expect((await loadSnapshotEvidence(snapshot, snapshot.snapshotPath)).stats).toMatchObject({ pending: 0, ready: 22, failed: 1 })
  expect(config.localization.blogBatchSize).toBe(0)
  expect(() => validateAgentReport(decision(snapshot.snapshotId), snapshot)).not.toThrow()
})

it('refresh defers model work until the final window so failures are attempted only once per report', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T02:05:00Z'))
  const collectionLocalize = vi.fn(localizeItems)
  const runner = vi.fn<ReadingRunner>().mockRejectedValue(new Error('Model failed'))
  const collect = (cfg: FeedConfig, options: Parameters<typeof runFeed>[1]) => runFeed(cfg, options, async () => [article('only')], collectionLocalize)
  const snapshot = await queryNews(config, { ...range, edition: 'morning', refresh: true }, (items, cfg) => localizeItems(items, cfg, runner), collect)
  expect(collectionLocalize).not.toHaveBeenCalled()
  expect(runner).toHaveBeenCalledTimes(1)
  expect(snapshot.items[0].languageStatus).toBe('failed')
})

it('records unavailable configuration as an explicit terminal failure and refuses pending or disabled snapshots', async () => {
  await seed(1, false)
  config.localization.enabled = false
  const snapshot = await queryNews(config, range)
  expect(snapshot.items[0]).toMatchObject({ languageStatus: 'failed', summary: null })
  expect((await loadSnapshotEvidence(snapshot, snapshot.snapshotPath)).items[0].chineseError).toContain('中文处理已关闭')
  for (const languageStatus of ['pending', 'disabled'] as const) {
    expect(() => validateAgentReport(decision(snapshot.snapshotId), { ...snapshot, items: [{ ...snapshot.items[0], languageStatus }] })).toThrow('not settled')
    expect(() => validateAgentReport(decision(snapshot.snapshotId), { ...snapshot, blogs: [{ ...snapshot.items[0], id: 'blog', languageStatus }] })).toThrow('not settled')
  }
})

it('exports the 10–20 range and all four criteria and accepts a model-selected 15 items', async () => {
  await seed(21, false)
  const snapshot = await queryNews(config, range, (items, cfg) => localizeItems(items, cfg, async () => ({ titleZh: '中文标题', summaryZh: '新闻摘要。' })))
  expect(snapshot.preferences).toMatchObject({ minPicks: 10, maxPicks: 20, selectionCriteria: config.curation.selectionCriteria })
  expect(snapshot.preferences.selectionCriteria).toHaveLength(4)
  const picks = snapshot.items.map(item => ({ id: item.id, reason: '某领域重大进展，具体事实见原文。', topic: '技术' }))
  expect(validateAgentReport({ ...decision(snapshot.snapshotId), picks: picks.slice(0, 15) }, snapshot).picks).toHaveLength(15)
  expect(() => validateAgentReport({ ...decision(snapshot.snapshotId), picks }, snapshot)).toThrow()
})
