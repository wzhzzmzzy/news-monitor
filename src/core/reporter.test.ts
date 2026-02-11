import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Reporter } from './reporter.js'

describe('Reporter', () => {
  let reporter: Reporter
  let mockStorage: any
  let mockAnalyzer: any
  let mockNotifier: any

  beforeEach(() => {
    mockStorage = {
      loadJson: vi.fn(),
      saveJson: vi.fn(),
      saveText: vi.fn(),
    }
    mockAnalyzer = {
      analyzeBatch: vi.fn(),
      generateDailyReport: vi.fn(),
      aggregateToDaily: vi.fn(),
      detectMultiDayTrends: vi.fn(),
    }
    mockNotifier = {
      sendReport: vi.fn(),
    }
    mockStorage = {
      loadJson: vi.fn(),
      saveJson: vi.fn(),
      saveText: vi.fn(),
      getSummaryRange: vi.fn(),
      saveDailySummary: vi.fn(),
    }
    reporter = new Reporter(mockStorage, mockAnalyzer, mockNotifier)
  })

  it('should run hourly analysis and save results', async () => {
    const items: any[] = [{ id: '1' }]
    const mockResult = { summary: 'summary', keyInfo: [] }
    mockAnalyzer.analyzeBatch.mockResolvedValue(mockResult)
    mockStorage.loadJson.mockResolvedValue([])

    await reporter.runHourlyAnalysis(items)

    expect(mockAnalyzer.analyzeBatch).toHaveBeenCalledWith(items)
    expect(mockStorage.saveJson).toHaveBeenCalledWith('keywords.json', [mockResult])
  })

  it('should run daily report and send notification', async () => {
    const mockBatches = [{ summary: 'batch' }]
    const mockSummary = { date: '2026-02-11', trends: [] }
    const mockClusters: any[] = []
    
    mockStorage.loadJson.mockResolvedValue(mockBatches)
    mockStorage.getSummaryRange.mockResolvedValue([])
    mockAnalyzer.aggregateToDaily.mockReturnValue(mockSummary)
    mockAnalyzer.detectMultiDayTrends.mockResolvedValue(mockClusters)
    mockAnalyzer.generateDailyReport.mockResolvedValue('# Report')

    await reporter.runDailyReport()

    expect(mockAnalyzer.aggregateToDaily).toHaveBeenCalled()
    expect(mockAnalyzer.detectMultiDayTrends).toHaveBeenCalled()
    expect(mockAnalyzer.generateDailyReport).toHaveBeenCalled()
    expect(mockStorage.saveDailySummary).toHaveBeenCalled()
    expect(mockStorage.saveText).toHaveBeenCalled()
    expect(mockNotifier.sendReport).toHaveBeenCalled()
  })
})
