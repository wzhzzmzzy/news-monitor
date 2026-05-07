import { describe, expect, it } from "vitest";
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import { createBuiltinTools } from "./builtin-tools.js";
import type { FetchSourceResult } from "./newsnow-adapter.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [];
  data = new Map<string, unknown>();

  async writeArtifact(input: { type: ArtifactRef["type"]; data: unknown; metadata?: Record<string, unknown> }) {
    const ref: ArtifactRef = {
      id: `${input.type}-${this.refs.length + 1}`,
      type: input.type,
      path: `${input.type}-${this.refs.length + 1}.json`,
      createdAt: "2026-05-07T00:00:00.000Z"
    };
    this.refs.push(ref);
    this.data.set(ref.id, { ref, data: input.data, metadata: input.metadata ?? {} });
    return ref;
  }

  async readArtifact(ref: ArtifactRef) {
    return this.data.get(ref.id) as never;
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("createBuiltinTools", () => {
  it("爬取已配置信源并写入 raw news artifact", async () => {
    const archive = new MemoryArchiveStore();
    const sources: NewsSourceConfig[] = [
      { id: "weibo", name: "微博热搜", type: "newsnow", sourceId: "weibo", weight: 1 }
    ];

    const tools = createBuiltinTools({
      archive,
      sources,
      newsFetcher: {
        fetchSource: async (): Promise<FetchSourceResult> => ({
          sourceId: "weibo",
          items: [{
            id: "weibo:item-1",
            source: { id: "weibo", name: "微博热搜", type: "newsnow", weight: 1 },
            title: "重大新闻",
            content: "",
            fetchedAt: "2026-05-07T00:00:00.000Z",
            metadata: { rank: 1 }
          }]
        })
      }
    });

    const output = await tools.execute("crawl_news", { windowHours: 24 });

    expect(output).toMatchObject({
      artifactRef: { id: "news.raw-1", type: "news.raw" },
      itemCount: 1,
      sourceErrors: []
    });
  });
});
