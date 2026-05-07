import { Ajv } from "ajv";
import type { ArchiveStore, ArtifactRef, ArtifactType } from "../../archive/src/index.js";
import type { AnalysisProfile } from "../../config/src/index.js";
import type { SkillLoader } from "../../skills/src/index.js";
import type { ToolRegistry } from "../../tools/src/index.js";
import type { LlmWorkflowStep, ModelClient, RunRecord, StepRecord, WorkflowDefinition, WorkflowInput, WorkflowStep } from "./types.js";

export interface WorkflowRunnerOptions {
  archive: ArchiveStore;
  tools: ToolRegistry;
  skillLoader: SkillLoader;
  analysisProfiles: AnalysisProfile[];
  modelClient: ModelClient;
  now?: () => Date;
  idFactory?: () => string;
}

export class WorkflowRunner {
  private readonly archive: ArchiveStore;
  private readonly tools: ToolRegistry;
  private readonly skillLoader: SkillLoader;
  private readonly analysisProfiles: AnalysisProfile[];
  private readonly modelClient: ModelClient;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly ajv = new Ajv({ allErrors: true });

  constructor(options: WorkflowRunnerOptions) {
    this.archive = options.archive;
    this.tools = options.tools;
    this.skillLoader = options.skillLoader;
    this.analysisProfiles = options.analysisProfiles;
    this.modelClient = options.modelClient;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async run(workflow: WorkflowDefinition, inputOverride: Partial<WorkflowInput>): Promise<RunRecord> {
    const input = { ...workflow.defaultInput, ...inputOverride };
    const record: RunRecord = {
      id: this.idFactory(),
      workflowId: workflow.id,
      status: "running",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      input,
      steps: []
    };
    const outputs = new Map<string, ArtifactRef[]>();

    try {
      const analysisProfile = this.resolveAnalysisProfile(input.analysisProfileId);
      for (const step of workflow.steps) {
        const stepRecord = await this.runStep(step, input, analysisProfile, outputs);
        record.steps.push(stepRecord);
        if (stepRecord.status === "failed") {
          record.status = "failed";
          break;
        }
      }
      if (record.status === "running") {
        record.status = "succeeded";
      }
    } catch (error) {
      record.status = "failed";
      const lastStep = record.steps.at(-1);
      if (lastStep && lastStep.status === "running") {
        lastStep.status = "failed";
        lastStep.finishedAt = this.now().toISOString();
        lastStep.error = (error as Error).message;
      }
    } finally {
      record.finishedAt = this.now().toISOString();
      await this.archive.writeArtifact({ type: "runs", data: record, metadata: { workflowId: workflow.id } });
    }

    return record;
  }

  private async runStep(
    step: WorkflowStep,
    workflowInput: WorkflowInput,
    analysisProfile: AnalysisProfile,
    outputs: Map<string, ArtifactRef[]>
  ): Promise<StepRecord> {
    const stepRecord: StepRecord = {
      id: step.id,
      status: "running",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      inputRefs: this.resolveInputRefs(step, outputs),
      outputRefs: [],
      error: null
    };

    try {
      if (step.kind === "tool") {
        const result = await this.tools.execute<{ artifactRef?: ArtifactRef }>(step.uses, workflowInput);
        if (result.artifactRef) {
          stepRecord.outputRefs.push(result.artifactRef);
          outputs.set(step.output, [result.artifactRef]);
        }
      } else {
        const refs = await this.runLlmStep(step, workflowInput, analysisProfile, stepRecord.inputRefs);
        stepRecord.outputRefs.push(...refs);
        const outputKeys = Array.isArray(step.output) ? step.output : [step.output];
        outputKeys.forEach((key, index) => outputs.set(key, refs[index] ? [refs[index]] : []));
      }
      stepRecord.status = "succeeded";
    } catch (error) {
      stepRecord.status = "failed";
      stepRecord.error = (error as Error).message;
    } finally {
      stepRecord.finishedAt = this.now().toISOString();
    }

    return stepRecord;
  }

  private resolveInputRefs(step: WorkflowStep, outputs: Map<string, ArtifactRef[]>): ArtifactRef[] {
    if (step.kind === "tool") {
      return [];
    }
    const keys = Array.isArray(step.input) ? step.input : [step.input];
    return keys.flatMap((key) => outputs.get(key) ?? []);
  }

  private async runLlmStep(
    step: LlmWorkflowStep,
    workflowInput: WorkflowInput,
    analysisProfile: AnalysisProfile,
    inputRefs: ArtifactRef[]
  ): Promise<ArtifactRef[]> {
    const skill = await this.skillLoader.load(step.skill);
    const artifacts = await Promise.all(inputRefs.map((ref) => this.archive.readArtifact(ref)));
    const structured = await this.modelClient.generateStructured({
      system: skill.prompt,
      user: JSON.stringify({ workflowInput, analysisProfile, artifacts }),
      schema: skill.outputSchema
    });
    this.validateStructuredOutput(step.skill, skill.outputSchema, structured);

    if (step.skill === "analyze-hot-topics") {
      // 首版只有 analyze-hot-topics 需要拆分成 annotated news 与 topic index 两个 artifact。
      // 这里先保持显式分支，后续引入通用多输出映射时再泛化。
      const output = structured as {
        annotations: Array<{ id: string; annotations: unknown }>;
        topics: unknown;
      };
      const annotationById = new Map(output.annotations.map((item) => [item.id, item.annotations]));
      const rawItems = artifacts.flatMap((artifact) => {
        const data = artifact.data as { items?: Array<Record<string, unknown>> };
        return data.items ?? [];
      });
      const missingIds = rawItems
        .map((item) => String(item.id ?? ""))
        .filter((id) => id && !annotationById.has(id));
      if (missingIds.length > 0) {
        throw new Error(`LLM output missing annotations for news ids: ${missingIds.join(", ")}`);
      }
      const annotatedItems = rawItems.map((item) => ({
        ...item,
        annotations: annotationById.get(String(item.id))
      }));
      return Promise.all([
        this.archive.writeArtifact({ type: "news.annotated", data: { items: annotatedItems }, metadata: { skill: step.skill } }),
        this.archive.writeArtifact({ type: "topics.index", data: output.topics, metadata: { skill: step.skill } })
      ]);
    }

    const outputType = Array.isArray(step.output) ? step.output[0] : step.output;
    return [
      await this.archive.writeArtifact({
        type: outputType as ArtifactType,
        data: structured,
        metadata: { skill: step.skill }
      })
    ];
  }

  private validateStructuredOutput(skillId: string, schema: Record<string, unknown>, value: unknown): void {
    const validate = this.ajv.compile(schema);
    if (!validate(value)) {
      throw new Error(`LLM output failed schema validation for ${skillId}: ${this.ajv.errorsText(validate.errors)}`);
    }
  }

  private resolveAnalysisProfile(profileId: string): AnalysisProfile {
    const profile = this.analysisProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new Error(`Analysis profile not found: ${profileId}`);
    }
    return profile;
  }
}
