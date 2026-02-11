import { ofetch } from 'ofetch'
import { withRetry, type RetryOptions } from '../utils/retry.js'
import logger from '../utils/logger.js'
import type { RawNewsItem, SourceConfig, StreamItem } from '../types/index.js'

export interface CrawlerResponse {
  status: string
  id: string
  updatedTime: number
  items: Array<{ title: string; url: string; score?: number }>
}

export class CrawlerService {
  private baseUrl: string
  private retryOptions?: Partial<RetryOptions>

  constructor(baseUrl: string, retryOptions?: Partial<RetryOptions>) {
    this.baseUrl = baseUrl
    this.retryOptions = retryOptions
  }

  async fetchSource(source: SourceConfig): Promise<RawNewsItem[]> {
    return withRetry(async () => {
      let fetchUrl: string
      let query: Record<string, string> = {}

      if (!source.url) {
        // Fallback to legacy ID-based API if URL is not provided
        fetchUrl = `${this.baseUrl}/api/s`
        query = { id: source.id }
      } else if (source.url.startsWith('http')) {
        // Absolute URL
        fetchUrl = source.url
      } else {
        // Relative path
        fetchUrl = `${this.baseUrl}${source.url.startsWith('/') ? '' : '/'}${source.url}`
      }

      const response = await ofetch<CrawlerResponse>(fetchUrl, {
        query,
        headers: source.headers,
      })

      if (response.status !== 'success' && response.status !== 'cache') {
        throw new Error(`Failed to fetch source ${source.id}: ${response.status}`)
      }

      const fetchedAt = new Date().toISOString()
      
      return response.items.map((item, index) => ({
        title: item.title,
        url: item.url,
        source: source.id,
        rank: index + 1,
        score: item.score || 0,
        fetchedAt,
      }))
    }, this.retryOptions)
  }

  async fetchHotlists(sources: SourceConfig[]): Promise<RawNewsItem[]> {
    const allItems: RawNewsItem[] = []
    
    for (const source of sources) {
      try {
        logger.info(`Fetching source: ${source.id}`)
        const items = await this.fetchSource(source)
        allItems.push(...items)
      } catch (error) {
        logger.error(error as any, `Error fetching source ${source.id}:`)
        // Skip failure per FR-002
      }
    }

    return allItems
  }

  async fetchStreams(sources: SourceConfig[]): Promise<StreamItem[]> {
    const fetchedAt = new Date().toISOString()
    const rawItems = await this.fetchHotlists(sources)
    return rawItems.map(item => ({
      timestamp: item.fetchedAt || fetchedAt,
      source_id: item.source || 'unknown',
      content: item.title,
      url: item.url
    }))
  }
}
