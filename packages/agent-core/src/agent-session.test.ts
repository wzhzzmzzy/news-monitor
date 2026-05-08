import { describe, expect, it } from "vitest";
import type { ArchiveStore, Artifact, ArtifactRef } from "../../archive/src/index.js";
import { ToolRegistry } from "../../tools/src/index.js";
import { AgentSession } from "./agent-session.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [{
    id: "reports-1",
    type: "reports",
    path: "reports-1.json",
    createdAt: "2026-05-07T00:00:00.000Z"
  }];

  async writeArtifact(): Promise<ArtifactRef> {
    throw new Error("未使用");
  }

  async readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>> {
    return {
      ref,
      data: { title: "日报", summary: "今日科技热点升温。" } as TData,
      metadata: {}
    };
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("AgentSession", () => {
  it("配置 model client 后基于 archive 回答报告问题", async () => {
    const archive = new MemoryArchiveStore();
    const tools = new ToolRegistry();
    const session = new AgentSession({
      archive,
      tools,
      modelClient: {
        generateStructured: async ({ user }) => ({
          answer: `基于报告回答：${JSON.parse(user).question}`,
          citations: [{ artifactId: "reports-1", label: "日报" }]
        })
      }
    });

    const response = await session.ask("今天有什么热点？");

    expect(response.text).toContain("今天有什么热点");
    expect(response.citations).toEqual([{ artifactId: "reports-1", label: "日报" }]);
  });

  it("模型支持 tool chat 时把注册工具暴露给模型", async () => {
    const archive = new MemoryArchiveStore();
    const tools = new ToolRegistry();
    tools.register({
      name: "list_reports",
      description: "列出报告",
      inputSchema: { type: "object", properties: {} },
      execute: async () => [{ id: "reports-1" }]
    });
    const session = new AgentSession({
      archive,
      tools,
      modelClient: {
        generateStructured: async () => {
          throw new Error("should not use structured fallback");
        },
        generateWithTools: async ({ tools: offeredTools, executeTool }) => {
          expect(offeredTools.map((tool) => tool.name)).toContain("list_reports");
          const result = await executeTool("list_reports", {});
          expect(result).toEqual([{ id: "reports-1" }]);
          return { text: "已查询报告列表。", citations: [] };
        }
      }
    });

    await expect(session.ask("有哪些报告？")).resolves.toEqual({
      text: "已查询报告列表。",
      citations: []
    });
  });

  it("streams assistant and tool events", async () => {
    const archive = new MemoryArchiveStore();
    const tools = new ToolRegistry();
    const events = [
      { type: "assistant.thinking" as const, payload: {} },
      { type: "tool.started" as const, payload: { id: "toolcall_01", name: "crawl_news" } },
      { type: "tool.succeeded" as const, payload: { id: "toolcall_01", name: "crawl_news", summary: "抓取 3 个信源" } },
      { type: "assistant.created" as const, payload: {} },
      { type: "assistant.delta" as const, payload: { text: "完成" } },
      { type: "assistant.completed" as const, payload: {} }
    ];
    const session = new AgentSession({
      archive,
      tools,
      modelClient: {
        generateStructured: async () => ({}),
        generateWithToolsStream: async function* () {
          yield* events;
        }
      }
    });

    const received = [];
    for await (const event of session.streamAsk({ message: "生成热点" })) {
      received.push(event);
    }

    expect(received).toEqual(events);
  });
});
