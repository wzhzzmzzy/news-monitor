import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppPaths } from "../../../../packages/app-paths/src/index.js";
import {
  ConfigLoader,
  saveAppConfig,
  type AnalysisProfile,
  type NewsSourceConfig,
  type RuntimeConfig
} from "../../../../packages/config/src/index.js";
import { loadAppConfig } from "../../../../packages/config/src/index.js";

export async function getSettings(paths: AppPaths): Promise<{
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}> {
  const config = await loadAppConfig({ configFile: paths.configFile });
  const loaded = await new ConfigLoader({
    sourcesFile: paths.sourcesFile,
    analysisProfilesFile: paths.analysisProfilesFile
  }).load();
  return { config, sources: loaded.sources, analysisProfiles: loaded.analysisProfiles };
}

export async function saveSettings(paths: AppPaths, input: {
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}): Promise<void> {
  await saveAppConfig({ configFile: paths.configFile, config: input.config });
  await writeJson(paths.sourcesFile, input.sources);
  await writeJson(paths.analysisProfilesFile, input.analysisProfiles);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
