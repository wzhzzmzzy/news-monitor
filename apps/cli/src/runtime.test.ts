import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("不在创建 runtime 时强制要求 OpenAI model 配置", async () => {
    const previousModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    try {
      const runtime = await createRuntime({
        hotBoardDir: await tempRoot(),
        newsApiBaseUrl: "https://news.example.test"
      });

      await expect(runtime.tools.execute("list_reports", { limit: 5 })).resolves.toEqual([]);
    } finally {
      if (previousModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = previousModel;
      }
    }
  });

  it("从显式 TOML 配置读取 NewsNow 和 LLM 设置", async () => {
    const root = await tempRoot();
    const configPath = join(root, "config.local.toml");
    await writeFile(configPath, [
      "[llm]",
      "url = \"https://llm.example.test/v1\"",
      "key = \"test-key\"",
      "model = \"test-model\"",
      "thinking = \"low\"",
      "",
      "[newsnow]",
      "url = \"http://newsnow.example.test\""
    ].join("\n"));

    const runtime = await createRuntime({
      hotBoardDir: root,
      configPath,
      modelClient: { generateStructured: async () => ({ answer: "ok", citations: [] }) }
    });

    expect(runtime.appConfig).toEqual({
      llm: {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        thinking: "low"
      },
      newsnow: {
        baseUrl: "http://newsnow.example.test"
      }
    });
  });
});
