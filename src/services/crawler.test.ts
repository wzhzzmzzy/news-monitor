import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CrawlerService, buildCrawlerHeaders, DEFAULT_BROWSER_USER_AGENT } from './crawler.js'
import { ofetch } from 'ofetch'
import type { SourceConfig } from '../types/index.js'

vi.mock('ofetch', () => ({
  ofetch: vi.fn(),
}))

describe('CrawlerService', () => {
  const baseUrl = 'http://test-api'
  let crawler: CrawlerService

  beforeEach(() => {
    crawler = new CrawlerService(baseUrl, { retries: 0 })
    vi.clearAllMocks()
  })

  it('should fetch and map items from a source with relative URL', async () => {
    const source: SourceConfig = { id: 'weibo', name: '微博', type: 'api', url: '/api/weibo' }
    const mockResponse = {
      status: 'success',
      id: 'weibo',
      items: [
        { title: 'Topic 1', url: 'url1', score: 100 },
        { title: 'Topic 2', url: 'url2' },
      ],
    }

    vi.mocked(ofetch).mockResolvedValue(mockResponse)

    const items = await crawler.fetchSource(source)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: 'Topic 1',
      url: 'url1',
      source: 'weibo',
      rank: 1,
      score: 100,
    })
    expect(vi.mocked(ofetch)).toHaveBeenCalledWith('http://test-api/api/weibo', expect.any(Object))
  })

  it('should send default crawler headers and allow source headers to override them', async () => {
    crawler = new CrawlerService(baseUrl, { retries: 0 }, {
      'User-Agent': DEFAULT_BROWSER_USER_AGENT,
      Accept: 'application/json',
    })
    const source: SourceConfig = {
      id: 'weibo',
      name: '微博',
      type: 'api',
      url: '/api/s?id=weibo',
      headers: {
        'User-Agent': 'Custom Source UA',
      },
    }

    vi.mocked(ofetch).mockResolvedValue({
      status: 'success',
      id: 'weibo',
      items: [{ title: 'Topic', url: 'url' }],
    })

    await crawler.fetchSource(source)

    expect(vi.mocked(ofetch)).toHaveBeenCalledWith('http://test-api/api/s?id=weibo', {
      query: {},
      headers: {
        'User-Agent': 'Custom Source UA',
        Accept: 'application/json',
      },
    })
  })

  it('should build crawler headers from config defaults, overrides, and disabled mode', () => {
    expect(buildCrawlerHeaders({
      crawlerBrowserUserAgentEnabled: true,
      crawlerUserAgent: DEFAULT_BROWSER_USER_AGENT,
    })).toEqual({
      'User-Agent': DEFAULT_BROWSER_USER_AGENT,
    })

    expect(buildCrawlerHeaders({
      crawlerBrowserUserAgentEnabled: true,
      crawlerUserAgent: 'Custom UA',
    })).toEqual({
      'User-Agent': 'Custom UA',
    })

    expect(buildCrawlerHeaders({
      crawlerBrowserUserAgentEnabled: false,
      crawlerUserAgent: 'Custom UA',
    })).toEqual({})
  })

  it('should handle source failure and continue in fetchHotlists', async () => {
    const sources: SourceConfig[] = [
      { id: 'weibo', name: '微博', type: 'api', url: '/weibo' },
      { id: 'zhihu', name: '知乎', type: 'api', url: '/zhihu' }
    ]

    vi.mocked(ofetch)
      .mockRejectedValueOnce(new Error('API Down'))
      .mockResolvedValueOnce({
        status: 'success',
        id: 'zhihu',
        items: [{ title: 'Zhihu Topic', url: 'url-z' }],
      })

    const allItems = await crawler.fetchHotlists(sources)

    expect(allItems).toHaveLength(1)
    expect(allItems[0].title).toBe('Zhihu Topic')
    expect(vi.mocked(ofetch)).toHaveBeenCalledTimes(2)
  })

  it('should throw error if status is not success or cache', async () => {
    const source: SourceConfig = { id: 'weibo', name: '微博', type: 'api', url: '/weibo' }
    vi.mocked(ofetch).mockResolvedValue({ status: 'error' })
    await expect(crawler.fetchSource(source)).rejects.toThrow('Failed to fetch source weibo: error')
  })
})
