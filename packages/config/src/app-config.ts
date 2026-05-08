import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  ThemeModeSchema,
  ThemeVariantSchema,
  ThinkingSchema,
  type RuntimeConfig
} from "./types.js";

const RawAppConfigSchema = z.object({
  llm: z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    thinking: ThinkingSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxToolIterations: z.number().int().positive().optional()
  }).optional(),
  flash: z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    thinking: ThinkingSchema.optional(),
    timeoutMs: z.number().int().positive().optional()
  }).optional(),
  newsnow: z.object({
    baseUrl: z.string().url().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxItemsPerSource: z.number().int().positive().optional()
  }).optional(),
  theme: z.object({
    mode: ThemeModeSchema.optional(),
    lightVariant: ThemeVariantSchema.optional(),
    darkVariant: ThemeVariantSchema.optional()
  }).optional(),
  gateway: z.object({
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    openBrowserOnStart: z.boolean().optional()
  }).optional()
});

export const defaultRuntimeConfig: RuntimeConfig = {
  llm: { timeoutMs: 120000, maxToolIterations: 8 },
  flash: { timeoutMs: 30000 },
  newsnow: { timeoutMs: 15000, maxItemsPerSource: 50 },
  theme: { mode: "light", lightVariant: "latte", darkVariant: "mocha" },
  gateway: { host: "127.0.0.1", port: 14577, openBrowserOnStart: true }
};

export interface LoadAppConfigOptions {
  configFile: string;
}

export interface SaveAppConfigOptions {
  configFile: string;
  config: RuntimeConfig;
}

export async function loadAppConfig(options: LoadAppConfigOptions): Promise<RuntimeConfig> {
  try {
    const raw = await readFile(options.configFile, "utf8");
    const parsed = RawAppConfigSchema.parse(parseSimpleToml(raw));
    return mergeRuntimeConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return cloneDefaultRuntimeConfig();
    }
    throw error;
  }
}

export async function saveAppConfig(options: SaveAppConfigOptions): Promise<void> {
  await mkdir(dirname(options.configFile), { recursive: true });
  await writeFile(options.configFile, serializeRuntimeConfig(options.config), "utf8");
}

function mergeRuntimeConfig(parsed: z.infer<typeof RawAppConfigSchema>): RuntimeConfig {
  return {
    llm: {
      ...defaultRuntimeConfig.llm,
      ...parsed.llm
    },
    flash: {
      ...defaultRuntimeConfig.flash,
      ...parsed.flash
    },
    newsnow: {
      ...defaultRuntimeConfig.newsnow,
      ...parsed.newsnow
    },
    theme: {
      ...defaultRuntimeConfig.theme,
      ...parsed.theme
    },
    gateway: {
      ...defaultRuntimeConfig.gateway,
      ...parsed.gateway
    }
  };
}

function cloneDefaultRuntimeConfig(): RuntimeConfig {
  return {
    llm: { ...defaultRuntimeConfig.llm },
    flash: { ...defaultRuntimeConfig.flash },
    newsnow: { ...defaultRuntimeConfig.newsnow },
    theme: { ...defaultRuntimeConfig.theme },
    gateway: { ...defaultRuntimeConfig.gateway }
  };
}

function serializeRuntimeConfig(config: RuntimeConfig): string {
  return [
    "[llm]",
    ...serializeSection(config.llm),
    "",
    "[flash]",
    ...serializeSection(config.flash),
    "",
    "[newsnow]",
    ...serializeSection(config.newsnow),
    "",
    "[theme]",
    ...serializeSection(config.theme),
    "",
    "[gateway]",
    ...serializeSection(config.gateway),
    ""
  ].join("\n");
}

function serializeSection(section: Record<string, unknown>): string[] {
  return Object.entries(section)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${serializeTomlValue(value)}`);
}

function serializeTomlValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`Unsupported TOML value type: ${typeof value}`);
}

function parseSimpleToml(input: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let section: Record<string, unknown> = root;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1];
      section = {};
      root[name] = section;
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      throw new Error(`Unsupported TOML line: ${rawLine}`);
    }
    section[assignment[1]] = parseTomlValue(assignment[2].trim());
  }

  return root;
}

function stripComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inString = !inString;
    }
    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlValue(raw: string): unknown {
  if (raw.startsWith("\"") && raw.endsWith("\"")) {
    return raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  const number = Number(raw);
  if (!Number.isNaN(number)) {
    return number;
  }
  throw new Error(`Unsupported TOML value: ${raw}`);
}
