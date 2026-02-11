# Implementation Tasks: Multi-Day Analysis

**Feature**: `002-multi-day-analysis`
**Status**: Completed
**Spec**: `specs/002-multi-day-analysis/spec.md`

## Phase 1: Setup & Configuration

*Goal: Update configuration schema to support separate Hotlist/Stream sources and analysis settings.*

- [x] T001 [P] Update `AppConfig` schema in `src/schema/config.ts` to include `hotlist_sources` and `stream_sources` (deprecating `sources`).
- [x] T002 [P] Update `AppConfig` schema in `src/schema/config.ts` to include `analysis_window_days` and `enable_stream_analysis`.
- [x] T003 Implement configuration migration logic in `src/core/config.ts` to map legacy `sources` to `hotlist_sources`.
- [x] T004 [P] Update `src/types/index.ts` with new `SourceConfig` types and `AppConfig` interface.
- [x] T005 Create unit tests for config validation and migration in `src/core/config.test.ts`.

## Phase 2: Foundational Storage

*Goal: Enable multi-day file access and persistence for new summary formats.*

- [x] T006 [P] Update `StorageService` in `src/services/storage.ts` to implement `getDailySummary(date)` and `saveDailySummary(date, data)`.
- [x] T007 [P] Implement `getSummaryRange(startDate, endDate)` in `src/services/storage.ts` using `date-fns` for iteration.
- [x] T008 [P] Implement `appendStreamItem(item)` and `getStreamItems(since)` in `src/services/storage.ts` for the stream buffer.
- [x] T009 Create unit tests for `StorageService` date range retrieval and file operations in `src/services/storage.test.ts`.
- [x] T010 Define `DailyTrendSummary` and `StreamItem` interfaces in `src/types/index.ts` (matching `data-model.md`).

## Phase 3: Multi-Day Trend Tracking (US1)

*Goal: Track trend duration and apply weighting based on persistence.*

- [x] T011 [US1] Create `src/services/analyzer.ts` (or update existing) with `detectMultiDayTrends` function skeleton.
- [x] T012 [P] [US1] Implement "Map" logic in `src/services/analyzer.ts`: Load last N days of summaries using `StorageService`.
- [x] T013 [P] [US1] Implement "Reduce" logic in `src/services/analyzer.ts`: Correlate topics by keywords to build `TrendCluster` objects.
- [x] T014 [US1] Implement `calculateDurationWeight` pure function in `src/services/analyzer.ts` to boost scores for long-running trends.
- [x] T015 [US1] Update `generateReport` in `src/core/reporter.ts` to accept `TrendCluster` data and display "Duration: X days".
- [x] T016 [US1] Create unit tests for `detectMultiDayTrends` (keyword matching, clustering) in `src/services/analyzer.test.ts`.

## Phase 4: Stream Analysis & Scheduling (US2)

*Goal: Separate polling schedules and correlate stream data with hotlists.*

- [x] T017 [US2] Refactor `src/services/crawler.ts` to support fetching from `stream_sources` separately from `hotlist_sources`.
- [x] T018 [US2] Implement `correlateStreams` in `src/services/analyzer.ts` to link `StreamItem`s to `TrendItem`s by keyword.
- [x] T019 [US2] Implement "Sentinel Watch" logic in `src/services/analyzer.ts` to find high-frequency stream items not yet in hotlists.
- [x] T020 [US2] Update `src/core/monitor.ts` scheduler loop to handle 30m (Stream) vs 2h (Hotlist) intervals.
- [x] T021 [US2] Update `generateReport` in `src/core/reporter.ts` to include Stream Evidence and Sentinel Watch sections if enabled.
- [x] T022 [x] Create unit tests for `correlateStreams` and scheduler logic in `src/core/monitor.test.ts`.

## Phase 5: Polish & Integration

*Goal: Finalize reports and ensure system stability.*

- [x] T023 Integration test: Run full cycle with mock data for 3 days to verify `summary.json` generation and linking.
- [x] T024 Verify backward compatibility: Run system with old `config.yaml` format and ensure it starts.
- [x] T025 Update README.md and quickstart.md with new configuration options and report explanation.
- [x] T026 Clean up any temporary debug logs or TODOs.
- [x] T027 [P] Create a benchmark script `scripts/benchmark-analysis.ts` to verify 7-day analysis performance is <10s (NFR-202).

## Dependencies

1. **Phase 1 (Config)** must be complete before any logic that reads `stream_sources`.
2. **Phase 2 (Storage)** is a blocker for US1 and US2 (needs `getSummaryRange` and `appendStreamItem`).
3. **US1 (Analyzer)** depends on T007 (Range Read).
4. **US2 (Streams)** depends on T008 (Stream Buffer) and US1 (linking streams to established trends).

## Parallel Execution

- **T001, T002, T004** (Config Schema/Types) can be done in parallel.
- **T006, T007, T008** (Storage Methods) can be implemented in parallel.
- **T012, T013** (Analyzer Logic) can be developed independently of **T017** (Crawler).