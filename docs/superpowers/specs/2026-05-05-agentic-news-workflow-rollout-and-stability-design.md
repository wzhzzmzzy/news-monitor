# Agentic News Workflow Rollout And Stability Design

Date: 2026-05-05

## Purpose

This document extends `2026-04-29-agentic-news-workflow-design.md` with rollout, cost-control, and determinism requirements. The original workflow design remains the target architecture. This document hardens the migration path so the new workflow can be enabled gradually, compared against the legacy report path, and rolled back quickly if quality, cost, or stability regress.

The additions focus on three goals:

- Support A/B testing, shadow runs, and fast rollback to the existing report path.
- Reduce model usage by batching by time window, limiting prompt inputs, caching model node results, and reserving model calls for signal annotation, topic discovery, and evidence-backed claims.
- Reduce uncontrolled model judgment in scoring and report construction by making topic discovery evidence-bound and final rankings formula-owned.

## Relationship To The Original Design

This is a supplemental rollout and stability layer. It does not replace the original workflow layers, node names, artifact model, or migration boundary for `Reporter`.

The original design introduces the agentic workflow. This document constrains how that workflow is introduced:

- The legacy analyzer path must remain runnable while the workflow path is being validated.
- The workflow path must be able to run as a non-delivering secondary path.
- LLM-backed nodes must be limited to places where model judgment adds clear value: signal annotation, topic discovery, and claim construction.
- The model may own topic discovery, but it does not own factual authority or final topic ranking.
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
maxTopicDiscoveryNewsItems: 120
maxTopicCandidates: 12
```

Rules:

- `dailyWindowHours: 4`: build one timeline window per 4-hour period.
- `maxItemsPerWindow: 80`: if a window has more than 80 items, keep the 80 hottest items in the window artifact and record the truncation count.
- `maxPromptNewsItems: 40`: send at most 40 representative items to model-backed nodes.
- `maxTopicDiscoveryNewsItems: 120`: when `extractTopics` runs at report level, send at most 120 representative items across all windows after signal packs are merged.
- `maxTopicCandidates: 12`: ask `extractTopics` for a bounded set of candidate topics before validation, merging, and ranking.
- Items outside `maxPromptNewsItems` or `maxTopicDiscoveryNewsItems` remain in deterministic processing. They are not deleted and may still contribute rank, source distribution, duplicate grouping, and evidence chains.
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
| `extractTopics` | Phase 1 | Use LLM. This is the main topic discovery node. Existing `keyInfo` is an input seed and regression reference, not the only source of topics. |
| `rankTopics` | Phase 1 | Do not call LLM. Use a documented formula that can consume validated model topic confidence as a bounded factor. |
| `buildClaims` | Phase 1 | Use LLM for the top 6 topics after formula-owned ranking. It should generate evidence-backed claims, not rerank topics. |

`buildClaims` may be implemented as a new analysis sub-node or as a constrained replacement for the claim-building part of `analyzeTopics`. Either way, the model should only receive already-selected top topics and their supporting evidence.

Expected Phase 1 daily call shape:

```txt
annotateSignals: one call per 4-hour window, usually up to 6 calls per day
extractTopics: one report-level call after signal packs are merged
buildClaims: one batched call for the top 6 topics, or up to 6 per-topic calls if batching hurts schema quality
rankTopics: zero model calls
renderReport: zero model calls
```

This gives the model real control over topic discovery while keeping the number of calls bounded by report structure instead of raw news volume.

### LLM-Led Topic Discovery

`extractTopics` should be a first-phase model node. Its job is to discover the report's topic candidates from the prepared signal layer, not merely re-rank existing `keyInfo` topics.

Inputs:

- `MergedSignalPack`, including sustained signals, duplicate groups, and annotations by news ID.
- Representative news items from the timeline, selected deterministically and capped by `maxTopicDiscoveryNewsItems`.
- Validated hourly `keyInfo` seeds as hints and legacy comparison anchors.
- Source names and source distribution summaries.
- Quality flags from earlier nodes.

`keyInfo` should influence topic discovery, but it must not constrain it. The model may:

- merge several noisy `keyInfo` seeds into one broader topic
- split one over-broad seed into multiple concrete topics
- discover a topic that is absent from `keyInfo`
- downplay a hot but low-substance repetition pattern
- retain a long-tail topic when the evidence suggests importance despite lower heat

Recommended output shape:

```ts
interface DiscoveredTopicCandidate {
  title: string
  summary: string
  whyItMatters: string
  supportingNewsIds: string[]
  supportingWindowRefs: string[]
  novelty: 'new' | 'continuing' | 'recurring'
  attentionRisk: 'low' | 'medium' | 'high'
  relationToKeyInfo: 'direct' | 'merged' | 'split' | 'absent'
  confidence: number
}
```

Model freedom is limited by evidence validation:

- Every `supportingNewsIds` value must be a subset of the node input.
- `supportingWindowRefs` must reference existing timeline windows.
- Source distribution and time span should be recomputed by code from `supportingNewsIds`, not trusted from model prose.
- A topic with no valid supporting IDs must be rejected.
- Equivalent topics should be merged deterministically after validation.
- If `extractTopics` fails validation or times out, fall back to deterministic topic construction from validated `keyInfo` and mark the node as degraded.

The governing rule is:

> LLM owns topic discovery, not factual authority. Every discovered topic must survive deterministic evidence validation before ranking or reporting.

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

## Stable Scoring And Formula-Owned Ranking

`rankTopics` must remain owned by code. The model may discover topics, annotate evidence, and provide confidence, but it must not directly assign final topic scores or final ordering.

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

### Bounded Topic Confidence

`extractTopics` may output `confidence`, but this value is not a topic score. It can only affect ranking through a bounded formula-owned adjustment.

Recommended Phase 1 rule:

```txt
topicConfidenceAdjustment = clamp(round((confidence - 0.5) * 10), -3, 5)
```

This gives the model a small voice in ranking without letting it dominate factual signals such as source count, sustained windows, rank, and occurrence count.

### Topic Score Formula

`rankTopics` should calculate:

```txt
adjustedScore = clamp(
  baseScore + deterministicSignalAdjustment + topicConfidenceAdjustment,
  0,
  100
)
```

`baseScore` is computed from deterministic facts:

- hourly `keyInfo.heatScore`
- best observed rank
- occurrence count
- source count
- sustained window count
- freshness within the report range

`deterministicSignalAdjustment` is computed from validated signal labels, confidence thresholds, duplicate groups, and source distribution. Duplicate groups must not multiply score boosts. When several supporting IDs are in the same duplicate group, count the representative item normally and treat the remaining members as corroborating links.

`topicConfidenceAdjustment` is computed only from a validated `DiscoveredTopicCandidate.confidence`. If a topic comes from fallback `keyInfo` construction, use a neutral adjustment of `0`.

### Scoring Artifact

Each topic candidate should include score explanation fields:

```ts
interface TopicScoreBreakdown {
  rankingFormulaVersion: string
  baseScore: number
  signalAdjustment: number
  topicConfidenceAdjustment: number
  adjustedScore: number
  factors: {
    keyInfoHeatScore?: number
    bestRank?: number
    occurrences?: number
    sourceCount?: number
    sustainedWindowCount?: number
    freshness?: number
    modelTopicConfidence?: number
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
07-topic-discovery-validation.json
11-score-breakdown.json
12-model-usage.json
13-comparison.json
```

`07-topic-discovery-validation.json` records rejected discovered topics, merged equivalent topics, invalid supporting IDs, fallback use, and the validated topic set passed to `rankTopics`.

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
  maxTopicDiscoveryNewsItems: number
  maxTopicCandidates: number
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
maxTopicDiscoveryNewsItems: 120
maxTopicCandidates: 12
enableLlmAnnotateSignals: true
enableLlmExtractTopics: true
enableLlmBuildClaims: true
buildClaimsTopTopicCount: 6
rankingFormulaVersion: v1
```

## Testing Strategy

Unit tests:

- Canonical input hashing is stable across object key order, source order, and news ID order.
- Cache keys change when node, prompt, schema, model, or canonical input changes.
- Window batching creates 4-hour windows and respects `maxItemsPerWindow`.
- Prompt item selection respects `maxPromptNewsItems` and deterministic hotness sorting.
- Topic discovery input selection respects `maxTopicDiscoveryNewsItems` and `maxTopicCandidates`.
- `extractTopics` accepts topics absent from `keyInfo` when supporting evidence is valid.
- `extractTopics` validators reject nonexistent `supportingNewsIds` and invalid `supportingWindowRefs`.
- `extractTopics` fallback constructs topics from validated `keyInfo` when the model output fails validation.
- `rankTopics` produces identical scores for identical validated topic inputs and does not call the LLM.
- Duplicate groups do not multiply score boosts.
- Signal labels are converted to bounded deterministic score adjustments.
- Model topic confidence is converted to a bounded formula-owned adjustment.

Workflow tests:

- `legacy` mode runs only the legacy path.
- `workflow` mode runs only the workflow path and delivers the workflow report.
- `shadow` mode delivers the legacy report and writes workflow artifacts without sending a second notification.
- `ab` mode assigns the same path for the same assignment key.
- Workflow primary failure falls back to legacy when fallback is enabled.
- Secondary comparison failure does not block delivery when `failClosedOnComparisonError` is false.

Regression tests:

- Phase 1 workflow can produce topic candidates through LLM-led topic discovery and fall back to existing `keyInfo` when needed.
- `annotateSignals`, `extractTopics`, and `buildClaims` cache hits avoid repeated model calls for unchanged canonical inputs.
- Comparison artifacts include Jaccard overlap, score delta, and claim count delta.

## Implementation Sequence

1. Add rollout config and `ReportWorkflowMode`.
2. Split `Reporter` daily execution into primary path selection and optional secondary comparison path.
3. Add shadow mode with legacy delivery and workflow artifacts.
4. Add deterministic A/B assignment and comparison artifact writing.
5. Implement canonical input hashing and model node cache keys.
6. Add model usage metadata collection for `LLMClient`.
7. Enforce 4-hour window batching, `maxItemsPerWindow`, and `maxPromptNewsItems`.
8. Add Phase 1 LLM usage for `annotateSignals` and LLM-led `extractTopics`.
9. Add topic discovery validation and fallback to validated `keyInfo`.
10. Move `rankTopics` to a formula-owned ranking step with score breakdown artifacts.
11. Add bounded `buildClaims` for the top 6 ranked topics.
12. Add comparison metrics: Jaccard overlap, score delta, and claim count delta.
13. Defer broader autonomous planning and free-form report generation to later phases.

## Success Criteria

- Operators can switch from workflow delivery back to legacy delivery with one config change.
- Shadow runs can compare workflow output against legacy output without changing delivered reports.
- Phase 1 production model usage is bounded to window-level `annotateSignals`, one report-level `extractTopics`, and top-topic `buildClaims`.
- Repeated runs with unchanged canonical inputs reuse cached model outputs.
- LLM-discovered topics can include topics absent from existing `keyInfo` when they pass evidence validation.
- Topic scores are reproducible from validated artifacts without calling a model.
- Version comparisons expose topic overlap, score movement, and claim count movement.
- Workflow instability degrades to legacy delivery rather than blocking report delivery when fallback is enabled.
