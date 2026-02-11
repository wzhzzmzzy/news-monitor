# Implementation Tasks: TrendRadar Refactor

**Feature**: `001-trend-radar-refactor`
**Spec**: `specs/001-trend-radar-refactor/spec.md`

## Phase 1: Setup
*Goal: Initialize project structure and configuration.*

- [X] T001 Initialize Node.js project and TypeScript configuration in `package.json` and `tsconfig.json`
- [X] T002 Install dependencies (cac, zod, ofetch, ai, nodemailer, date-fns, js-yaml, consola)
- [X] T003 Setup Vitest test environment in `vitest.config.ts`
- [X] T004 Create project directory structure (`src/{core,services,schema,types,utils}`)
- [X] T005 Define shared types from data model in `src/types/index.ts`
- [X] T006 [P] Create Zod configuration schema in `src/schema/config.ts`
- [X] T007 Implement configuration loader in `src/core/config.ts`

## Phase 2: Foundational
*Goal: Implement shared services and utilities required by all user stories.*

- [X] T008 [P] Implement logger utility in `src/utils/logger.ts`
- [X] T009 [P] Implement retry mechanism utility in `src/utils/retry.ts`
- [X] T010 Implement Storage Service interface and class in `src/services/storage.ts`
- [X] T011 Create unit tests for Storage Service in `src/services/storage.test.ts`

## Phase 3: User Story 1 - Hourly Monitoring
*Goal: Automatically fetch news, deduplicate, and store raw data.*

- [X] T012 [P] [US1] Implement Crawler Service (`fetchAllSources`, `fetchSource`) in `src/services/crawler.ts`
- [X] T013 [US1] Create unit tests for Crawler Service in `src/services/crawler.test.ts`
- [X] T014 [US1] Implement monitoring core logic (deduplication, indexing) in `src/core/monitor.ts`
- [X] T015 [US1] Create unit tests for monitoring logic in `src/core/monitor.test.ts`
- [X] T016 [US1] Register `monitor` command in CLI entry point `src/index.ts`

## Phase 4: User Story 2 - Automated Analysis
*Goal: Extract keywords using LLM and generate daily reports.*

- [X] T017 [P] [US2] Implement Analyzer Service (`analyzeBatch`, `generateReport`) in `src/services/analyzer.ts`
- [X] T018 [US2] Create unit tests for Analyzer Service in `src/services/analyzer.test.ts`
- [X] T019 [P] [US2] Implement Notifier Service (`sendReport`) in `src/services/notifier.ts`
- [X] T020 [US2] Create unit tests for Notifier Service in `src/services/notifier.test.ts`
- [X] T021 [US2] Implement reporting core logic (batch analysis, decision) in `src/core/reporter.ts`
- [X] T022 [US2] Register `report` command in CLI entry point `src/index.ts`

## Phase 5: Polish & Cross-Cutting
*Goal: Finalize CLI and ensure reliability.*

- [X] T023 Finalize CLI entry point argument parsing in `src/index.ts`
- [X] T024 Create execution script `start.sh` for Cron usage
- [X] T025 Verify all tests pass and ensure no `any` types

## Dependencies

1. **Setup** (T001-T007) MUST be completed first.
2. **Foundational** (T008-T011) MUST be completed before User Stories.
3. **User Story 1** (T012-T016) depends on Storage Service (T010).
4. **User Story 2** (T017-T022) depends on Storage Service (T010) and indirectly on data produced by US1.

## Parallel Execution Opportunities

- **T006, T008, T009**: Can be implemented in parallel during Phase 1/2.
- **T012, T017, T019**: Service implementations (Crawler, Analyzer, Notifier) are independent of each other and can be parallelized once shared types/config are ready.

## Implementation Strategy

1. **MVP Scope**: Complete up to Phase 3 (US1) to have a working data collector.
2. **Full Feature**: Complete Phase 4 (US2) to enable analysis and reporting.
3. **Testing**: Run `vitest` frequently. Mock external API calls (NewsNow, OpenAI, SMTP) in tests.