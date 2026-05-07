import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigLoader } from "./config-loader.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-config-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ConfigLoader", () => {
  it("创建默认信源和 analysis profile 文件", async () => {
    const loader = new ConfigLoader({ rootDir: await tempRoot() });
    const config = await loader.load();

    expect(config.sources[0]).toMatchObject({
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      weight: 1
    });
    expect(config.analysisProfiles[0]).toMatchObject({
      id: "default",
      focus: ["民生", "国际大事", "经济", "军事", "科技热点"]
    });
  });

  it("加载已配置的信源和 profile", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "sources.json"), JSON.stringify([
      { id: "custom", name: "自定义", type: "newsnow", sourceId: "weibo", weight: 0.7 }
    ]));
    await writeFile(join(root, "config", "analysis-profiles.json"), JSON.stringify([
      { id: "ops", focus: ["科技"], instruction: "更关注技术产业变化。" }
    ]));

    const loader = new ConfigLoader({ rootDir: root });
    const config = await loader.load();

    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.sourceId).toBe("weibo");
    expect(config.analysisProfiles[0]?.id).toBe("ops");
  });
});
