import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { loadFeedConfig, parseFeedConfig } from './config.js'
import { belongsToBlog } from './blogs.js'
import { parseFeed, type FeedItem } from './collect.js'
import { FeedStore, writeJson } from './store.js'
import { readEvidenceWindow } from './runtime.js'
import { queryNews, loadNews, loadSnapshotEvidence } from './news.js'
import { renderAgentReport, validateAgentReport } from './agent-report.js'
import { runFeed } from './pipeline.js'
import { curateItems } from './curate.js'
import { localizeItems } from './localize.js'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blogs-test-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }) })
const source = { id: 'blog', name: 'Blog', type: 'rss' as const, url: 'https://blog.example/feed', siteUrl: 'https://blog.example/', channel: 'blogs' as const, category: '技术', limit: 1, enabled: true }
const config = (directory: string) => parseFeedConfig({ archiveDir: directory, sources: [source], localization: { enabled: false } })
const raw = (id: string, time: string, content = '原文'): FeedItem => ({ id, sourceId: 'blog', sourceName: 'Blog', category: '技术', title: id, url: `https://blog.example/${id}`, contentKind: 'feed-content', fetchedAt: time, publishedAt: time, content, raw: {}, channel: 'blogs' })

it('loads a relative catalog, merges an existing publisher, preserves unresolved sources and deduplicates aliases', async () => {
  await writeJson(path.join(dir, 'catalog.json'), { version: 1, rankingUrl: 'https://ranking.example/', start: '2016-09-15', end: '2026-09-15', limit: 3, entries: [
    { rank: 1, domain: 'blog.example', author: 'Author', siteUrl: 'https://blog.example/', feedUrl: 'https://blog.example/all.xml', status: 'available', note: '' },
    { rank: 2, domain: 'old.example', author: 'Author', siteUrl: 'https://old.example/', feedUrl: 'https://blog.example/all.xml', status: 'available', note: '', aliasOf: 'blog.example' },
    { rank: 3, domain: 'missing.example', author: '', siteUrl: 'https://missing.example/', feedUrl: null, status: 'unresolved', note: 'RSS unavailable' },
  ] })
  const file = path.join(dir, 'config.json')
  await writeJson(file, { sources: [{ ...source, channel: 'news' }], blogCatalog: './catalog.json' })
  const loaded = await loadFeedConfig(file)
  expect(loaded.sources).toHaveLength(2)
  expect(loaded.sources[0]).toMatchObject({ id: 'blog', channel: 'blogs', url: 'https://blog.example/all.xml' })
  expect(loaded.sources[1]).toMatchObject({ enabled: false, disabledReason: 'RSS unavailable' })
  expect(belongsToBlog('https://blog.example/story', loaded.sources)).toBe(true)
  expect(belongsToBlog('https://old.example/story', loaded.sources)).toBe(true)
  expect(belongsToBlog('https://notblog.example/story', loaded.sources)).toBe(false)
})

it('continues Chinese processing from durable blog backlog without truncating articles or blocking news', async () => {
  const cfg = config(dir)
  cfg.localization = { ...cfg.localization, enabled: true, blogBatchSize: 1 }
  const runner = vi.fn(async () => ({ titleLanguage: 'zh', contentLanguage: 'zh', titleZh: '文章', contentZh: '', summaryZh: '中文摘要。' }))
  const store = new FeedStore(dir)
  const stored = await store.merge([
    { ...raw('old', '2026-09-20T01:00:00.000Z'), title: '旧文章' },
    { ...raw('latest', '2026-09-21T01:00:00.000Z'), title: '新文章' },
    { ...raw('news', '2026-09-21T01:00:00.000Z'), title: '新闻', channel: 'news' },
  ])
  const first = await localizeItems(stored, cfg, runner)
  expect(first.stats).toMatchObject({ ready: 2, pending: 1 })
  expect(first.items.find(i => i.id === 'latest')?.chinese?.contentZh).toBe('原文')
  expect(first.items.find(i => i.id === 'old')?.chineseStatus).toBe('pending')
  // A later empty feed still drains archived pending work; cached items spend no batch budget.
  const result = await runFeed(cfg, {}, async () => [], (items, config) => localizeItems(items, config, runner))
  expect(result.localization).toMatchObject({ ready: 2, cached: 1, generated: 1, pending: 0 })
  expect(await store.readBlogs()).toHaveLength(2)
})

it('retains all blog feed entries beyond the regular source limit', async () => {
  const xml = '<rss version="2.0"><channel><title>Blog</title>' + Array.from({ length: 120 }, (_, i) => `<item><title>${i}</title><link>https://blog.example/${i}</link></item>`).join('') + '</channel></rss>'
  expect(await parseFeed(xml, source, new Date().toISOString())).toHaveLength(120)
  expect(await parseFeed(xml, { ...source, channel: 'news' }, new Date().toISOString())).toHaveLength(1)
})

it('keeps new and changed blogs once per window, without treating subsequent polls as updates', async () => {
  const store = new FeedStore(dir)
  async function batch(time: string, content: string, channel: 'news' | 'blogs' = 'blogs') {
    const items = await store.merge([{ ...raw('post', time, content), channel }])
    await writeJson(path.join(dir, 'runs', time.replace(/[:.]/g, '-'), 'source-pack.json'), { version: 1, collectedAt: time, items, results: [] })
    return items[0]
  }
  await batch('2026-09-21T01:00:00.000Z', 'first')
  expect((await batch('2026-09-21T02:00:00.000Z', 'first', 'news')).channel).toBe('blogs')
  expect((await readEvidenceWindow(dir, new Date('2026-09-21T01:30:00Z'), new Date('2026-09-21T02:30:00Z'))).items).toHaveLength(0)
  await batch('2026-09-21T03:00:00.000Z', 'updated')
  await batch('2026-09-21T04:00:00.000Z', 'updated')
  const window = await readEvidenceWindow(dir, new Date('2026-09-21T00:00:00Z'), new Date('2026-09-21T05:00:00Z'))
  expect(window.items).toHaveLength(1)
  expect(window.items[0]).toMatchObject({ content: 'updated', change: 'updated' })
})

it('separates blog snapshots from Agent decisions and renders every blog in an independent group including email', async () => {
  const time = '2026-09-21T01:00:00.000Z'
  const items = await new FeedStore(dir).merge([raw('blog-post', time), { ...raw('news-post', time), url: 'https://news.example/post', channel: 'news' }])
  await writeJson(path.join(dir, 'runs', '2026-09-21-first', 'source-pack.json'), { version: 1, collectedAt: time, items, results: [] })
  const snapshot = await queryNews(config(dir), { start: new Date('2026-09-21T00:00:00Z'), end: new Date('2026-09-21T12:00:00Z') })
  expect(snapshot.items.map(i => i.id)).toEqual(['news-post'])
  expect(snapshot.blogs.map(i => i.id)).toEqual(['blog-post'])
  expect(snapshot.counts).toMatchObject({ total: 2, news: 1, blogs: 1 })
  const report = { version: 'agent-report-v1', snapshotId: snapshot.snapshotId, title: '阅读', summary: '', picks: [], readingIds: [], sections: [] }
  expect(() => validateAgentReport({ ...report, picks: [{ id: 'blog-post', reason: 'Not eligible', topic: '技术' }] }, snapshot)).toThrow('selection')
  expect(() => validateAgentReport({ ...report, readingIds: ['blog-post'] }, snapshot)).toThrow('selection')
  await writeJson(path.join(dir, 'decision.json'), report)
  for (const email of [false, true]) {
    const output = path.join(dir, email ? 'email.html' : 'web.html')
    await renderAgentReport(snapshot.snapshotPath, path.join(dir, 'decision.json'), output, email)
    const { document } = parseHTML(await fs.readFile(output, 'utf8'))
    expect(document.querySelectorAll('[data-panel]')).toHaveLength(3)
    expect(document.querySelectorAll('#panel-blogs [data-entry]')).toHaveLength(1)
    expect(document.querySelectorAll('#panel-timeline [data-entry]')).toHaveLength(1)
    expect(document.querySelector('#panel-blogs .why')).toBeNull()
    if (email) expect(document.querySelector('#panel-blogs h2')?.textContent).toBe('博客')
  }
  const moved = { ...snapshot, items: [...snapshot.items, ...snapshot.blogs], blogs: [] }
  await expect(loadSnapshotEvidence(moved, snapshot.snapshotPath)).rejects.toThrow('channel mismatch')
  const old = { ...snapshot, items: [], blogs: undefined, publicationFilter: undefined }
  await writeJson(path.join(dir, 'legacy.json'), old)
  expect((await loadNews(path.join(dir, 'legacy.json'))).blogs).toEqual([])
})

it('collects only the requested channel and never sends blogs to legacy editorial models', async () => {
  const cfg = config(dir)
  cfg.sources.push({ ...source, id: 'news', channel: 'news', siteUrl: undefined, url: 'https://news.example/feed' })
  const collect = vi.fn(async () => [raw('post', new Date().toISOString())])
  const result = await runFeed(cfg, { channel: 'blogs' }, collect)
  expect(collect).toHaveBeenCalledOnce()
  expect(result.results).toHaveLength(1)
  cfg.curation.enabled = true; cfg.localization.enabled = true
  const rank = vi.fn()
  const stored = await new FeedStore(dir).merge([raw('another', new Date().toISOString())])
  const curation = await curateItems(stored, cfg, rank)
  expect(curation.total).toBe(0)
  expect(rank).not.toHaveBeenCalled()
})
