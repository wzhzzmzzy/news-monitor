import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-cli-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createRuntime", () => {
  it("创建 archive、config、tools、workflows 和 agent session", async () => {
    const runtime = await createRuntime({
      hotBoardDir: await tempRoot(),
      newsApiBaseUrl: "https://news.example.test",
      modelClient: { generateStructured: async () => ({ answer: "ok", citations: [] }) }
    });

    expect(runtime.config.sources[0]?.id).toBe("weibo");
    expect(runtime.workflows.daily_news_report.id).toBe("daily_news_report");
    expect(runtime.tools.list().map((tool) => tool.name)).toContain("crawl_news");
  });
});
