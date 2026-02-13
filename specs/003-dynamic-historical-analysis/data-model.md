# Data Model - Dynamic Historical Analysis

## Entities

### TimeRange
Represents the analysis window.
- `start`: Date
- `end`: Date
- `mode`: 'single' | 'historical'

### HistoricalReportData
Extends the current `DailyReportData` to support multi-day context.

```typescript
interface HistoricalReportData {
  timeRange: {
    start: string; // ISO or formatted
    end: string;
    mode: 'single' | 'historical';
  };
  summary: string; // Overall evolution summary
  topics: HistoricalTopic[];
  sourceNames: Record<string, string>;
}

interface HistoricalTopic {
  title: string;
  score: number;
  evolution: string; // "Origin -> Peak -> Current"
  timeline: TimelineEntry[];
  news: GroupedNews[];
}

interface TimelineEntry {
  date: string;
  event: string;
  heatScore: number;
}
```

## Storage Changes
No changes to on-disk format. The "Dynamic" aspect is handled at the retrieval layer.
- `archive/YYYY-MM-DD/keywords.json`: Read multiple files.
- `archive/YYYY-MM-DD/index.json`: Read and merge into a single `newsIndex`.
