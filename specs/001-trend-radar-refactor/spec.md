# Feature Specification: TrendRadar Refactor

**Feature Branch**: `001-trend-radar-refactor`  
**Created**: 2026-02-06  
**Status**: Final  
**Input**: PRD, Data Source Guide

## User Scenarios & Testing

### User Story 1 - Hourly Monitoring (Priority: P1)
As a user, I want the system to automatically fetch news from multiple sources every hour so that hot topics are captured in real-time.

**Acceptance Scenarios**:
1. **Given** a list of sources (weibo, zhihu), **When** the crawler runs, **Then** raw data is saved and deduplicated in the daily index.
2. **Given** one source (e.g., zhihu) is down, **When** the crawler runs, **Then** it SHOULD skip zhihu, log the error, but successfully process weibo.

### User Story 2 - Automated Analysis (Priority: P1)
As a user, I want the system to extract keywords hourly and generate a summarized report daily so that I can see trends without reading thousands of headlines.

**Acceptance Scenarios**:
1. **Given** new headlines in the index, **When** hourly analysis triggers, **Then** keywords are extracted via LLM and saved.

## Requirements

### Functional Requirements
- **FR-001**: System MUST fetch data from `NewsNow` API endpoints.
- **FR-002**: System MUST handle source failures gracefully (log and skip).
- **FR-003**: System MUST deduplicate news based on URL and Title.
- **FR-004**: System MUST perform two-stage LLM analysis (Hourly -> Daily).
- **FR-005**: System MUST send Markdown reports via SMTP.

### Success Criteria
- **SC-001**: 100% of reachable news sources are archived hourly.
- **SC-002**: Zero "any" types in the codebase.
- **SC-003**: All core logic covered by unit tests.
