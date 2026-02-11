# Research & Decisions: Multi-Day Analysis

## 1. Storage Access Strategy

**Problem**: Analyzing trends over 3-7 days requires reading files from multiple date-partitioned directories (`archive/YYYY-MM-DD`).
**Decision**: Implement `getRange(startDate, endDate)` in `StorageService`.
**Rationale**: 
- Keeps storage logic encapsulated.
- Simple iteration over dates using `date-fns`.
- Graceful handling of missing days (skip or warn).
**Alternatives**:
- specialized DB (SQLite): Rejected for **Simplicity** (Principle I).
- Symbolic links: Rejected as fragile.

## 2. Configuration Structure

**Problem**: PRD distinguishes between "Hotlist" (polls every 2h) and "Stream" (polls every 30m) sources.
**Decision**: Split `config.yaml` sources.
```yaml
hotlist_sources:
  - id: weibo-hot
    ...
stream_sources:
  - id: telegram-flash
    ...
```
**Rationale**: Explicit separation allows different scheduling strategies and analysis logic.
**Migration**: Backward compatibility support for old `sources` key (map to `hotlist_sources`).

## 3. Data Persistence (Core Summary)

**Problem**: Need efficient "Memory" of past trends without parsing full raw HTML/JSON archives.
**Decision**: Save a structured `daily-summary.json` at the end of each day (or analysis cycle).
**Format**:
```typescript
interface DailySummary {
  date: string;
  topics: {
    title: string;
    keywords: string[];
    max_score: number;
    first_seen: string; // ISO timestamp
    sources: string[];
  }[];
}
```
**Rationale**: Lightweight JSON is fast to read/parse for 7-day windows.

## 4. Context Window & AI Processing

**Problem**: Feeding 7 days of full reports to OpenAI might exceed context limits or cost too much.
**Decision**: Pre-processing Step ("Map-Reduce" style).
1. **Map**: Load 7 days of `daily-summary.json`.
2. **Reduce (Deterministic)**: Programmatically link topics by keywords/similarity (Duration Tracking) *before* sending to AI.
3. **AI Input**: Send only the *linked* trend chains (e.g., "Topic A: Seen Day 1, 2, 3") to AI for narrative generation.
**Rationale**: Drastically reduces token usage. AI focuses on *interpreting* the trend, not *finding* it (which is better done by code).

## 5. Scheduler Logic

**Problem**: Different polling intervals.
**Decision**: 
- Main loop runs every 30m (minimum common denominator).
- Check `last_run_hotlist` timestamp. If > 2h, run Hotlist Crawler + Analysis.
- Always run Stream Crawler.
**Rationale**: Simple single-process loop.