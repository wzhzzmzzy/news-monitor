import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { ToolDefinition, ToolRegistry } from "../../tools/src/index.js";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface ToolChatInput {
  system: string;
  user: string;
  tools: ToolDefinition[];
  executeTool(name: string, input: unknown): Promise<unknown>;
}

export interface ToolChatOutput {
  text: string;
  citations?: Array<{ artifactId: string; label: string }>;
}

export interface AgentModelClient extends ModelClient {
  generateWithTools?(input: ToolChatInput): Promise<ToolChatOutput>;
}

export interface AgentSessionOptions {
  archive: ArchiveStore;
  tools: ToolRegistry;
  modelClient: AgentModelClient;
}

export interface AgentResponse {
  text: string;
  citations: Array<{ artifactId: string; label: string }>;
}

export class AgentSession {
  private readonly archive: ArchiveStore;
  private readonly tools: ToolRegistry;
  private readonly modelClient: AgentModelClient;

  constructor(options: AgentSessionOptions) {
    this.archive = options.archive;
    this.tools = options.tools;
    this.modelClient = options.modelClient;
  }

  async ask(question: string): Promise<AgentResponse> {
    if (this.modelClient.generateWithTools) {
      const output = await this.modelClient.generateWithTools({
        system: "你是 Hot Board Monitor 的主会话 agent。你可以使用已注册工具查询报告、读取归档、运行 workflow 或查询 workflow 状态。",
        user: question,
        tools: this.tools.list(),
        executeTool: (name, input) => this.tools.execute(name, input)
      });
      return { text: output.text, citations: output.citations ?? [] };
    }

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
