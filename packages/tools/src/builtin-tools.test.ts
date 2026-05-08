import { describe, expect, it } from "vitest";
import type { ArchiveStore, Artifact, ArtifactQuery, ArtifactRef, WriteArtifactInput } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import { createBuiltinTools } from "./builtin-tools.js";
import type { FetchSourceResult } from "./newsnow-adapter.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [];
  data = new Map<string, Artifact>();

  async writeArtifact<TData>(input: WriteArtifactInput<TData>) {
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

  async readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>> {
    return this.data.get(ref.id) as Artifact<TData>;
  }

  async listArtifacts(query: ArtifactQuery = {}) {
    return query.type ? this.refs.filter((ref) => ref.type === query.type) : this.refs;
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
      },
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const output = await tools.execute("crawl_news", { windowHours: 24 });

    expect(output).toMatchObject({
      artifactRef: { id: "news.raw-1", type: "news.raw" },
      itemCount: 1,
      sourceErrors: []
    });
  });

  it("按报告窗口合并并过滤历史 raw news", async () => {
    const archive = new MemoryArchiveStore();
    const priorRef = await archive.writeArtifact({
      type: "news.raw",
      data: {
        items: [
          { id: "old-inside", title: "窗口内旧新闻", fetchedAt: "2026-05-06T12:00:00.000Z" },
          { id: "old-outside", title: "窗口外旧新闻", fetchedAt: "2026-05-05T12:00:00.000Z" }
        ]
      }
    });
    expect(priorRef.type).toBe("news.raw");

    const tools = createBuiltinTools({
      archive,
      sources: [{ id: "weibo", name: "微博热搜", type: "newsnow", sourceId: "weibo", weight: 1 }],
      newsFetcher: {
        fetchSource: async (): Promise<FetchSourceResult> => ({
          sourceId: "weibo",
          items: [{
            id: "fresh",
            source: { id: "weibo", name: "微博热搜", type: "newsnow", weight: 1 },
            title: "新新闻",
            content: "",
            fetchedAt: "2026-05-07T00:00:00.000Z",
            metadata: { rank: 1 }
          }]
        })
      },
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const output = await tools.execute<{ artifactRef: ArtifactRef; itemCount: number }>("crawl_news", { windowHours: 24 });
    const artifact = await archive.readArtifact<{ items: Array<{ id: string }>; window: { startedAt: string; endedAt: string } }>(
      output.artifactRef
    );

    expect(output.itemCount).toBe(2);
    expect(artifact.data.window).toEqual({
      startedAt: "2026-05-06T00:00:00.000Z",
      endedAt: "2026-05-07T00:00:00.000Z"
    });
    expect(artifact.data.items.map((item) => item.id)).toEqual(["fresh", "old-inside"]);
  });
});
