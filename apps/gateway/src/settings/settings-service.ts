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

export function validateSettings(input: {
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!input.config.llm.model?.trim()) {
    fields["llm.model"] = "请填写主模型名称";
  }
  requirePositiveInteger(fields, "llm.timeoutMs", input.config.llm.timeoutMs, "请填写主模型超时时间");
  requirePositiveInteger(fields, "llm.maxToolIterations", input.config.llm.maxToolIterations, "请填写工具调用上限");
  requirePositiveInteger(fields, "flash.timeoutMs", input.config.flash.timeoutMs, "请填写 Flash 超时时间");
  requirePositiveInteger(fields, "newsnow.timeoutMs", input.config.newsnow.timeoutMs, "请填写 NewsNow 超时时间");
  requirePositiveInteger(fields, "newsnow.maxItemsPerSource", input.config.newsnow.maxItemsPerSource, "请填写单信源条数上限");
  requirePositiveInteger(fields, "gateway.port", input.config.gateway.port, "请填写 Gateway 端口");
  if (input.config.gateway.port < 1 || input.config.gateway.port > 65535) {
    fields["gateway.port"] = "Gateway 端口必须在 1 到 65535 之间";
  }
  return fields;
}

function requirePositiveInteger(fields: Record<string, string>, name: string, value: unknown, message: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    fields[name] = message;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
