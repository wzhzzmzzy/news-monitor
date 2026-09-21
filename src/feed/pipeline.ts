import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FeedConfig } from './config.js'
import { collectSource, type FeedItem, type SourceResult } from './collect.js'
import { FeedStore, writeJson } from './store.js'
import { renderFeed } from './view.js'
import { localizeItems } from './localize.js'
import type { Curation } from './curate.js'

export async function runFeed(config: FeedConfig, options: { analyze?: boolean } = {}, collect = collectSource, localize = localizeItems) {
  if (options.analyze) throw new Error('Editorial analysis belongs to the calling agent; use news and render')
  const store = new FeedStore(config.archiveDir)
  return store.withLock(async () => {
    const now = new Date().toISOString()
    const runId = `${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const runDir = path.join(config.archiveDir, 'runs', runId)
    const items: FeedItem[] = []
    const results: SourceResult[] = []
    // Browser-backed adapters run serially to avoid fighting over tab leases / rate limits.
    for (const source of config.sources) {
      if (!source.enabled) {
        results.push({ sourceId: source.id, sourceName: source.name, status: 'disabled', count: 0, coverage: 'unknown', note: source.disabledReason || '配置中已停用此来源' })
        continue
      }
      const isFeed = source.type === 'rss' || source.type === 'rsshub'
      try {
        const collected = (await collect(source, config, now)).map(item => ({ ...item, fetchedAt: new Date().toISOString() }))
        items.push(...collected)
        results.push({ sourceId: source.id, sourceName: source.name, status: 'ok', count: collected.length,
          coverage: isFeed ? 'feed-snapshot' : 'unknown',
          note: isFeed ? 'RSS 当前快照，正文完整性未核验' : 'X 有限条目快照；上游可能返回部分分页，时间覆盖未知',
        })
      } catch {
        results.push({ sourceId: source.id, sourceName: source.name, status: 'failed', count: 0, coverage: 'unknown',
          note: isFeed ? '无法读取或解析 RSS，检查源地址与网络；RSSHub 源同时检查实例与上游状态' : 'OpenCLI 采集失败；检查 Brave、X 登录和 opencli doctor',
        })
      }
    }
    // Raw payloads remain replayable even if indexing or the model fails later.
    await writeJson(path.join(runDir, 'raw.json'), items)
    const stored = await store.merge(items)
    await writeJson(path.join(runDir, 'source-pack.json'), { version: 1, collectedAt: new Date().toISOString(), results, items: stored })
    let html = renderFeed(stored, results, now)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false })
    const reading = await localize(stored, config)
    await writeJson(path.join(runDir, 'reading-pack.json'), reading)
    const curation: Curation = { status: 'disabled', entries: {}, total: reading.items.length, selected: 0, reading: reading.items.length, other: 0, cached: 0, note: '由调用方 Agent 筛选' }
    await writeJson(path.join(runDir, 'editorial.json'), curation)
    html = renderFeed(reading.items, results, now, undefined, reading.stats, curation)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false, localization: reading.stats, curation })
    return { runDir, preview: path.join(runDir, 'preview.html'), count: stored.length, results, localization: reading.stats, curation,
      changes: { new: stored.filter(i => i.change === 'new').length, updated: stored.filter(i => i.change === 'updated').length, seen: stored.filter(i => i.change === 'seen').length },
    }
  })
}
