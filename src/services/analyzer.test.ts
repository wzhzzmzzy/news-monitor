import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnalyzerService } from './analyzer.js'
import { generateObject, generateText } from 'ai'
import type { Config, NewsIndexItem, HourlyBatchResult } from '../types/index.js'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}))

describe('AnalyzerService', () => {
  const mockConfig: Config = {
    llmModel: 'gpt-4o',
    // ... other props not needed for constructor but required by type
  } as any
  let analyzer: AnalyzerService

  beforeEach(() => {
    analyzer = new AnalyzerService(mockConfig)
    vi.clearAllMocks()
  })

  it('should analyze a batch of news items', async () => {
    const items: NewsIndexItem[] = [
      { id: '1', title: 'SpaceX Launch', url: 'u1', sources: ['weibo'], firstSeen: '', lastSeen: '', maxRank: 1, occurrences: 1 },
    ]

    const mockObject = {
      summary: 'Space exploration news.',
      keyInfo: [
        { topic: 'SpaceX', entities: ['Elon Musk'], heatScore: 90, category: 'Tech', newsIds: ['1'] },
      ],
    }

    vi.mocked(generateObject).mockResolvedValue({ object: mockObject } as any)

    const result = await analyzer.analyzeBatch(items)

    expect(result.summary).toBe('Space exploration news.')
    expect(result.keyInfo).toHaveLength(1)
    expect(result.keyInfo[0].topic).toBe('SpaceX')
    expect(generateObject).toHaveBeenCalled()
  })

  it('should return empty result for empty batch', async () => {
    const result = await analyzer.analyzeBatch([])
    expect(result.keyInfo).toHaveLength(0)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('should generate a daily report', async () => {
    const batches: HourlyBatchResult[] = [
      { timestamp: '10:00', summary: 'Morning summary', keyInfo: [] },
    ]

    // Mock first call: topTopics
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        topTopics: [
          { title: 'Topic 1', baseScore: 80, relevantNewsIds: ['n1'], isLongTerm: false }
        ]
      }
    } as any)

    // Mock second call (inside loop): detailedTopic
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        analysis: 'Detailed analysis',
        groupedNews: [
          { title: 'News 1', url: 'u1', source: 'Source 1' }
        ]
      }
    } as any)

    vi.mocked(generateText).mockResolvedValue({ text: 'Daily summary' } as any)

    const report = await analyzer.generateDailyReport(batches)

    expect(report).toContain('Topic 1')
    expect(report).toContain('Detailed analysis')
    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenCalled()
  })

  // -- Multi-Day Analysis Tests --

  it('should calculate duration weight correctly', () => {
    expect(analyzer.calculateDurationWeight(1)).toBe(1.0)
    expect(analyzer.calculateDurationWeight(2)).toBeCloseTo(1.346, 2)
    expect(analyzer.calculateDurationWeight(7)).toBeCloseTo(1.97, 2)
  })

  it('should detect multi-day trends with ID matching', async () => {
    const today = {
      date: '2026-02-02', generated_at: '',
      trends: [{ id: 't1', title: 'Trend A', keywords: ['k1'], score: 50, first_seen_at: '', related_links: [] }]
    }
    const history = [
      {
        date: '2026-02-01', generated_at: '',
        trends: [{ id: 't1', title: 'Trend A', keywords: ['k1'], score: 40, first_seen_at: '', related_links: [] }]
      }
    ]

    const clusters = await analyzer.detectMultiDayTrends(today, history)
    
    expect(clusters).toHaveLength(1)
    expect(clusters[0].main_topic).toBe('Trend A')
    expect(clusters[0].duration_days).toBe(2)
    expect(clusters[0].history).toHaveLength(2)
    expect(clusters[0].is_rising).toBe(true) // 50 > 40
  })

  it('should detect fuzzy matches via keywords', async () => {
    const today = {
      date: '2026-02-02', generated_at: '',
      trends: [{ id: 't1-new', title: 'DeepSeek API Launch', keywords: ['DeepSeek', 'LLM', 'API'], score: 60, first_seen_at: '', related_links: [] }]
    }
    const history = [
      {
        date: '2026-02-01', generated_at: '',
        trends: [{ id: 't1-old', title: 'DeepSeek News', keywords: ['DeepSeek', 'LLM', 'China'], score: 50, first_seen_at: '', related_links: [] }]
      }
    ]

    const clusters = await analyzer.detectMultiDayTrends(today, history)
    
    expect(clusters).toHaveLength(1)
    expect(clusters[0].duration_days).toBe(2)
    expect(clusters[0].history).toHaveLength(2)
  })

  it('should sort clusters by weighted score', async () => {
    const today = {
      date: '2026-02-02', generated_at: '',
      trends: [
        { id: 'short', title: 'Short Trend', keywords: ['s'], score: 80, first_seen_at: '', related_links: [] },
        { id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }
      ]
    }
    const history = [
      {
        date: '2026-02-01', generated_at: '',
        trends: [{ id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }]
      }
    ]
    // Long trend: score 50 * weight(2) ~= 50 * 1.34 = 67
    // Short trend: score 80 * weight(1) = 80
    // Wait, 80 > 67. Let's make long trend stronger or older.
    
    // Let's add more history for 'long'
    // actually detectMultiDayTrends iterates history.
    // If I want 3 days, I add 2 history items.
    
    const history2 = [
        { date: '2026-02-01', generated_at: '', trends: [{ id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }] },
        { date: '2026-01-31', generated_at: '', trends: [{ id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }] },
        { date: '2026-01-30', generated_at: '', trends: [{ id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }] },
        { date: '2026-01-29', generated_at: '', trends: [{ id: 'long', title: 'Long Trend', keywords: ['l'], score: 50, first_seen_at: '', related_links: [] }] }
    ]
    // Now Long trend: 5 days. Weight(5) = 1 + ln(5)*0.5 ~= 1 + 1.6*0.5 = 1.8.
    // Score = 50 * 1.8 = 90.
    // 90 > 80. So Long should be first.

    const clusters = await analyzer.detectMultiDayTrends(today, history2)
    expect(clusters[0].main_topic).toBe('Long Trend')
  })

  it('should correlate streams to trends', async () => {
    const trends = [
      { id: 't1', title: 'SpaceX Launch', keywords: ['SpaceX', 'Mars'], score: 10, first_seen_at: '', related_links: [] }
    ]
    const streams = [
      { timestamp: '', source_id: '', content: 'Elon Musk discusses Mars mission', url: '' }, // Matches keyword 'Mars'
      { timestamp: '', source_id: '', content: 'Unrelated news', url: '' }
    ]

    const correlation = await analyzer.correlateStreams(trends, streams)
    
    expect(correlation['t1']).toHaveLength(1)
    expect(correlation['t1'][0].content).toContain('Mars')
  })
})
