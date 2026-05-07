import { describe, expect, it } from "vitest";
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { AnalysisProfile } from "../../config/src/index.js";
import { SkillLoader } from "../../skills/src/index.js";
import { ToolRegistry } from "../../tools/src/index.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowRunner } from "./workflow-runner.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [];
  artifacts = new Map<string, { ref: ArtifactRef; data: unknown; metadata: Record<string, unknown> }>();

  async writeArtifact(input: { type: ArtifactRef["type"]; data: unknown; metadata?: Record<string, unknown> }) {
    const ref: ArtifactRef = {
      id: `${input.type}-${this.refs.length + 1}`,
      type: input.type,
      path: `${input.type}-${this.refs.length + 1}.json`,
      createdAt: "2026-05-07T00:00:00.000Z"
    };
    this.refs.push(ref);
    this.artifacts.set(ref.id, { ref, data: input.data, metadata: input.metadata ?? {} });
    return ref;
  }

  async readArtifact(ref: ArtifactRef) {
    return this.artifacts.get(ref.id) as never;
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("WorkflowRunner", () => {
  it("顺序运行 tool 和 LLM step 并写入 run record", async () => {
    const archive = new MemoryArchiveStore();
    const analysisProfiles: AnalysisProfile[] = [{
      id: "default",
      focus: ["科技热点"],
      instruction: "更关注技术产业变化。"
    }];
    const tools = new ToolRegistry();
    tools.register({
      name: "crawl_news",
      description: "crawl",
      inputSchema: {},
      execute: async () => {
        const artifactRef = await archive.writeArtifact({
          type: "news.raw",
          data: { items: [{ id: "n1", title: "新闻" }] }
        });
        return { artifactRef, itemCount: 1, sourceErrors: [] };
      }
    });

    const workflow: WorkflowDefinition = {
      id: "daily_news_report",
      defaultInput: { reportType: "daily", windowHours: 24, analysisProfileId: "default" },
      steps: [
        { id: "crawl_news", kind: "tool", uses: "crawl_news", output: "news.raw" },
        {
          id: "annotate_news",
          kind: "llm",
          skill: "analyze-hot-topics",
          input: "news.raw",
          output: ["news.annotated", "topics.index"],
          outputSchema: "skills/analyze-hot-topics/output.schema.json"
        },
        {
          id: "generate_report",
          kind: "llm",
          skill: "generate-report",
          input: ["news.annotated", "topics.index"],
          output: "reports",
          outputSchema: "skills/generate-report/output.schema.json"
        }
      ]
    };

    let modelCalls = 0;

    const runner = new WorkflowRunner({
      archive,
      tools,
      skillLoader: new SkillLoader({ skillsDir: "packages/skills/skills" }),
      analysisProfiles,
      modelClient: {
        generateStructured: async ({ user }) => {
          modelCalls += 1;
          const context = JSON.parse(user) as { analysisProfile?: AnalysisProfile };
          expect(context.analysisProfile).toEqual(analysisProfiles[0]);
          if (modelCalls === 1) {
            return {
              annotations: [{ id: "n1", annotations: { score: 0.9, topicIds: ["topic-1"], reason: "重要" } }],
              topics: [{ topicId: "topic-1", title: "热点", heat: 0.9, keywords: ["热点"], newsRefs: ["n1"] }]
            };
          }
          return {
            title: "日报",
            summary: "热点摘要",
            window: {
              startedAt: "2026-05-06T00:00:00.000Z",
              endedAt: "2026-05-07T00:00:00.000Z",
              hours: 24
            },
            sections: [{ heading: "热点", body: "重要事件", topicIds: ["topic-1"], newsRefs: ["n1"] }]
          };
        }
      },
      now: () => new Date("2026-05-07T00:00:00.000Z"),
      idFactory: () => "run-1"
    });

    const record = await runner.run(workflow, {});

    expect(record.status).toBe("succeeded");
    expect(record.steps.map((step) => step.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(archive.refs.map((ref) => ref.type)).toEqual(["news.raw", "news.annotated", "topics.index", "reports", "runs"]);
    const annotated = archive.artifacts.get("news.annotated-2");
    expect(annotated?.data).toMatchObject({
      items: [{ id: "n1", title: "新闻", annotations: { score: 0.9, topicIds: ["topic-1"], reason: "重要" } }]
    });
  });
});
