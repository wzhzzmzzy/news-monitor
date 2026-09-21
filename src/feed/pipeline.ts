import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FeedConfig } from './config.js'
import { collectSource, type FeedItem, type SourceResult } from './collect.js'
import { FeedStore, writeJson } from './store.js'
import { analyzeFeed, renderFeed } from './report.js'
import { localizeItems } from './localize.js'
import { requireLlm } from './llm.js'
import { curateItems } from './curate.js'

export async function runFeed(config: FeedConfig, options: { analyze?: boolean } = {}, collect = collectSource, localize = localizeItems, curate = curateItems) {
  if (options.analyze) requireLlm(config.llm)
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
        const collected = await collect(source, config, now)
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
    await writeJson(path.join(runDir, 'source-pack.json'), { version: 1, collectedAt: now, results, items: stored })
    let html = renderFeed(stored, results, now)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false })
    const reading = await localize(stored, config)
    await writeJson(path.join(runDir, 'reading-pack.json'), reading)
    const curation = await curate(reading.items, config)
    await writeJson(path.join(runDir, 'editorial.json'), curation)
    html = renderFeed(reading.items, results, now, undefined, reading.stats, curation)
    await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
    await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: false, localization: reading.stats, curation })
    if (options.analyze) {
      const analysis = await analyzeFeed(stored, config.llm!)
      await writeJson(path.join(runDir, 'analysis.json'), analysis)
      html = renderFeed(reading.items, results, now, analysis.digest, reading.stats, curation)
      await fs.writeFile(path.join(runDir, 'preview.html'), html, { mode: 0o600 })
      await writeJson(path.join(config.archiveDir, 'latest.json'), { runId, runDir, results, count: stored.length, analyzed: true, localization: reading.stats, curation })
    }
    return { runDir, preview: path.join(runDir, 'preview.html'), count: stored.length, results, localization: reading.stats, curation,
      changes: { new: stored.filter(i => i.change === 'new').length, updated: stored.filter(i => i.change === 'updated').length, seen: stored.filter(i => i.change === 'seen').length },
    }
  })
}
