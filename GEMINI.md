# Gemini Context: Multi-Day Analysis

**Active Feature**: `002-multi-day-analysis`
**Spec**: `specs/002-multi-day-analysis/spec.md`
**Plan**: `specs/002-multi-day-analysis/plan.md`

## Tech Stack
- **Runtime**: Node.js 22
- **Language**: TypeScript 5.x
- **Frameworks**: cac (CLI), vitest (Test), hono (Server)
- **Libs**: zod, ofetch, openai, nodemailer, date-fns, pino (Log), cron (Scheduler)

## Core Principles
1. **Simplicity**: No over-engineering.
2. **Functional**: FP over Classes.
3. **Type Safety**: No `any`.
4. **Reliability**: 5xx retries, exponential backoff.
