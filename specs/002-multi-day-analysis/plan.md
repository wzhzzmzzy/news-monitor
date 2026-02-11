# Implementation Plan: Multi-Day Analysis

**Branch**: `002-multi-day-analysis` | **Date**: 2026-02-06 | **Spec**: specs/002-multi-day-analysis/spec.md
**Input**: Feature specification from `specs/002-multi-day-analysis/spec.md`

## Summary

Refactor TrendRadar to support Multi-Day Analysis (3-7 days) for identifying long-term trends and filtering noise. Key features include:
1.  **Duration Tracking**: Track how many days a topic has been active.
2.  **Duration-based Weighting**: Boost ranking for long-running trends; filter short-term noise.
3.  **Auxiliary Stream Analysis**: Correlate real-time stream data (Telegram, Flash News) with Hotlist topics.
4.  **Sentinel Watch**: Identify potential trends in Streams before they hit Hotlists.

The system will maintain backward compatibility with the file-based storage while enabling cross-day queries.

## Technical Context

**Language/Version**: Node.js 22 (TypeScript 5.x)
**Primary Dependencies**: `cac`, `zod`, `ofetch`, `openai`, `nodemailer`, `date-fns`
**Storage**: File-based (JSON), partitioned by date (e.g., `archive/YYYY-MM-DD/`)
**Testing**: `vitest`
**Target Platform**: Node.js CLI / Server (running via Crontab)
**Project Type**: CLI / Background Service
**Performance Goals**: Process 7 days of history (< 50MB) in < 10s.
**Constraints**: Must run in a low-resource environment (locally hosted). No external database.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Simplicity**: File-based storage avoids DB complexity. Logic relies on simple date iteration. (Principle I)
- [x] **Modularity**: New logic (Multi-day) is separated from Daily Crawler. (Principle II)
- [x] **FP Paradigm**: Analysis logic will be pure functions; Storage remains Class-based for DI consistency. (Principle II)
- [x] **Testability**: Logic for "Duration Weighting" and "Sentinel Watch" is pure and testable. (Principle III)
- [x] **Type Safety**: New data models will be Zod-validated. (Principle IV)

## Project Structure

### Documentation (this feature)

```text
specs/002-multi-day-analysis/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (Services & Data interfaces)
│   └── service-contracts.ts
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── index.ts              # CLI Entry point
├── core/
│   ├── config.ts         # Updated Config (Stream vs Hotlist)
│   ├── monitor.ts        # Scheduling logic
│   └── reporter.ts       # Report generation
├── services/
│   ├── analyzer.ts       # UPDATED: Multi-day analysis logic
│   ├── crawler.ts        # UPDATED: Support for Stream sources
│   ├── notifier.ts       # Email sending
│   └── storage.ts        # UPDATED: Cross-day file reading
├── schema/
│   └── config.ts         # Zod schemas
├── types/
│   └── index.ts          # Shared types
└── utils/
    └── date.ts           # Date helpers (new?)
```

**Structure Decision**: enhance existing `src/services` and `src/core` modules.

## Complexity Tracking

N/A
