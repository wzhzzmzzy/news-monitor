# Feature Specification: Multi-Day Analysis

**Feature Branch**: `002-multi-day-analysis`
**Created**: 2026-02-06
**Status**: Draft
**Input**: `docs/PRD-multi-day-analysis.md`

## 1. Core Goal
Enhance TrendRadar with time-span dimensions (3-7 days) to track trend lifecycles, filter noise, and correlate real-time stream data with hotlists.

## 2. Requirements

### Functional Requirements
- **FR-201**: Track duration and first-seen date for topics over 7 days.
- **FR-202**: Weight trends based on persistence (Duration-based Weighting).
- **FR-203**: Support separate polling for "Stream" (30m) vs "Hotlist" (2h) sources.
- **FR-204**: Correlate Stream items as "evidence" for Hotlist topics.
- **FR-205**: Identify "Sentinel" trends present in Streams but not yet on Hotlists.

### Non-Functional Requirements
- **NFR-201**: Maintain file-based storage (no external DB).
- **NFR-202**: Analysis of 7-day history must be efficient (< 10s).

## 3. Success Criteria
- **SC-201**: Reports clearly state "Duration: X days" for recurring topics.
- **SC-202**: Stream data correctly links to relevant Hotlist trends.
