# Agentic News Workflow Design

Date: 2026-04-29

## Purpose

This design moves the news monitor from a single large analysis service toward an agentic workflow. The first implementation should cover the existing daily report path while preserving current report delivery behavior. The longer-term direction is to let model-backed workflow nodes handle richer preprocessing, topic construction, report planning, and compliant email drafting.

The core principle is:

> Front-loaded workflow nodes improve the signal-to-noise ratio of timeline data without rewriting facts. Downstream analysis nodes consume cleaner, traceable signal layers so they can produce more valuable topic analysis.

## Current Coupling Points

The current code has three important boundaries:

- `Reporter` orchestrates reporting, persistence, and notification.
- `AnalyzerService` currently carries too much responsibility: batch analysis, topic selection, topic detail analysis, summary generation, trend detection, and report generation.
- The existing renderer can be reused once the workflow produces the same report data shape, or a compatible successor shape.

The migration must respect these boundaries instead of replacing the whole pipeline at once.

## Scope

Initial scope:

- Replace direct `ai` / `@ai-sdk/openai` usage with a local `LLMClient` based on the official OpenAI SDK.
- Add workflow data structures, runner, artifacts, and initial nodes.
- Route daily report generation through the workflow.
- Keep existing renderer and hourly `HourlyBatchResult.keyInfo` as compatibility inputs.
- Add timeline, signal annotation, and signal merge artifacts for historical reports, while deep historical analysis may continue to reuse existing logic in the first phase.

Out of scope for the first implementation:

- Full autonomous agent planning.
- Replacing SMTP delivery.
- Replacing all historical report analysis logic.
- Deleting old analyzer methods before the workflow path has equivalent test coverage.

## Provider Compatibility Boundary

The first `LLMClient` guarantees OpenAI-compatible HTTP behavior, not full multi-provider parity.

- `openai`: supported through the official OpenAI SDK.
- `deepseek`: supported through `llmBaseUrl` when the configured endpoint is OpenAI-compatible.
- `anthropic`: not supported by the initial `LLMClient` unless an OpenAI-compatible proxy is configured. If `llmProvider` is `anthropic` without a compatible `llmBaseUrl`, startup or first model call should fail with a clear configuration error.

Structured output mode remains explicit:

- `auto`: use Responses structured output when supported.
- `json`: request JSON output and validate with Zod, using repair only as a fallback.
- `tool`: reserved for providers or models that need tool-call style structured output; it may be left unimplemented initially if the error is clear.

This avoids a hidden behavior change where SDK migration silently drops provider support.

## Workflow Input Contract

All report workflows receive a single `WorkflowInput` so daily and historical flows are explicit.

```ts
interface WorkflowInput {
  runId: string
  mode: 'daily' | 'historical'
  range: {
    start: string
    end: string
    reportDate?: string
  }
  batches: HourlyBatchResult[]
  newsIndex: Record<string, NewsIndexItem>
  sourceNames: Record<string, string>
  config: {
    llmProvider: Config['llmProvider']
    llmModel: string
    llmStructuredOutputMode: 'auto' | 'json' | 'tool'
    analysisWindowDays: number
    dailyWindowHours: number
    historicalWindowHours: number
    maxItemsPerWindow: number
    maxPromptNewsItems: number
  }
}
```

`batches` are not optional. Existing hourly `keyInfo` is a high-value seed signal and must remain part of topic construction. `newsIndex` provides the fact layer and links. A node may degrade if either input is sparse, but it must record that degradation in its artifact.

Windowing defaults should be explicit so nodes do not invent their own context budgets:

- `dailyWindowHours`: 4
- `historicalWindowHours`: 12
- `maxItemsPerWindow`: 80
- `maxPromptNewsItems`: 40

`maxItemsPerWindow` controls deterministic slicing and artifact size. `maxPromptNewsItems` controls how many representative items a model-backed node may receive from a slice after duplicate grouping and ranking. The omitted items remain in artifacts and may still support later evidence chains.

## Migration Boundary For Reporter

To avoid double preprocessing, `Reporter.runDailyReport()` should stop independently performing analysis transformations once the workflow owns them.

Daily phase 1 behavior:

1. `Reporter` loads `keywords.json` and `index.json`.
2. `Reporter` builds `WorkflowInput`.
3. `DailyReportWorkflow` runs aggregation, trend detection, timeline construction, signal annotation, topic construction, analysis, and report planning as workflow nodes.
4. `Reporter` saves the workflow-produced daily summary artifact through `saveDailySummary()`.
5. `Reporter` saves the rendered report and sends notification.

This means `aggregateToDaily()` and `detectMultiDayTrends()` move behind workflow nodes for the daily path. They may initially wrap the existing analyzer methods, but their execution and artifacts are owned by the workflow.

Historical phase 1 behavior:

1. `Reporter` loads range batches and range news index.
2. `HistoricalReportWorkflow` builds timeline, signal packs, and merged signal packs.
3. Existing historical deep analysis may be reused after consuming the merged signal data where practical.
4. The workflow records which historical steps still use legacy analysis.

This keeps daily behavior coherent while allowing historical reporting to migrate safely.

## Architecture

Recommended module layout:

```txt
src/services/llm/
  client.ts
  schemas.ts

src/workflow/
  types.ts
  runner.ts
  artifacts.ts

src/workflow/nodes/
  aggregateDaily.ts
  detectTrends.ts
  buildTimeline.ts
  scanDuplicates.ts
  annotateSignals.ts
  buildSignalPack.ts
  mergeSignalPacks.ts
  extractTopics.ts
  rankTopics.ts
  analyzeTopics.ts
  planReport.ts
  renderReport.ts
```

`AnalyzerService` should be gradually split into these nodes. During migration, workflow nodes may call existing analyzer methods, but the public orchestration should live in the workflow.

## Workflow Layers

### Raw Collection Layer

Existing crawler and monitor behavior remains responsible for fetching hotlists and streams and updating storage.

### Fact Timeline Layer

Nodes:

- `aggregateDaily`
- `detectTrends`
- `buildTimeline`

This layer is deterministic where possible. It preserves raw facts and builds small time slices. It must not call a model to change titles, links, sources, ranks, `firstSeen`, `lastSeen`, or occurrence counts.

`buildTimeline` consumes both `newsIndex` and `HourlyBatchResult.keyInfo` so it can retain the current topic seeds while building factual windows.

`buildTimeline` is also responsible for validating `keyInfo.newsIds` before any downstream node consumes topic seeds:

- Every `keyInfo.newsIds` value must be checked against `WorkflowInput.newsIndex`.
- Valid IDs are retained as factual links between topic seeds and raw news.
- Missing IDs are removed from that seed and recorded in the timeline artifact as `qualityFlags`.
- A topic seed with no valid `newsIds` may remain as a weak seed for compatibility, but it must be marked with a quality flag and cannot be used as sole evidence for a topic, claim, or sustained signal.

### Signal Preparation Layer

Nodes:

- `scanDuplicates`
- `annotateSignals`
- `buildSignalPack`
- `mergeSignalPacks`

This layer reduces noise without deleting facts. It has conservative behavior:

- Similar raw news items may be grouped as duplicate candidates.
- Model annotations may label source bias risk, duplicate noise, cross-source signal, long-tail signal, or breaking signal.
- Weight adjustments affect ranking and context budget, not existence.
- Every annotation must reference input IDs and include confidence.

`scanDuplicates` operates at the raw news item level, not the topic level. Its input is `TimelineSlice.items`; its output groups `newsIds` that appear to describe the same underlying item or near-identical repost. Topic-level consolidation belongs to `extractTopics` and `rankTopics`, where multiple raw duplicate groups may support the same broader topic without being collapsed into a single news item.

`annotateSignals` runs on small windows. It must not receive a whole multi-day corpus as one prompt. `mergeSignalPacks` is a formal node that combines window-level signal packs, preserves each window's evidence chain, identifies sustained signals, and avoids pushing cross-window responsibilities into `extractTopics`.

### Topic Construction Layer

Nodes:

- `extractTopics`
- `rankTopics`

This layer turns merged signal data and hourly seeds into topic candidates. Every topic must include:

- `supportingNewsIds`
- supporting window references
- source distribution
- time span
- attention-risk notes when the topic is heavily driven by one traffic-heavy source
- retention reason when the topic is still important despite attention-risk signals

`supportingNewsIds` must be a subset of input IDs. Invalid IDs are a schema or validation failure.

`rankTopics` owns the topic score calculation. `baseScore` comes from deterministic inputs such as hourly `keyInfo.heatScore`, max rank, source count, occurrence count, and sustained window count. `adjustedScore` is derived from `baseScore` plus the aggregate of `SignalAnnotation.weightAdjustment` for the topic's `supportingNewsIds`.

The aggregation rule should be deterministic and documented in code. Phase 1 should use a bounded additive adjustment:

```txt
adjustedScore = clamp(baseScore + sum(weightAdjustment for supportingNewsIds), 0, 100)
```

Duplicate groups should not multiply weight. When several supporting IDs are in the same duplicate group, `rankTopics` should count the representative item normally and treat the remaining duplicate members as corroborating links, not independent score boosts.

### Analysis Layer

Nodes:

- `analyzeTopics`
- existing historical evolution analysis during phase 1

This layer performs deeper interpretation after preprocessing. Each key claim in `TopicAnalysis` should be represented as:

```ts
interface SupportedClaim {
  claim: string
  supportingNewsIds: string[]
  confidence: number
}
```

This prevents attractive but untraceable prose from becoming the report's analytical backbone.

### Report Layer

Nodes:

- `planReport`
- `renderReport`

`planReport` creates the report structure, section ordering, topic emphasis, and email framing. It should produce a structured report plan instead of final HTML. `renderReport` uses the existing renderer where possible.

Future nodes may add style review, compliance review, and email quality checks.

## Core Data Shapes

### TimelineSlice

```ts
interface TimelineSlice {
  windowStart: string
  windowEnd: string
  newsIds: string[]
  topicSeedIds: string[]
  items: Array<{
    id: string
    title: string
    sources: string[]
    firstSeen: string
    lastSeen: string
    maxRank: number
    occurrences: number
  }>
  topicSeeds: Array<{
    seedId: string
    topic: string
    heatScore: number
    newsIds: string[]
    category: string
  }>
}
```

`topicSeedIds` must be derived from `topicSeeds[].seedId`; it exists as a compact reference list for downstream artifacts and must not contain IDs absent from `topicSeeds`.

### SignalPack

```ts
interface SignalAnnotation {
  newsId: string
  labels: Array<
    | 'duplicate_noise'
    | 'source_bias_risk'
    | 'cross_source_signal'
    | 'long_tail_signal'
    | 'breaking_signal'
  >
  weightAdjustment: number
  reason: string
  confidence: number
}

interface SignalPack {
  windowStart: string
  windowEnd: string
  duplicateGroups: Array<{
    groupId: string
    newsIds: string[]
    representativeNewsId: string
    reason: string
    confidence: number
  }>
  annotations: SignalAnnotation[]
  timelineNotes: Array<{
    time: string
    eventHint: string
    supportingNewsIds: string[]
  }>
}
```

### MergedSignalPack

```ts
interface MergedSignalPack {
  rangeStart: string
  rangeEnd: string
  sourceWindowCount: number
  duplicateGroups: SignalPack['duplicateGroups']
  sustainedSignals: Array<{
    titleHint: string
    windowRefs: string[]
    supportingNewsIds: string[]
    sourceIds: string[]
    score: number
    reason: string
  }>
  annotationsByNewsId: Record<string, Array<SignalAnnotation & { windowRef: string }>>
  qualityFlags: string[]
}
```

### TopicCandidate

```ts
interface TopicCandidate {
  title: string
  supportingNewsIds: string[]
  supportingClaims: SupportedClaim[]
  sourceDistribution: Record<string, number>
  windowRefs: string[]
  baseScore: number
  adjustedScore: number
  attentionRisk: 'low' | 'medium' | 'high'
  retentionReason: string
}
```

## Artifact And Reproducibility Requirements

Each workflow run writes artifacts under:

```txt
archive/{anchorDate}/workflow-runs/{runId}/
  run.json
  01-input.json
  02-daily-summary.json
  03-timeline-slices.json
  04-duplicate-candidates.json
  05-signal-packs.json
  06-merged-signal-pack.json
  07-topic-candidates.json
  08-topic-analyses.json
  09-report-plan.json
  10-report.html
```

`anchorDate` is the report date for daily workflows and the range end date for historical workflows, formatted as `yyyy-MM-dd`. This keeps artifacts inside the existing `archiveDir` daily directory model while allowing `StorageService` to add workflow-specific helpers without introducing a separate project-root persistence path.

`run.json` contains:

```ts
interface WorkflowRunMetadata {
  runId: string
  mode: 'daily' | 'historical'
  inputHash: string
  configSnapshot: WorkflowInput['config']
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'degraded' | 'failed'
  model: string
  provider: string
  nodeVersions: Record<string, string>
  promptVersions: Record<string, string>
  degradedSteps: Array<{
    step: string
    errorRef: string
    fallbackUsed: string
    qualityFlags: string[]
  }>
}
```

Artifacts must be sufficient to compare old and new reports, replay a run with the same inputs, and attribute quality regressions to a specific node.

## Degraded Output Shape

Each node returns a `StepResult<T>`:

```ts
interface StepResult<T> {
  status: 'success' | 'degraded' | 'failed'
  output: T
  artifactPath: string
  errorRef?: string
  fallbackUsed?: string
  qualityFlags: string[]
}
```

Expected fallbacks:

- `annotateSignals` failure: use deterministic duplicate candidates and neutral annotations.
- `mergeSignalPacks` failure: concatenate window-level packs and add a quality flag.
- `extractTopics` failure: fall back to existing hourly `keyInfo` aggregation.
- `analyzeTopics` failure for one topic: skip that topic and record the failed topic ID/title.
- `planReport` failure: use a default report plan sorted by adjusted score.

`renderReport` may show no user-facing warning by default, but degraded metadata must be recorded in artifacts.

## Model Node Rules

Every model node must enforce these rules through prompt text and validation:

1. It cannot change original fact fields.
2. It cannot delete news.
3. It can only add derived annotations, group suggestions, topic candidates, claims, and report planning.
4. Every judgment must cite `supportingNewsIds`.
5. Every `supportingNewsIds` array must be validated as a subset of the node input.
6. Weight reduction changes ranking and context budget only; it does not remove records from the workflow.
7. Major breaking stories must be retained when there is strong factual evidence such as cross-source presence, high rank, sustained time spread, or repeated independent mentions.

## Testing Strategy

Unit tests:

- `LLMClient` structured output parsing, JSON fallback, and clear provider errors.
- `buildTimeline` preserves facts and includes hourly topic seeds.
- `scanDuplicates` produces conservative duplicate candidates.
- `mergeSignalPacks` preserves window evidence and detects sustained signals.
- Validators reject topic candidates with nonexistent `supportingNewsIds`.

Workflow tests:

- Daily workflow produces a report from existing `HourlyBatchResult[]` and `newsIndex`.
- Daily workflow saves daily summary through the workflow path, with no duplicate `aggregateToDaily()` or `detectMultiDayTrends()` calls in `Reporter`.
- Failed signal annotation produces degraded artifacts and still renders a report.

Regression tests:

- Existing renderer output remains compatible with the report data produced by the workflow.
- Existing historical report path still works while timeline and signal artifacts are added.

## Implementation Sequence

1. Add `LLMClient` and replace direct `ai` package imports behind a local abstraction.
2. Add workflow types, artifact writer, and runner.
3. Add `WorkflowInput` creation in `Reporter`.
4. Implement deterministic nodes: `aggregateDaily`, `detectTrends`, `buildTimeline`, `scanDuplicates`.
5. Implement model-backed `annotateSignals` with conservative schema validation.
6. Implement `buildSignalPack` and `mergeSignalPacks`.
7. Implement topic construction nodes using merged signals and hourly seeds.
8. Route daily report through the workflow and reuse renderer.
9. Add historical timeline/signal/merge artifacts while keeping old deep analysis available.
10. Remove or shrink legacy analyzer methods only after equivalent workflow coverage exists.

## Success Criteria

- Daily reports can be generated through the workflow with existing storage inputs.
- No original news facts are modified or deleted by preprocessing.
- Intermediate artifacts make each report reproducible and debuggable.
- Topic candidates and analyses are traceable to input `newsIds`.
- Source-bias and duplicate-noise annotations reduce low-value repetition without suppressing genuine major signals.
- Historical reports gain timeline and signal artifacts without losing current report capability.
