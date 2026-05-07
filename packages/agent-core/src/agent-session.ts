import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { ToolRegistry } from "../../tools/src/index.js";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface AgentSessionOptions {
  archive: ArchiveStore;
  tools: ToolRegistry;
  modelClient: ModelClient;
}

export interface AgentResponse {
  text: string;
  citations: Array<{ artifactId: string; label: string }>;
}

export class AgentSession {
  private readonly archive: ArchiveStore;
  private readonly tools: ToolRegistry;
  private readonly modelClient: ModelClient;

  constructor(options: AgentSessionOptions) {
    this.archive = options.archive;
    this.tools = options.tools;
    this.modelClient = options.modelClient;
  }

  async ask(question: string): Promise<AgentResponse> {
    const reports = await this.archive.listArtifacts({ type: "reports", limit: 5 });
    const reportArtifacts = await Promise.all(reports.map((ref: ArtifactRef) => this.archive.readArtifact(ref)));
    const output = await this.modelClient.generateStructured({
      system: "你是 Hot Board Monitor 的报告阅读助手。只基于提供的报告回答问题。",
      user: JSON.stringify({ question, reports: reportArtifacts }),
      schema: {
        type: "object",
        required: ["answer", "citations"],
        properties: {
          answer: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              required: ["artifactId", "label"],
              properties: {
                artifactId: { type: "string" },
                label: { type: "string" }
              }
            }
          }
        },
        additionalProperties: false
      }
    }) as { answer: string; citations: Array<{ artifactId: string; label: string }> };

    return { text: output.answer, citations: output.citations };
  }

  async runTool<TOutput = unknown>(name: string, input: unknown): Promise<TOutput> {
    return this.tools.execute<TOutput>(name, input);
  }
}
