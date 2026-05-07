import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ThinkingSchema = z.enum(["minimal", "low", "medium", "high"]).optional();

const RawAppConfigSchema = z.object({
  llm: z.object({
    url: z.string().url().optional(),
    baseUrl: z.string().url().optional(),
    key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    thinking: ThinkingSchema
  }).optional(),
  newsnow: z.object({
    url: z.string().url().optional(),
    baseUrl: z.string().url().optional()
  }).optional()
});

export type ThinkingEffort = z.infer<typeof ThinkingSchema>;

export interface AppConfig {
  llm: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: ThinkingEffort;
  };
  newsnow: {
    baseUrl?: string;
  };
}

export interface LoadAppConfigOptions {
  cwd: string;
  configPath?: string;
}

export async function loadAppConfig(options: LoadAppConfigOptions): Promise<AppConfig> {
  const path = options.configPath ?? await findDefaultConfig(options.cwd);
  if (!path) {
    return { llm: {}, newsnow: {} };
  }
  const raw = await readFile(path, "utf8");
  const parsed = RawAppConfigSchema.parse(parseSimpleToml(raw));
  return {
    llm: {
      baseUrl: parsed.llm?.baseUrl ?? parsed.llm?.url,
      apiKey: parsed.llm?.apiKey ?? parsed.llm?.key,
      model: parsed.llm?.model,
      thinking: parsed.llm?.thinking
    },
    newsnow: {
      baseUrl: parsed.newsnow?.baseUrl ?? parsed.newsnow?.url
    }
  };
}

async function findDefaultConfig(cwd: string): Promise<string | undefined> {
  const path = join(cwd, "config.dev.toml");
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
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
    return raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n");
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
