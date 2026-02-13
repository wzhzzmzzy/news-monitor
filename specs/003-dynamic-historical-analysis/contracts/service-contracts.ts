// Service Contracts for Dynamic Historical Analysis

import type { HourlyBatchResult, NewsIndexItem, DailyTrendSummary, TrendCluster } from '../../../src/types/index.js';

export interface StorageServiceContract {
  /**
   * Loads all HourlyBatchResult within the given range across multiple days.
   */
  getBatchesInRange(start: Date, end: Date): Promise<HourlyBatchResult[]>;

  /**
   * Loads and merges NewsIndexItem records for all days covered by the range.
   */
  getNewsIndexInRange(start: Date, end: Date): Promise<Record<string, NewsIndexItem>>;
}

export interface AnalyzerServiceContract {
  /**
   * Generates a report specifically optimized for historical trends.
   */
  generateHistoricalReport(
    batches: HourlyBatchResult[],
    clusters: TrendCluster[],
    newsIndex: Record<string, NewsIndexItem>,
    timeRange: { start: Date; end: Date }
  ): Promise<string>;
}
