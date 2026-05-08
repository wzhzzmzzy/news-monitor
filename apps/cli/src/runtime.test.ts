import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { createRuntime } from "./runtime.js";

const roots: string[] = [];

async function tempPaths() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-cli-"));
  roots.push(root);
  return resolveAppPaths({
    homeDir: join(root, "home"),
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state")
    }
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createRuntime", () => {
  it("创建 archive、config、tools、workflows 和 agent session", async () => {
    const paths = await tempPaths();
    const runtime = await createRuntime({
      paths,
      newsApiBaseUrl: "https://news.example.test",
      modelClient: { generateStructured: async () => ({ answer: "ok", citations: [] }) }
    });

    expect(runtime.paths).toBe(paths);
    expect(runtime.config.sources[0]?.id).toBe("weibo");
    expect(runtime.workflows.daily_news_report.id).toBe("daily_news_report");
    expect(runtime.tools.list().map((tool) => tool.name)).toContain("crawl_news");
  });

  it("不在创建 runtime 时强制要求 OpenAI model 配置", async () => {
    const previousModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    try {
      const runtime = await createRuntime({
        paths: await tempPaths(),
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

  it("从 XDG config.toml 读取 NewsNow 和 LLM 设置", async () => {
    const paths = await tempPaths();
    await mkdir(dirname(paths.configFile), { recursive: true });
    await writeFile(paths.configFile, [
      "[llm]",
      "baseUrl = \"https://llm.example.test/v1\"",
      "apiKey = \"test-key\"",
      "model = \"test-model\"",
      "thinking = \"low\"",
      "timeoutMs = 90000",
      "maxToolIterations = 6",
      "",
      "[newsnow]",
      "baseUrl = \"http://newsnow.example.test\"",
      "timeoutMs = 7000",
      "maxItemsPerSource = 25"
    ].join("\n"));

    const runtime = await createRuntime({
      paths,
      modelClient: { generateStructured: async () => ({ answer: "ok", citations: [] }) }
    });

    expect(runtime.appConfig).toMatchObject({
      llm: {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        thinking: "low",
        timeoutMs: 90000,
        maxToolIterations: 6
      },
      newsnow: {
        baseUrl: "http://newsnow.example.test",
        timeoutMs: 7000,
        maxItemsPerSource: 25
      }
    });
  });

  it("preserves streaming model clients through the lazy runtime wrapper", async () => {
    const runtime = await createRuntime({
      paths: await tempPaths(),
      newsApiBaseUrl: "https://news.example.test",
      modelClient: {
        generateStructured: async () => ({ answer: "fallback", citations: [] }),
        generateWithToolsStream: async function* () {
          yield { type: "assistant.created" as const, payload: {} };
          yield { type: "assistant.delta" as const, payload: { text: "streamed" } };
          yield { type: "assistant.completed" as const, payload: {} };
        }
      }
    });

    const events = [];
    for await (const event of runtime.agent.streamAsk({ message: "测试 streaming" })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "assistant.delta", payload: { text: "streamed" } });
    expect(events).not.toContainEqual({ type: "assistant.delta", payload: { text: "fallback" } });
  });
});
