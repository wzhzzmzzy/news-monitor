# Research: Dynamic Historical Analysis

## Prompt Strategy for Historical Evolution

### Goal
To enable LLM to summarize how a topic evolved over a 2-7 day period (起源 -> 爆发 -> 现状/反转).

### Decision
Use a "Two-Pass" or "Grouped" approach for the prompt:
1. **Data Pre-processing**: Group `HourlyBatchResult` by Date.
2. **Evolution Insight Prompt**:
   - Provide the LLM with a list of daily top topics and their summarized heat scores.
   - Specifically ask for a "Timeline" of key events.
   - Constraint: Must mention specific dates or relative time (e.g., "Day 1", "Day 3").

### Rationale
Passing raw 1-hour batches for 7 days (168 batches) might exceed token limits or cause the LLM to lose focus. Providing daily summaries ensures the LLM sees the "big picture" first.

## Local Time Logging (Pino-Pretty)

### Decision
Update `translateTime` in `src/utils/logger.ts` from default (UTC) to `SYS:yyyy-mm-dd HH:MM:ss`.

### Rationale
The `SYS:` prefix in `pino-pretty` (using `date-format` library internally) forces the use of system local time instead of UTC.

## Date Parsing & Validation

### Decision
Use `date-fns` for all interval calculations.
Input format `yy-mm-dd hh:MM` will be parsed using `parse(str, 'yy-MM-dd HH:mm', new Date())`.

### Alternatives Considered
- Using native `Date` parser: Rejected because `yy-mm-dd` is ambiguous in some locales.
- Using `moment`: Rejected as it's deprecated and `date-fns` is already in the project.
