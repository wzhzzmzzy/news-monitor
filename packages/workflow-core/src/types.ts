import type { ArtifactRef } from "../../archive/src/index.js";

export type WorkflowStepKind = "tool" | "llm";
export type RunStatus = "running" | "succeeded" | "failed";

export interface WorkflowInput {
  reportType: "daily" | "semiweekly";
  windowHours: number;
  analysisProfileId: string;
}

export interface ToolWorkflowStep {
  id: string;
  kind: "tool";
  uses: string;
  output: string;
}

export interface LlmWorkflowStep {
  id: string;
  kind: "llm";
  skill: string;
  input: string | string[];
  output: string | string[];
  outputSchema: string;
}

export type WorkflowStep = ToolWorkflowStep | LlmWorkflowStep;

export interface WorkflowDefinition {
  id: string;
  defaultInput: WorkflowInput;
  steps: WorkflowStep[];
}

export interface StepRecord {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  inputRefs: ArtifactRef[];
  outputRefs: ArtifactRef[];
  error: string | null;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  input: WorkflowInput;
  steps: StepRecord[];
}

export interface ModelClient {
  generateStructured(input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}
