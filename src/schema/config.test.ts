import { describe, expect, it } from 'vitest'
import { configSchema } from './config.js'
import { parseFeedConfig } from '../feed/config.js'

describe('RSS/X configuration', () => {
  const sources = [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' }]
  it('needs no aggregation API, hotlist, model or SMTP configuration', () => {
    const config = configSchema.parse({ sources })
    expect(config.sources[0].type).toBe('rss')
    expect(config.schedule.sendEmail).toBe(false)
    expect(config.llm).toBeUndefined()
    expect(config.email).toBeUndefined()
  })
  it('refuses the old aggregator configuration instead of silently ignoring it', () => {
    expect(() => parseFeedConfig({ sources, newsApiBaseUrl: 'https://example.com' })).toThrow('旧 NewsNow 配置不再支持')
  })
  it('supports configurable RSSHub instances, routes and explicit disabled sources', () => {
    const config = configSchema.parse({ rsshub: { baseUrl: 'http://127.0.0.1:1200' }, sources: [
      { id: 'wallstreetcn-hot', name: '华尔街见闻', type: 'rsshub', route: '/wallstreetcn/hot/day' },
      { id: 'weibo', name: '微博', type: 'rsshub', route: '/weibo/search/hot', enabled: false, disabledReason: 'Upstream unavailable' },
    ] })
    expect(config.rsshub.baseUrl).toBe('http://127.0.0.1:1200')
    expect(config.sources[1].enabled).toBe(false)
    expect(() => configSchema.parse({ sources: [{ ...sources[0], type: 'rsshub', route: '//another-host/path' }] })).toThrow()
  })
})
