---
description: "Task list for Dynamic Historical Analysis implementation"
---

# Tasks: Dynamic Historical Analysis

**Input**: Design documents from `specs/003-dynamic-historical-analysis/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and research

- [x] T001 Document LLM prompt strategy for "Evolution Insight" in `specs/003-dynamic-historical-analysis/research.md`
- [x] T002 Run `.specify/scripts/bash/update-agent-context.sh gemini` to synchronize context

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure and types required for all user stories

- [x] T003 [P] Define `HistoricalReportData`, `TimeRange`, and `HistoricalTopic` types in `src/types/index.ts`
- [x] T004 [P] Implement time parsing utilities for `yy-mm-dd hh:MM` in `src/utils/time.ts`
- [x] T005 Update `StorageService` interface in `src/services/storage.ts` with range-based methods
- [x] T006 Update `AnalyzerService` interface in `src/services/analyzer.ts` for historical reports

**Checkpoint**: Foundation ready - user story implementation can begin

---

## Phase 3: User Story 2 - Local Time Logging (Priority: P1)

**Goal**: Logging output uses system local time instead of UTC (R5)

**Independent Test**: Run any command and verify console timestamps match local system time

### Tests for User Story 2

- [x] T007 [P] [US2] Add unit tests for local time formatting in `src/utils/logger.test.ts`

### Implementation for User Story 2

- [x] T008 [US2] Configure `pino-pretty` local time settings in `src/utils/logger.ts`
- [x] T009 [US2] Update logger initialization to ensure consistent local time output

---

## Phase 4: User Story 3 - Environment-Specific Configuration (Priority: P1)

**Goal**: Support explicit config paths for dev/prod environments (R6)

**Independent Test**: `pnpm dev` uses `config.dev.yaml` and `pnpm start` uses `config.yaml`

### Tests for User Story 3

- [x] T010 [P] [US3] Add tests for environment-specific config loading in `src/core/config.test.ts`

### Implementation for User Story 3

- [x] T011 [US3] Update `package.json` scripts (`dev`, `start`) to pass `--config` argument
- [x] T012 [US3] Update `src/core/config.ts` to load configuration from the provided file path

---

## Phase 5: User Story 1 - Dynamic Time Window (Priority: P1) 🎯 MVP

**Goal**: CLI support for `--start` and `--end` parameters with validation and defaults (R1)

**Independent Test**: `pnpm dev report --help` shows flags; `today 01:00` to `now` defaults apply; invalid ranges (>7 days) rejected

### Tests for User Story 1

- [x] T013 [P] [US1] Add unit tests for time window parsing, validation, and defaults in `src/utils/time.test.ts`

### Implementation for User Story 1

- [x] T014 [US1] Update `src/index.ts` to define `--start` and `--end` flags with defaults (`today 01:00`, `now`) via `cac`
- [x] T015 [US1] Implement validation logic for 7-day maximum range in `src/utils/time.ts`
- [x] T016 [US1] Update `src/core/reporter.ts` to accept parsed `TimeRange` from CLI

**Checkpoint**: CLI flags are functional and validated

---

## Phase 6: User Story 4 - Data Aggregation (Priority: P2)

**Goal**: Retrieve and merge data from multiple archive directories within 2 seconds (R3)

**Independent Test**: Verify `getBatchesInRange` returns results from multiple days; benchmark < 2s for 7 days

### Tests for User Story 4

- [x] T017 [P] [US4] Add unit tests for cross-date aggregation in `src/services/storage.test.ts`
- [x] T018 [US4] Implement a performance benchmark test to verify 7-day data aggregation completes within 2 seconds

### Implementation for User Story 4

- [x] T019 [US4] Implement `StorageService.getBatchesInRange` in `src/services/storage.ts`
- [x] T020 [US4] Implement `StorageService.getNewsIndexInRange` in `src/services/storage.ts`

---

## Phase 7: User Story 5 - Mode Switching (Priority: P2)

**Goal**: Automatic differentiation between single-day and historical mode (R2)

**Independent Test**: Verify `mode` is 'single' for same-day range and 'historical' for multi-day range

### Tests for User Story 5

- [x] T021 [P] [US5] Add unit tests for mode detection logic in `src/utils/time.test.ts`

### Implementation for User Story 5

- [x] T022 [US5] Implement mode detection logic in `src/utils/time.ts`
- [x] T023 [US5] Update `src/core/reporter.ts` to branch logic based on `TimeRange.mode`

---

## Phase 8: User Story 6 - Enhanced Analysis (Priority: P3)

**Goal**: AI-driven evolution insights and timeline retrospective (R4)

**Independent Test**: Generated HTML report shows "Evolution Insight" and "Timeline" sections in historical mode

### Tests for User Story 6

- [x] T024 [P] [US6] Add unit tests for historical analysis prompt generation in `src/services/analyzer.test.ts`

### Implementation for User Story 6

- [x] T025 [US6] Implement `AnalyzerService.generateHistoricalReport` with evolutionary prompts in `src/services/analyzer.ts`
- [x] T026 [US6] Update `src/utils/renderer.ts` with CSS/HTML for timeline and evolution components
- [x] T027 [US6] Integrate historical analysis flow into `src/core/reporter.ts`

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [x] T028 [P] Update `README.md` with new `--start` and `--end` documentation
- [x] T029 Run `specs/003-dynamic-historical-analysis/quickstart.md` validation scenarios
- [x] T030 Final code cleanup and removal of temporary debug logs
- [x] T031 [US1] Support relative time window in scheduled reports via `report_window_days`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 - BLOCKS all user stories
- **User Stories (Phase 3-8)**: Depend on Phase 2 completion
  - US2 (Logging) and US3 (Env Config) can be done in parallel
  - US1 (Time Window) → US4 (Aggregation) → US5 (Mode) → US6 (Analysis) is the primary sequence
- **Polish (Phase 9)**: Depends on all stories being complete

### Parallel Opportunities

- T003, T004 (Foundational types and utils)
- US2 and US3 implementation
- All test tasks marked [P] (T007, T010, T013, T017, T021, T024)

---

## Parallel Example: User Story 1

```bash
# Launch unit tests for User Story 1:
Task: "Add unit tests for time window parsing, validation, and defaults in src/utils/time.test.ts"
```

---

## Implementation Strategy

### MVP First (US1, US2, US3)

1. Complete Setup and Foundational
2. Complete US2 (Logging) and US3 (Env) for better DX
3. Complete US1 (Time Window) for basic parameter support

### Incremental Delivery

1. Foundation + Logging + Env → Solid base
2. Add Time Window (US1) → CLI support with defaults
3. Add Aggregation (US4) → Multi-day data loading with performance check
4. Add Mode/Analysis (US5, US6) → Full historical features