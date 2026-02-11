// Service Interfaces for Multi-Day Analysis Feature

// -- Domain Types (Mirroring data-model.md) --

export interface TrendItem {
  id: string;
  title: string;
  keywords: string[];
  score: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface DailyTrendSummary {
  date: string;
  trends: TrendItem[];
}

export interface StreamItem {
  timestamp: string;
  source_id: string;
  content: string;
  url: string;
}

export interface TrendCluster {
  main_topic: string;
  duration_days: number;
  history: { date: string; score: number }[];
  stream_evidence: StreamItem[];
}

// -- Service Contracts --

export interface IStorageService {
  /**
   * Reads the daily summary for a specific date.
   */
  getDailySummary(date: Date): Promise<DailyTrendSummary | null>;

  /**
   * Reads daily summaries for a date range (inclusive).
   */
  getSummaryRange(startDate: Date, endDate: Date): Promise<DailyTrendSummary[]>;

  /**
   * Appends a stream item to the daily buffer.
   */
  appendStreamItem(item: StreamItem): Promise<void>;

  /**
   * Retrieves stream items for a time window (for correlation).
   */
  getStreamItems(since: Date): Promise<StreamItem[]>;
  
  /**
   * Saves the analyzed daily summary.
   */
  saveDailySummary(date: Date, summary: DailyTrendSummary): Promise<void>;
}

export interface IAnalyzerService {
  /**
   * Correlates today's trends with history to find long-running topics.
   * "Map-Reduce" logic happens here.
   */
  detectMultiDayTrends(
    today: DailyTrendSummary, 
    history: DailyTrendSummary[]
  ): Promise<TrendCluster[]>;

  /**
   * Correlates Stream items with Hotlist topics.
   */
  correlateStreams(
    hotlistTrends: TrendItem[], 
    streamItems: StreamItem[]
  ): Promise<Record<string, StreamItem[]>>; // TrendID -> Evidence[]
}

export interface IScheduler {
  /**
   * Determines which tasks to run based on current time and last run state.
   */
  tick(): Promise<void>;
}