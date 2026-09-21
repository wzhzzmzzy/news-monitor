/** Configuration for the retained offline analysis of pre-migration archives. */
export interface Config {
  hotlist_sources: { id: string; name: string }[];
  stream_sources: { id: string; name: string }[];
  llmProvider: 'openai' | 'deepseek' | 'anthropic';
  llmApiKey: string;
  llmBaseUrl?: string;
  llmModel: string;
  llmStructuredOutputMode: 'auto' | 'json' | 'tool';
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
