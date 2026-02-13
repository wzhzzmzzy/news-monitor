export interface SourceConfig {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'html';
  url: string;
  selector?: string;
  headers?: Record<string, string>;
}

export interface Config {
  // Crawler
  newsApiBaseUrl: string;
  /** @deprecated Use hotlist_sources instead */
  sources?: string[];
  hotlist_sources: SourceConfig[];
  stream_sources: SourceConfig[];
  monitorCron: string;
  dailyReportCron: string;
  historicalReportCron: string;
  serverPort: number;

  // Analysis
  analysis_window_days: number;
  enable_stream_analysis: boolean;

  // Storage
  archiveDir: string;

  // LLM
  llmProvider: 'openai' | 'deepseek' | 'anthropic';
  llmApiKey: string;
  llmBaseUrl?: string;
  llmModel: string;

  // Notification
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass: string;
  emailFromName?: string;
  emailFrom: string;
  emailTo: string[];
}

export interface RawNewsItem {
  title: string;
  url: string;
  source?: string;
  rank: number;
  score?: number;
  fetchedAt: string;
}

export interface NewsIndexItem {
  id: string;
  title: string;
  url: string;
  sources: string[];
  firstSeen: string;
  lastSeen: string;
  maxRank: number;
  occurrences: number;
  isSafetyRisk?: boolean;
}

export interface KeyInfoItem {
  topic: string;
  entities: string[];
  heatScore: number;
  category: string;
  newsIds: string[];
}

export interface HourlyBatchResult {
  timestamp: string;
  summary: string;
  keyInfo: KeyInfoItem[];
}

// -- Multi-Day Analysis Models --

export interface TrendItem {
  id: string;
  title: string;
  keywords: string[];
  score: number;
  category?: string;
  first_seen_at: string;
  related_links: string[];
}

export interface DailyTrendSummary {
  date: string; // YYYY-MM-DD
  generated_at: string; // ISO
  trends: TrendItem[];
}

export interface StreamItem {
  timestamp: string; // ISO
  source_id: string;
  content: string;
  url: string;
}

export interface TrendCluster {
  main_topic: string;
  keywords: string[];
  duration_days: number;
  is_rising: boolean;
  history: { date: string; score: number; title: string }[];
  stream_evidence: StreamItem[];
  related_links: string[];
}

export interface ReportNewsItem {
  title: string;
  url: string;
  source: string;
  otherPlatforms?: { platform: string; url: string }[];
}

export interface ReportTopic {
  title: string;
  score: number;
  analysis: string;
  isLongTerm: boolean;
  news: ReportNewsItem[];
}

export interface DailyReportData {
  date: string;
  summary: string;
  topics: ReportTopic[];
  orphans?: { title: string; score: number; sourceCount: number; maxRank: number; url?: string }[];
  sourceNames?: Record<string, string>;
}

// -- Historical Analysis Models --

export interface TimeRange {
  start: Date;
  end: Date;
  mode: 'single' | 'historical';
}

export interface TimelineEntry {
  date: string;
  event: string;
  heatScore: number;
}

export interface HistoricalTopic {
  title: string;
  score: number;
  evolution: string;
  timeline: TimelineEntry[];
  news: ReportNewsItem[];
}

export interface HistoricalReportData {
  timeRange: {
    start: string;
    end: string;
    mode: 'single' | 'historical';
  };
  summary: string;
  topics: HistoricalTopic[];
  sourceNames?: Record<string, string>;
}
