import type { RawNewsItem, NewsIndexItem, Config } from '../types/index.js'
import type { StorageService } from '../services/storage.js'
import type { CrawlerService } from '../services/crawler.js'
import type { AnalyzerService } from '../services/analyzer.js'
import type { Reporter } from './reporter.js'
import logger from '../utils/logger.js'
import { differenceInMinutes } from 'date-fns'

interface MonitorState {
  lastHotlistRun: string | null
  lastStreamRun: string | null
}

export class Monitor {
  private storage: StorageService

  constructor(storage: StorageService) {
    this.storage = storage
  }

  async run(
    config: Config,
    services: { crawler: CrawlerService; analyzer: AnalyzerService; reporter: Reporter }
  ): Promise<void> {
    const { crawler, analyzer, reporter } = services
    const stateFile = 'status.json'
    const state = (await this.storage.loadJson<MonitorState>(stateFile)) || {
      lastHotlistRun: null,
      lastStreamRun: null
    }

    const now = new Date()

    // 1. Stream Analysis (Run every time, e.g. 30m via cron)
    if (config.enable_stream_analysis && config.stream_sources.length > 0) {
      try {
        logger.info('Fetching stream sources...')
        const streamItems = await crawler.fetchStreams(config.stream_sources)
        if (streamItems.length > 0) {
          for (const item of streamItems) {
            await this.storage.appendStreamItem(item)
          }
          logger.info(`Appended ${streamItems.length} stream items.`)
        }
        state.lastStreamRun = now.toISOString()
      } catch (err) {
        logger.error(err as any, 'Stream fetch failed:')
      }
    }

    // 2. Hotlist Analysis (Run if > 2h or first time)
    const lastRun = state.lastHotlistRun ? new Date(state.lastHotlistRun) : null
    const minutesSinceLast = lastRun ? differenceInMinutes(now, lastRun) : 999

    if (minutesSinceLast >= 120) {
      logger.info(`Running Hotlist Analysis (Last run: ${minutesSinceLast}m ago)...`)
      try {
        const rawItems = await crawler.fetchHotlists(config.hotlist_sources)
        if (rawItems.length > 0) {
          const processedItems = await this.processItems(rawItems)
          await reporter.runHourlyAnalysis(processedItems)
        } else {
          logger.warn('No hotlist items fetched.')
        }
        state.lastHotlistRun = now.toISOString()
      } catch (err) {
        logger.error(err as any, 'Hotlist analysis failed:')
      }
    } else {
      logger.info(`Skipping Hotlist Analysis (Last run: ${minutesSinceLast}m ago).`)
    }

    await this.storage.saveJson(stateFile, state)
  }

  async processItems(items: RawNewsItem[]): Promise<NewsIndexItem[]> {
    const filename = 'index.json'
    const index = (await this.storage.loadJson<Record<string, NewsIndexItem>>(filename)) || {}
    
    // Create URL to ID map for lookup and find max existing ID
    const urlToIdMap = new Map<string, string>()
    let maxId = 0
    for (const [id, item] of Object.entries(index)) {
      urlToIdMap.set(item.url, id)
      const numericId = parseInt(id, 10)
      if (!isNaN(numericId)) {
        maxId = Math.max(maxId, numericId)
      }
    }

    const processedItems: NewsIndexItem[] = []

    for (const item of items) {
      let id = urlToIdMap.get(item.url)
      
      if (id && index[id]) {
        // Update existing item
        const existing = index[id]
        existing.lastSeen = item.fetchedAt
        existing.maxRank = Math.min(existing.maxRank, item.rank)
        existing.occurrences += 1
        if (item.source && !existing.sources.includes(item.source)) {
          existing.sources.push(item.source)
        }
        processedItems.push(existing)
      } else {
        // Create new item
        maxId++
        id = maxId.toString()
        urlToIdMap.set(item.url, id)
        
        index[id] = {
          id,
          title: item.title,
          url: item.url,
          sources: item.source ? [item.source] : [],
          firstSeen: item.fetchedAt,
          lastSeen: item.fetchedAt,
          maxRank: item.rank,
          occurrences: 1,
        }
        processedItems.push(index[id])
      }
    }

    await this.storage.saveJson(filename, index)
    logger.info(`Monitor processed ${items.length} items.`)
    return processedItems
  }
}
