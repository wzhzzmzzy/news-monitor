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
});
