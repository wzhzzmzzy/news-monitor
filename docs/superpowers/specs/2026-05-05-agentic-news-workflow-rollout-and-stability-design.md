# Agentic News Workflow Rollout And Stability Design

Date: 2026-05-05

## Purpose

This document extends `2026-04-29-agentic-news-workflow-design.md` with rollout, cost-control, and determinism requirements. The original workflow design remains the target architecture. This document hardens the migration path so the new workflow can be enabled gradually, compared against the legacy report path, and rolled back quickly if quality, cost, or stability regress.

The additions focus on three goals:

- Support A/B testing, shadow runs, and fast rollback to the existing report path.
- Reduce model usage by batching by time window, limiting prompt inputs, caching model node results, and keeping low-value nodes deterministic.
- Reduce uncontrolled model judgment in scoring and report construction by making rankings reproducible, schema-bound, and evidence-backed.

## Relationship To The Original Design

This is a supplemental rollout and stability layer. It does not replace the original workflow layers, node names, artifact model, or migration boundary for `Reporter`.

The original design introduces the agentic workflow. This document constrains how that workflow is introduced:

- The legacy analyzer path must remain runnable while the workflow path is being validated.
- The workflow path must be able to run as a non-delivering secondary path.
- LLM-backed nodes must be limited to places where model judgment adds clear value.
- Topic ranking must be explainable and reproducible without model calls.
- Each workflow run must expose usage, cache, comparison, and scoring metadata.

## Rollout Modes And A/B Testing

Add an explicit report workflow mode:

```ts
type ReportWorkflowMode =
  | 'legacy'
  | 'workflow'
  | 'shadow'
  | 'ab'
```

Mode behavior:

- `legacy`: run only the current analyzer/report path. This is the default rollback mode.
- `workflow`: run only the new workflow path and deliver its report.
- `shadow`: run the legacy path as the delivering path and run the workflow path as a secondary non-delivering path. Save artifacts and comparison metrics for the workflow run.
- `ab`: select a primary path using deterministic experiment assignment. Run the selected path for delivery and optionally run the other path as a secondary comparison path when comparison is enabled.

The primary report path is the only path allowed to save the final delivered report and send notification. Secondary paths may write artifacts, comparison reports, and internal diagnostics, but they must not send email or overwrite the delivered report.

### Experiment Assignment

A/B assignment must be deterministic so the same report date and experiment configuration choose the same path.

Recommended assignment key:

```txt
experimentName + reportMode + anchorDate + runPurpose
```

For scheduled daily reports, `anchorDate` is enough to provide stable daily assignment. For manual backfills or repeated local comparisons, include `runId` only when the caller explicitly wants a fresh assignment.

Suggested config:

```ts
interface WorkflowRolloutConfig {
  reportWorkflowMode: ReportWorkflowMode
  experimentName?: string
  workflowTrafficPercent: number
  runSecondaryComparison: boolean
  fallbackToLegacyOnWorkflowFailure: boolean
  failClosedOnComparisonError: boolean
}
```

Recommended defaults:

```txt
reportWorkflowMode: legacy
workflowTrafficPercent: 0
runSecondaryComparison: false
fallbackToLegacyOnWorkflowFailure: true
failClosedOnComparisonError: false
```

`fallbackToLegacyOnWorkflowFailure` applies only when the workflow path is the primary path. If the workflow fails before it can produce a valid renderable report, `Reporter` should run the legacy path, deliver the legacy report, and record the fallback in the workflow run metadata.

### Dual-Run Comparison

When both paths run for the same input, write a comparison artifact:

```txt
archive/{anchorDate}/workflow-runs/{runId}/comparison.json
```

The comparison artifact should include:

- selected primary path
- delivered path
- whether fallback occurred
- legacy report artifact references
- workflow report artifact references
- topic overlap metrics
- score movement metrics
- claim count movement
- rendering status for each path
- node-level degraded status for the workflow path
- usage and cache metrics for workflow model nodes

## LLM Usage Strategy

The workflow should optimize for fewer, higher-value model calls. The model should see compact, ranked windows rather than individual raw items.

### Batch By Window

The batching unit is a timeline window, not a single news item.

Initial daily settings:

```txt
dailyWindowHours: 4
maxItemsPerWindow: 80
maxPromptNewsItems: 40
```

Rules:

- `dailyWindowHours: 4`: build one timeline window per 4-hour period.
- `maxItemsPerWindow: 80`: if a window has more than 80 items, keep the 80 hottest items in the window artifact and record the truncation count.
- `maxPromptNewsItems: 40`: send at most 40 representative items to model-backed nodes.
- Items outside `maxPromptNewsItems` remain in deterministic processing. They are not deleted and may still contribute rank, source distribution, duplicate grouping, and evidence chains.
- The prompt input must be sorted deterministically before hashing or calling the model.

Recommended deterministic sort before truncation:

```txt
hotness desc, maxRank asc, occurrences desc, sourceCount desc, firstSeen asc, newsId asc
```

This keeps the prompt budget focused on the strongest signal while keeping output reproducible.

### Which Nodes Use LLM

The first implementation should use model calls only where they provide clear signal improvement.

| Node | Phase | Strategy |
| --- | --- | --- |
| `annotateSignals` | Phase 1 / MV | Use LLM. This is the core model-backed value: source-bias risk, duplicate noise hints, cross-source signal, long-tail signal, and breaking signal labels. |
| `extractTopics` | Phase 2 | Do not require LLM initially. Reuse existing `keyInfo` and deterministic topic construction for Phase 1. Optional shadow-only topic extraction may be used for evaluation. |
| `rankTopics` | Phase 1 | Do not use LLM. Use a documented deterministic formula. |
| `buildClaims` | Phase 2 | Use LLM only for the top 6 topics after deterministic ranking. It should generate evidence-backed claims, not rerank topics. |

`buildClaims` may be implemented as a new analysis sub-node or as a constrained replacement for the claim-building part of `analyzeTopics`. Either way, the model should only receive already-selected top topics and their supporting evidence.

### Model Node Defaults

All production model calls should start with:

```txt
temperature: 0
```

Prompts must not include wall-clock time, current run time, or nondeterministic ordering. The caller should provide stable window boundaries, sorted IDs, and normalized source names.

## Cache Consistency

Model node outputs must be cacheable by canonical input. The cache key must include the node, prompt, schema, model, and canonicalized input.

Required cache key dimensions:

```txt
nodeName
nodeVersion
promptVersion
schemaVersion
model
canonicalInputHash
```

The canonical input hash must be computed after input normalization:

- sort `newsId` lists
- sort source IDs and source names
- use stable `windowStart` and `windowEnd`
- remove wall-clock fields such as `startedAt`
- remove run-specific IDs that do not affect model reasoning
- serialize with stable object key order

Cache hits and misses should be recorded per node in `run.json`.

Suggested metadata:

```ts
interface ModelUsageMetadata {
  nodeName: string
  model: string
  cacheKey: string
  cacheStatus: 'hit' | 'miss' | 'bypass' | 'write_failed'
  promptItemCount: number
  inputTokenCount?: number
  outputTokenCount?: number
  estimatedCost?: number
  temperature: number
}
```

Cache reads are valid only when every cache key dimension matches. A prompt, schema, node, or model version change must produce a new cache key.

## Stable Scoring And Deterministic Ranking

`rankTopics` must remain deterministic. The model may annotate evidence but must not directly assign final topic scores.

### Replace Free-Form Weighting

The original design allows `SignalAnnotation.weightAdjustment`. To reduce model freedom, Phase 1 should avoid arbitrary model-provided numeric weight adjustments.

Recommended Phase 1 shape:

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
  reason: string
  confidence: number
}
```

`rankTopics` converts labels and confidence into bounded score adjustments through code-owned rules.

Example adjustment rules:

```txt
duplicate_noise: -4 when confidence >= 0.7
source_bias_risk: -3 when confidence >= 0.7
cross_source_signal: +5 when confidence >= 0.6
long_tail_signal: +3 when confidence >= 0.7
breaking_signal: +6 when confidence >= 0.6
```

The exact values can change with a `rankingFormulaVersion`, but the formula must be documented, tested, and captured in artifacts.

### Topic Score Formula

`rankTopics` should calculate:

```txt
adjustedScore = clamp(baseScore + deterministicSignalAdjustment, 0, 100)
```

`baseScore` is computed from deterministic facts:

- hourly `keyInfo.heatScore`
- best observed rank
- occurrence count
- source count
- sustained window count
- freshness within the report range

`deterministicSignalAdjustment` is computed from validated signal labels, confidence thresholds, duplicate groups, and source distribution. Duplicate groups must not multiply score boosts. When several supporting IDs are in the same duplicate group, count the representative item normally and treat the remaining members as corroborating links.

### Scoring Artifact

Each topic candidate should include score explanation fields:

```ts
interface TopicScoreBreakdown {
  rankingFormulaVersion: string
  baseScore: number
  signalAdjustment: number
  adjustedScore: number
  factors: {
    keyInfoHeatScore?: number
    bestRank?: number
    occurrences?: number
    sourceCount?: number
    sustainedWindowCount?: number
    freshness?: number
  }
  appliedSignalLabels: Array<{
    label: SignalAnnotation['labels'][number]
    newsIds: string[]
    adjustment: number
    confidence: number
  }>
}
```

This makes ranking changes inspectable without reading model prose.

## Version Comparison Metrics

When comparing legacy and workflow output, or comparing two workflow versions, use deterministic metrics before human review.

Required metrics:

- Jaccard overlap for top topics.
- Score delta for matched topics.
- Claim count delta for matched topics.

Recommended definitions:

```txt
topTopicJaccard = intersection(topN legacy topic keys, topN workflow topic keys)
                  / union(topN legacy topic keys, topN workflow topic keys)

scoreDelta = workflow.adjustedScore - baseline.score

claimCountDelta = workflow.supportingClaims.length - baseline.claimCount
```

Topic keys should be stable and evidence-based where possible:

```txt
normalizedTitle + sorted top supportingNewsIds
```

If a legacy report has no direct `supportingNewsIds`, compare by normalized title and source/time overlap, and mark the match as approximate.

Suggested thresholds for manual review:

```txt
topTopicJaccard < 0.5
abs(scoreDelta) > 20 for any top 5 matched topic
claimCountDelta < -2 for any top 5 matched topic
workflow delivered topic count < legacy delivered topic count by more than 30%
```

These thresholds should produce review signals, not automatic failures, until enough comparison data exists.

## Artifact Additions

Extend `run.json` with rollout and usage metadata:

```ts
interface WorkflowRunMetadata {
  rollout?: {
    mode: ReportWorkflowMode
    experimentName?: string
    assignmentKey?: string
    assignedPath: 'legacy' | 'workflow'
    deliveredPath: 'legacy' | 'workflow'
    secondaryPath?: 'legacy' | 'workflow'
    fallbackUsed: boolean
    fallbackReason?: string
  }
  modelUsage?: ModelUsageMetadata[]
  rankingFormulaVersion?: string
}
```

Add optional artifacts:

```txt
11-score-breakdown.json
12-model-usage.json
13-comparison.json
```

`12-model-usage.json` may duplicate the summarized `run.json` usage metadata with more detailed per-request information.

## Configuration Additions

Recommended config fields:

```ts
interface WorkflowStabilityConfig {
  reportWorkflowMode: ReportWorkflowMode
  workflowTrafficPercent: number
  runSecondaryComparison: boolean
  fallbackToLegacyOnWorkflowFailure: boolean
  failClosedOnComparisonError: boolean
  llmTemperature: number
  enableModelCache: boolean
  dailyWindowHours: number
  maxItemsPerWindow: number
  maxPromptNewsItems: number
  enableLlmAnnotateSignals: boolean
  enableLlmExtractTopics: boolean
  enableLlmBuildClaims: boolean
  buildClaimsTopTopicCount: number
  rankingFormulaVersion: string
}
```

Recommended Phase 1 values:

```txt
reportWorkflowMode: legacy
workflowTrafficPercent: 0
runSecondaryComparison: true for manual validation, false for unattended production
fallbackToLegacyOnWorkflowFailure: true
failClosedOnComparisonError: false
llmTemperature: 0
enableModelCache: true
dailyWindowHours: 4
maxItemsPerWindow: 80
maxPromptNewsItems: 40
enableLlmAnnotateSignals: true
enableLlmExtractTopics: false
enableLlmBuildClaims: false
buildClaimsTopTopicCount: 6
rankingFormulaVersion: v1
```

## Testing Strategy

Unit tests:

- Canonical input hashing is stable across object key order, source order, and news ID order.
- Cache keys change when node, prompt, schema, model, or canonical input changes.
- Window batching creates 4-hour windows and respects `maxItemsPerWindow`.
- Prompt item selection respects `maxPromptNewsItems` and deterministic hotness sorting.
- `rankTopics` produces identical scores for identical inputs and does not call the LLM.
- Duplicate groups do not multiply score boosts.
- Signal labels are converted to bounded deterministic score adjustments.

Workflow tests:

- `legacy` mode runs only the legacy path.
- `workflow` mode runs only the workflow path and delivers the workflow report.
- `shadow` mode delivers the legacy report and writes workflow artifacts without sending a second notification.
- `ab` mode assigns the same path for the same assignment key.
- Workflow primary failure falls back to legacy when fallback is enabled.
- Secondary comparison failure does not block delivery when `failClosedOnComparisonError` is false.

Regression tests:

- Phase 1 workflow can produce topic candidates using existing `keyInfo` without LLM topic extraction.
- `annotateSignals` cache hits avoid repeated model calls for unchanged canonical inputs.
- Comparison artifacts include Jaccard overlap, score delta, and claim count delta.

## Implementation Sequence

1. Add rollout config and `ReportWorkflowMode`.
2. Split `Reporter` daily execution into primary path selection and optional secondary comparison path.
3. Add shadow mode with legacy delivery and workflow artifacts.
4. Add deterministic A/B assignment and comparison artifact writing.
5. Implement canonical input hashing and model node cache keys.
6. Add model usage metadata collection for `LLMClient`.
7. Enforce 4-hour window batching, `maxItemsPerWindow`, and `maxPromptNewsItems`.
8. Limit Phase 1 LLM usage to `annotateSignals`.
9. Move `rankTopics` to a deterministic formula with score breakdown artifacts.
10. Add comparison metrics: Jaccard overlap, score delta, and claim count delta.
11. Add Phase 2 gates for `extractTopics` and `buildClaims`.

## Success Criteria

- Operators can switch from workflow delivery back to legacy delivery with one config change.
- Shadow runs can compare workflow output against legacy output without changing delivered reports.
- Phase 1 production model usage is limited to window-level `annotateSignals` calls.
- Repeated runs with unchanged canonical inputs reuse cached model outputs.
- Topic scores are reproducible from artifacts without calling a model.
- Version comparisons expose topic overlap, score movement, and claim count movement.
- Workflow instability degrades to legacy delivery rather than blocking report delivery when fallback is enabled.
