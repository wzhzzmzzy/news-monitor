import type { StorageService } from '../services/storage.js'
import type { AnalyzerService } from '../services/analyzer.js'
import type { NotifierService } from '../services/notifier.js'
import type { HourlyBatchResult, NewsIndexItem, TimeRange } from '../types/index.js'
import logger from '../utils/logger.js'
import { format, subDays } from 'date-fns'

export class Reporter {
  private storage: StorageService
  private analyzer: AnalyzerService
  private notifier: NotifierService

  constructor(
    storage: StorageService,
    analyzer: AnalyzerService,
    notifier: NotifierService
  ) {
    this.storage = storage
    this.analyzer = analyzer
    this.notifier = notifier
  }

  async runHourlyAnalysis(items: NewsIndexItem[]): Promise<void> {
    if (items.length === 0) return

    const result = await this.analyzer.analyzeBatch(items)
    
    // Load existing hourly results
    const filename = 'keywords.json'
    const existing = (await this.storage.loadJson<HourlyBatchResult[]>(filename)) || []
    existing.push(result)
    
    await this.storage.saveJson(filename, existing)
    logger.success(`Hourly analysis saved with ${result.keyInfo.length} topics.`)
  }

  async runDailyReport(date: Date = new Date(), recipientIndex?: number): Promise<void> {
    const filename = 'keywords.json'
    const batches = await this.storage.loadJson<HourlyBatchResult[]>(filename, date)

    if (!batches || batches.length === 0) {
      logger.warn(`No hourly results found for ${format(date, 'yyyy-MM-dd')}. Skipping daily report.`)
      return
    }

    // 1. Aggregate to Daily Summary
    const todaySummary = this.analyzer.aggregateToDaily(batches, date)

    // 2. Load History for Multi-Day Analysis (e.g., 7 days)
    const historyStart = subDays(date, 7)
    const historyEnd = subDays(date, 1)
    const history = await this.storage.getSummaryRange(historyStart, historyEnd)

    // 3. Detect Trends
    const clusters = await this.analyzer.detectMultiDayTrends(todaySummary, history)

    // 4. Save Daily Summary
    await this.storage.saveDailySummary(date, todaySummary)

    // 5. Load full news index for links
    const newsIndex = (await this.storage.loadJson<Record<string, NewsIndexItem>>('index.json')) || {}

    // 6. Generate Report with Multi-Day Context and source links
    const report = await this.analyzer.generateDailyReport(batches, clusters, newsIndex, date)
    
    const reportFilename = `report-${format(date, 'yyyyMMdd-HHmm')}.html`
    await this.storage.saveText(reportFilename, report, date)
    
        const subject = `TrendRadar Daily Report - ${format(date, 'yyyy-MM-dd')}`
    
        await this.notifier.sendReport(subject, report, recipientIndex)
    
        
    
        logger.success('Daily report generated and sent.')
    
      }
    
    
    
      async runHistoricalReport(range: TimeRange, recipientIndex?: number): Promise<void> {
    
        const batches = await this.storage.getBatchesInRange(range.start, range.end);
    
        if (batches.length === 0) {
    
          logger.warn(`No results found in range ${range.start.toISOString()} to ${range.end.toISOString()}. Skipping report.`);
    
          return;
    
        }
    
    
    
        const newsIndex = await this.storage.getNewsIndexInRange(range.start, range.end);
    
    
    
        const report = await this.analyzer.generateHistoricalReport(batches, [], newsIndex, range);
    
    
    
        const date = range.end;
    
        const reportFilename = `report-range-${format(range.start, 'yyyyMMddHHmm')}-to-${format(range.end, 'yyyyMMddHHmm')}.html`;
    
        await this.storage.saveText(reportFilename, report, date);
    
    
    
        const subject = `TrendRadar ${range.mode === 'historical' ? 'Historical' : 'Single-Day'} Report [${format(range.start, 'MM-dd HH:mm')} to ${format(range.end, 'MM-dd HH:mm')}]`;
    
        await this.notifier.sendReport(subject, report, recipientIndex);
    
    
    
        logger.success(`${range.mode === 'historical' ? 'Historical' : 'Single-Day'} report generated and sent.`);
    
      }
    
    }
    
    