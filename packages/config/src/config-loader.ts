import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AnalysisProfilesConfigSchema,
  SourcesConfigSchema,
  type AnalysisProfile,
  type HotBoardConfig,
  type NewsSourceConfig
} from "./types.js";

export interface ConfigLoaderOptions {
  sourcesFile: string;
  analysisProfilesFile: string;
}

const defaultSources: NewsSourceConfig[] = [
  {
    id: "weibo",
    name: "微博热搜",
    type: "newsnow",
    sourceId: "weibo",
    weight: 1,
    enabled: true
  }
];

const defaultProfiles: AnalysisProfile[] = [
  {
    id: "default",
    name: "默认",
    focus: ["民生", "国际大事", "经济", "军事", "科技热点"],
    instruction: "在不忽略重大公共事件的前提下，更关注科技和经济热点。",
    default: true
  }
];

export class ConfigLoader {
  private readonly sourcesFile: string;
  private readonly analysisProfilesFile: string;

  constructor(options: ConfigLoaderOptions) {
    this.sourcesFile = options.sourcesFile;
    this.analysisProfilesFile = options.analysisProfilesFile;
  }

  async load(): Promise<HotBoardConfig> {
    const sources = await this.readJsonFile(this.sourcesFile, defaultSources, SourcesConfigSchema.parse);
    const analysisProfiles = await this.readJsonFile(
      this.analysisProfilesFile,
      defaultProfiles,
      AnalysisProfilesConfigSchema.parse
    );

    return { sources, analysisProfiles };
  }

  private async readJsonFile<T>(path: string, fallback: T, parse: (value: unknown) => T): Promise<T> {
    try {
      const raw = await readFile(path, "utf8");
      return parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
      return fallback;
    }
  }
}
