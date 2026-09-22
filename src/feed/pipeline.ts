import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FeedConfig } from './config.js'
import { collectSource, type FeedItem, type SourceResult, type PublicationWindow } from './collect.js'
import { FeedStore, writeJson } from './store.js'
import { renderFeed } from './view.js'
import { localizeItems } from './localize.js'
import type { Curation } from './curate.js'
import { belongsToBlog, isBlog } from './blogs.js'

export async function runFeed(config: FeedConfig, options: { analyze?: boolean; channel?: 'news' | 'blogs'; publicationWindow?: PublicationWindow } = {}, collect = collectSource, localize = localizeItems) {
  if (options.analyze) throw new Error('Editorial analysis belongs to the calling agent; use news and render')
  const store = new FeedStore(config.archiveDir)
  return store.withLock(async () => {
    const now = new Date().toISOString()
    const runId = `${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const runDir = path.join(config.archiveDir, 'runs', runId)
    const items: FeedItem[] = []
    const results: SourceResult[] = []
    const sources = config.sources.filter(source => !options.channel || (source.channel || 'news') === options.channel)
    const batches: Array<{ items: FeedItem[]; result: SourceResult }> = new Array(sources.length)
    const collectOne = async (source: typeof sources[number], index: number) => {
      if (!source.enabled) {
        batches[index] = { items: [], result: { sourceId: source.id, sourceName: source.name, status: 'disabled', count: 0, coverage: 'unknown', note: source.disabledReason || '配置中已停用此来源' } }
        return
      }
      const isFeed = source.type === 'rss' || source.type === 'rsshub'
      try {
        const collected = (await collect(source, config, now, undefined, options.publicationWindow)).map(item => ({ ...item, fetchedAt: new Date().toISOString(),
          channel: isBlog(source) || belongsToBlog(item.url, config.sources) ? 'blogs' as const : item.channel,
        }))
        const windowStartReached = !isFeed && options.publicationWindow
          ? collected.some(item => item.publishedAt && Date.parse(item.publishedAt) < +options.publicationWindow!.start) : undefined
        batches[index] = { items: collected, result: { sourceId: source.id, sourceName: source.name, status: 'ok', count: collected.length,
          coverage: isFeed ? 'feed-snapshot' : 'unknown',
          ...(windowStartReached !== undefined ? { windowStartReached } : {}),
          note: isFeed ? 'RSS 当前快照，正文完整性未核验' : windowStartReached === false ? 'X 未确认回溯到窗口起点；可能达到采集上限、上游截断或分页失败，已保留成功取得的条目' : 'X 有限条目快照；上游可能返回部分分页，时间覆盖未知',
        } }
      } catch {
        batches[index] = { items: [], result: { sourceId: source.id, sourceName: source.name, status: 'failed', count: 0, coverage: 'unknown',
          note: isFeed ? '无法读取或解析 RSS，检查源地址与网络；RSSHub 源同时检查实例与上游状态' : 'OpenCLI 采集失败；检查 Brave、X 登录和 opencli doctor',
        } }
      }
    }
    const feeds = sources.map((source, index) => ({ source, index })).filter(({ source }) => source.type === 'rss' || source.type === 'rsshub')
    let next = 0
    await Promise.all(Array.from({ length: config.collection.rssConcurrency }, async () => {
      while (next < feeds.length) { const { source, index } = feeds[next++]; await collectOne(source, index) }
    }))
    // Browser-backed adapters remain serial so they cannot fight over tab leases.
    for (const [index, source] of sources.entries()) if (source.type === 'x-user' || source.type === 'x-list') await collectOne(source, index)
    for (const batch of batches) { items.push(...batch.items); results.push(batch.result) }
    // Raw payloads remain replayable even if indexing or the model fails later.
    await writeJson(path.join(runDir, 'raw.json'), items)
    const stored = await store.merge(items)
    const collectedAt = new Date().toISOString()
    await writeJson(path.join(runDir, 'source-pack.json'), { version: 1, collectedAt, results, items: stored })
    let html = renderFeed(stored, results, now)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false })
    const backlog = options.channel === 'news' ? [] : await store.readBlogs()
    const candidates = [...new Map([...backlog, ...stored].map(item => [item.id, item])).values()]
    const reading = await localize(options.publicationWindow ? candidates.filter(item =>
      (item.publishedAt && Date.parse(item.publishedAt) >= +options.publicationWindow!.start && Date.parse(item.publishedAt) < +options.publicationWindow!.end)) : candidates, config)
    await writeJson(path.join(runDir, 'reading-pack.json'), reading)
    const newsCount = reading.items.filter(item => !isBlog(item)).length
    const curation: Curation = { status: 'disabled', entries: {}, total: newsCount, selected: 0, reading: newsCount, other: 0, cached: 0, note: '由调用方 Agent 筛选新闻；博客独立展示' }
    await writeJson(path.join(runDir, 'editorial.json'), curation)
    html = renderFeed(reading.items, results, now, undefined, reading.stats, curation)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false, localization: reading.stats, curation })
    return { runDir, collectedAt, preview: path.join(runDir, 'preview.html'), count: stored.length, results, localization: reading.stats, curation,
      changes: { new: stored.filter(i => i.change === 'new').length, updated: stored.filter(i => i.change === 'updated').length, seen: stored.filter(i => i.change === 'seen').length },
    }
  })
}
