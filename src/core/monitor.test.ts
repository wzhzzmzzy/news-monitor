import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Monitor } from './monitor.js'
import type { StorageService } from '../services/storage.js'
import type { RawNewsItem } from '../types/index.js'

describe('Monitor', () => {
  let monitor: Monitor
  let mockStorage: any

  beforeEach(() => {
    mockStorage = {
      loadJson: vi.fn(),
      saveJson: vi.fn(),
    }
    monitor = new Monitor(mockStorage as unknown as StorageService)
  })

  it('should process and deduplicate items', async () => {
    const fetchedAt = new Date().toISOString()
    const items: RawNewsItem[] = [
      { title: 'News A', url: 'url-a', source: 'weibo', rank: 1, fetchedAt },
      { title: 'News A', url: 'url-a', source: 'zhihu', rank: 5, fetchedAt }, // Same URL
      { title: 'News B', url: 'url-b', source: 'weibo', rank: 2, fetchedAt },
    ]

    mockStorage.loadJson.mockResolvedValue({}) // Start with empty index

    await monitor.processItems(items)

    expect(mockStorage.saveJson).toHaveBeenCalledTimes(1)
    const savedIndex = mockStorage.saveJson.mock.calls[0][1]
    
    // Should have 2 items in index
    const keys = Object.keys(savedIndex)
    expect(keys).toHaveLength(2)

    // Check News A (deduplicated)
    const itemA = Object.values(savedIndex).find((i: any) => i.title === 'News A') as any
    expect(itemA.sources).toContain('weibo')
    expect(itemA.sources).toContain('zhihu')
    expect(itemA.occurrences).toBe(2)
    expect(itemA.maxRank).toBe(1)
  })

  it('should update existing index from storage', async () => {
    const fetchedAt = new Date().toISOString()
    const existingId = '1'

    const existingIndex = {
      [existingId]: {
        id: existingId,
        title: 'Old News A',
        url: 'url-a',
        sources: ['weibo'],
        firstSeen: '2026-02-05T00:00:00Z',
        lastSeen: '2026-02-05T00:00:00Z',
        maxRank: 10,
        occurrences: 1,
      }
    }

    mockStorage.loadJson.mockResolvedValue(existingIndex)

    const items: RawNewsItem[] = [
      { title: 'News A', url: 'url-a', source: 'zhihu', rank: 2, fetchedAt },
      { title: 'News C', url: 'url-c', source: 'weibo', rank: 3, fetchedAt },
    ]

    await monitor.processItems(items)

    const savedIndex = mockStorage.saveJson.mock.calls[0][1]
    
    // Check News A (updated)
    const updatedA = savedIndex[existingId]
    expect(updatedA.sources).toContain('weibo')
    expect(updatedA.sources).toContain('zhihu')
    expect(updatedA.occurrences).toBe(2)
    expect(updatedA.maxRank).toBe(2)
    expect(updatedA.lastSeen).toBe(fetchedAt)

    // Check News C (new, should have ID '2')
    const itemC = savedIndex['2']
    expect(itemC).toBeDefined()
    expect(itemC.url).toBe('url-c')
    expect(itemC.id).toBe('2')
  })

  // -- US2 Scheduler Tests --
  it('should run stream analysis every time but skip hotlist if recent', async () => {
    const config: any = {
      enable_stream_analysis: true,
      stream_sources: [{ id: 's1' }],
      hotlist_sources: [{ id: 'h1' }]
    }
    const services: any = {
      crawler: {
        fetchStreams: vi.fn().mockResolvedValue([{ timestamp: '2026-02-06T10:00:00Z' }]),
        fetchHotlists: vi.fn()
      },
      analyzer: {},
      reporter: { runHourlyAnalysis: vi.fn() }
    }
    
    // Mock state: hotlist ran 30m ago
    const lastRun = new Date()
    lastRun.setMinutes(lastRun.getMinutes() - 30)
    mockStorage.loadJson.mockResolvedValue({
      lastHotlistRun: lastRun.toISOString(),
      lastStreamRun: null
    })
    mockStorage.appendStreamItem = vi.fn()

    await monitor.run(config, services)

    expect(services.crawler.fetchStreams).toHaveBeenCalled()
    expect(mockStorage.appendStreamItem).toHaveBeenCalled()
    expect(services.crawler.fetchHotlists).not.toHaveBeenCalled()
    expect(mockStorage.saveJson).toHaveBeenCalledWith('status.json', expect.objectContaining({
      lastStreamRun: expect.any(String),
      lastHotlistRun: lastRun.toISOString() // Unchanged
    }))
  })

  it('should run hotlist analysis if > 2h elapsed', async () => {
    const config: any = {
      enable_stream_analysis: false,
      hotlist_sources: [{ id: 'h1' }],
      stream_sources: []
    }
    const services: any = {
      crawler: {
        fetchHotlists: vi.fn().mockResolvedValue([{ title: 'News', url: 'http://test.com', rank: 1, fetchedAt: new Date().toISOString() }]),
        fetchStreams: vi.fn()
      },
      analyzer: {},
      reporter: { runHourlyAnalysis: vi.fn() }
    }
    
    // Mock state: hotlist ran 3h ago
    const lastRun = new Date()
    lastRun.setHours(lastRun.getHours() - 3)
    
    mockStorage.loadJson.mockImplementation((filename: string) => {
        if (filename === 'status.json') {
            return Promise.resolve({ lastHotlistRun: lastRun.toISOString() })
        }
        if (filename === 'index.json') {
            return Promise.resolve({})
        }
        return Promise.resolve(null)
    })

    await monitor.run(config, services)

    expect(services.crawler.fetchHotlists).toHaveBeenCalled()
    expect(services.reporter.runHourlyAnalysis).toHaveBeenCalled()
    expect(mockStorage.saveJson).toHaveBeenCalledWith('status.json', expect.objectContaining({
      lastHotlistRun: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/)
    }))
  })
})
