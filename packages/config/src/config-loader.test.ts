import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("creates default sources and analysis profile files at explicit paths", async () => {
    const root = await tempRoot();
    const sourcesFile = join(root, "config", "sources.json");
    const analysisProfilesFile = join(root, "config", "analysis-profiles.json");
    const loader = new ConfigLoader({ sourcesFile, analysisProfilesFile });
    const config = await loader.load();

    expect(config.sources[0]).toMatchObject({
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      sourceId: "weibo",
      weight: 1,
      enabled: true
    });
    expect(config.analysisProfiles[0]).toMatchObject({
      id: "default",
      name: "默认",
      focus: ["民生", "国际大事", "经济", "军事", "科技热点"],
      default: true
    });
    expect(JSON.parse(await readFile(sourcesFile, "utf8"))[0].enabled).toBe(true);
    expect(JSON.parse(await readFile(analysisProfilesFile, "utf8"))[0].default).toBe(true);
  });

  it("loads configured sources and profiles from explicit paths", async () => {
    const root = await tempRoot();
    const sourcesFile = join(root, "xdg-config", "sources.json");
    const analysisProfilesFile = join(root, "xdg-config", "analysis-profiles.json");
    await mkdir(join(root, "xdg-config"), { recursive: true });
    await writeFile(sourcesFile, JSON.stringify([
      { id: "custom", name: "自定义", type: "newsnow", sourceId: "weibo", weight: 0.7, enabled: false }
    ]));
    await writeFile(analysisProfilesFile, JSON.stringify([
      { id: "ops", name: "运营", focus: ["科技"], instruction: "更关注技术产业变化。", default: true }
    ]));

    const loader = new ConfigLoader({ sourcesFile, analysisProfilesFile });
    const config = await loader.load();

    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]).toMatchObject({ sourceId: "weibo", enabled: false });
    expect(config.analysisProfiles[0]).toMatchObject({ id: "ops", name: "运营", default: true });
  });
});
