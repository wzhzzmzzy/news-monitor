# Data Model

## Configuration (`config.yaml`)

```typescript
interface AppConfig {
  // Scheduling
  cron_expression_hotlist: string; // default "0 */2 * * *"
  cron_expression_stream: string;  // default "*/30 * * * *"

  // Sources
  hotlist_sources: SourceConfig[];
  stream_sources: SourceConfig[]; // NEW

  // Analysis
  analysis_window_days: number; // e.g., 3, 5, 7
  enable_stream_analysis: boolean;
  
  // AI
  llm: LLMConfig;
}

interface SourceConfig {
  id: string;
  type: 'rss' | 'api' | 'html';
  url: string;
  selector?: string;
  // ... existing fields
}
```

## Storage Artifacts

### 1. Daily Summary (`archive/YYYY-MM-DD/summary.json`)
Generated after analysis, serves as "Long-term Memory".

```typescript
interface DailyTrendSummary {
  date: string; // YYYY-MM-DD
  generated_at: string; // ISO
  trends: TrendItem[];
}

interface TrendItem {
  id: string; // unique hash or slug
  title: string;
  keywords: string[]; // used for linking
  score: number; // normalized heat score
  category?: string;
  first_seen_at: string; // ISO
  related_links: string[];
}
```

### 2. Stream Buffer (`archive/YYYY-MM-DD/stream-buffer.jsonl`)
Appended logs of stream items.

```typescript
interface StreamItem {
  timestamp: string;
  source_id: string;
  content: string;
  url: string;
}
```

## Internal Models (Runtime)

### TrendCluster (The "Linked" Trend)
Created by correlating `TrendItem`s across days.

```typescript
interface TrendCluster {
  primary_keywords: string[];
  occurrences: {
    date: string;
    score: number;
    title: string;
  }[];
  duration_days: number;
  is_rising: boolean; // score trend
  stream_matches: StreamItem[]; // linked evidence
}
```