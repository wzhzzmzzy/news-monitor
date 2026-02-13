# Implementation Plan - Dynamic Historical Analysis

**Branch**: `003-dynamic-historical-analysis` | **Date**: 2026-02-13 | **Spec**: `specs/003-dynamic-historical-analysis/spec.md`

Introduce a dynamic time window mechanism to allow users to generate reports for arbitrary periods, with automatic mode switching between "Single-Day" and "Historical Trend" analysis.

## Summary

The core logic of TrendRadar will be shifted from fixed "Natural Day" reporting to a dynamic `[start, end]` window. The system will automatically aggregate data across multiple `archive/YYYY-MM-DD/` directories. 

Two modes will be supported:
1. **Single-Day Mode**: When the range is within a single local day. Focuses on details.
2. **Historical Trend Mode**: When the range crosses multiple days. Focuses on evolution and timeline.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 22
**Primary Dependencies**: cac, date-fns, pino-pretty, ai (SDK)
**Storage**: File-system based (archive/ directory)
**Testing**: Vitest
**Project Type**: CLI tool
**Performance Goals**: Aggregate 7 days of data (< 200 HourlyBatchResult) within 2 seconds.
**Constraints**: Maximum 7 days analysis range.
**Scale/Scope**: ~5-10 core topics per report, handling up to 1000 news items per week.

## Constitution Check

- [x] **Simplicity**: Simple range-based filtering and mode switching. (Principle I)
- [x] **Modularity**: Data aggregation logic separated into StorageService; Analysis logic in AnalyzerService. (Principle II)
- [x] **FP Paradigm**: Using date utility functions and pure aggregation logic. (Principle II)
- [x] **Testability**: New storage aggregation and analyzer prompts are testable. (Principle III)
- [x] **Type Safety**: Defining strict interfaces for HistoricalReportData. (Principle IV)

## Project Structure

### Documentation (this feature)

```text
specs/003-dynamic-historical-analysis/
├── plan.md              # This file
├── research.md          # Research on historical prompt strategies
├── data-model.md        # Extended data models for historical analysis
├── quickstart.md        # How to use --start and --end
├── contracts/           # API/Interface changes
└── tasks.md             # Implementation tasks
```

### Source Code

```text
src/
├── core/
│   └── reporter.ts      # Update to handle dynamic reports
├── services/
│   ├── analyzer.ts      # New historical analysis logic/prompts
│   └── storage.ts       # Cross-date data aggregation
├── utils/
│   ├── logger.ts        # Local time output optimization
│   ├── renderer.ts      # Adaptive HTML templates
│   └── time.ts          # New time parsing utilities
└── index.ts             # CLI command updates
```

## Phase 0: Research & Foundation
- [ ] Document LLM prompt strategy for "Evolution Insight" in `research.md`.
- [ ] Verify `pino-pretty` local time configuration.
- [ ] Research `date-fns` behavior for local time interval calculations.

## Phase 1: Design & Contracts
- [ ] Define `HistoricalReportData` and `TimeRange` types in `src/types/index.ts`.
- [ ] Update `StorageService` interface for range-based retrieval.
- [ ] Update `AnalyzerService` interface for historical reports.
- [ ] Run `.specify/scripts/bash/update-agent-context.sh gemini`.

## Phase 2: Implementation (Core)
- [ ] Optimize Logger time output to local time.
- [ ] Implement `src/utils/time.ts` for `yy-mm-dd hh:MM` parsing.
- [ ] Implement `StorageService.getBatchesInRange` and `getNewsIndexInRange`.
- [ ] Update `index.ts` to support `--start` and `--end`.
- [ ] Configure environment-specific configs:
    - Update `package.json` scripts (`dev` uses `config.dev.yaml`, `start` uses `config.yaml`).
    - Add `config.dev.yaml` to `.gitignore`.

## Phase 3: AI & Rendering
- [ ] Implement `AnalyzerService.generateHistoricalReport`.
- [ ] Update `renderer.ts` with adaptive CSS and components for Historical Mode.
- [ ] Add unit tests for range aggregation and time parsing.