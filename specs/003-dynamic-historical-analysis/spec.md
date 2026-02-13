# Feature Spec - Dynamic Historical Analysis

## Overview
Introduce `--start` and `--end` parameters to allow flexible time-window reporting, with automatic differentiation between single-day and multi-day analysis.

## Requirements

### R1: Dynamic Time Window
- Parameters: `--start`, `--end`.
- Format: `yy-mm-dd hh:MM`.
- Default: `today 01:00` to `now`.
- Range limit: Maximum 7 days.

### R2: Mode Switching
- **Single-Day Mode**: Both start/end are on the same local date. Focus on news details.
- **Historical Mode**: Start/end cross at least one midnight. Focus on evolution and timeline.

### R3: Data Aggregation
- System must retrieve data from multiple `archive/YYYY-MM-DD/` directories.
- Filter `HourlyBatchResult` by the specified time window.

### R4: Enhanced Analysis (Historical Mode)
- **Evolution Insight**: AI must summarize how the topic developed over the period.
- **Timeline Retrospective**: Display key milestones for each topic.

### R5: Local Time Logging
- Logging output must use system local time instead of UTC.

### R6: Environment-Specific Configuration
- Use `config.yaml` for production (`pnpm start`).
- Use `config.dev.yaml` (or similar) for development (`pnpm dev`).
- Ensure `pnpm dev` and `pnpm start` commands in `package.json` explicitly pass the correct config path.

## Acceptance Criteria
- [ ] `pnpm dev report --start "26-02-10 10:00" --end "26-02-11 10:00"` generates a cross-day report.
- [ ] Error message if time format is invalid or range > 7 days.
- [ ] Report HTML shows the actual time range analyzed.
- [ ] Console logs show local time timestamps.
