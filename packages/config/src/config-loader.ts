import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnalysisProfilesConfigSchema,
  SourcesConfigSchema,
  type AnalysisProfile,
  type HotBoardConfig,
  type NewsSourceConfig
} from "./types.js";

export interface ConfigLoaderOptions {
  rootDir: string;
}

const defaultSources: NewsSourceConfig[] = [
  {
    id: "weibo",
    name: "微博热搜",
    type: "newsnow",
    sourceId: "weibo",
    weight: 1
  }
];

const defaultProfiles: AnalysisProfile[] = [
  {
    id: "default",
    focus: ["民生", "国际大事", "经济", "军事", "科技热点"],
    instruction: "在不忽略重大公共事件的前提下，更关注科技和经济热点。"
  }
];

export class ConfigLoader {
  private readonly configDir: string;

  constructor(options: ConfigLoaderOptions) {
    this.configDir = join(options.rootDir, "config");
  }

  async load(): Promise<HotBoardConfig> {
    await mkdir(this.configDir, { recursive: true });
    const sources = await this.readJsonFile("sources.json", defaultSources, SourcesConfigSchema.parse);
    const analysisProfiles = await this.readJsonFile(
      "analysis-profiles.json",
      defaultProfiles,
      AnalysisProfilesConfigSchema.parse
    );

    return { sources, analysisProfiles };
  }

  private async readJsonFile<T>(fileName: string, fallback: T, parse: (value: unknown) => T): Promise<T> {
    const path = join(this.configDir, fileName);
    try {
      const raw = await readFile(path, "utf8");
      return parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await writeFile(path, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
      return fallback;
    }
  }
}
