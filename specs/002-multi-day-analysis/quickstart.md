# Quickstart: Multi-Day Analysis

## Configuration

1.  **Update `config.yaml`**:
    Define `analysis_window_days` and separate sources.

    ```yaml
    analysis_window_days: 7     # Recommended: 3 to 7
    enable_stream_analysis: true
    hotlist_sources:
      - id: weibo
        type: html
        url: "http://localhost:13000/api/s?id=weibo"
    stream_sources:
      - id: jin10
        type: rss
        url: "http://localhost:13000/api/s?id=jin10"
    ```

## Running the Feature

The `monitor` command now handles scheduling internally if run periodically.

```bash
# Every 30 minutes (handles stream polling and 2h hotlist interval)
pnpm dev monitor

# Generate report (incorporates multi-day trends)
pnpm dev report
```

## Testing and Benchmarking

We have verified the logic with the following scripts:

```bash
# Unit tests
pnpm test src/services/analyzer.test.ts
pnpm test src/services/storage.test.ts

# Performance check (< 10s for 7 days)
npx tsx scripts/benchmark-analysis.ts

# 3-Day Cycle Integration test
npx tsx scripts/integration-test.ts
```

## Verifying Results

Check the output in `archive/YYYY-MM-DD/`:
- `summary.json`: The "Long-term Memory" generated after analysis.
- `stream-buffer.jsonl`: Logs of incoming stream data.
- `report-*.md`: Daily report including "持续关注的话题" (Multi-Day Trends) and "实时信号" counts.
