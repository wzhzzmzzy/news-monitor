# Agent Workflow Core 实现方案

> **给智能体执行者：** 必须使用子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项实现本方案。步骤使用复选框（`- [ ]`）语法追踪进度。

**目标：** 构建 Hot Board Monitor 第一版可用的 Agent Core 与 Workflow Core，包括文件归档存储、NewsNow 爬取、由 skill 支撑的 LLM workflow step、run record，以及最小 CLI。

**架构：** 使用 pnpm workspace monorepo，并拆分为小型 TypeScript 包：`archive` 负责 artifact 持久化，`config` 负责信源/profile 加载，`tools` 负责确定性工具，`skills` 负责 prompt/schema 文件，`workflow-core` 负责 workflow descriptor 与运行执行，`agent-core` 负责 chat session 编排。CLI 是这些包之上的薄适配层，并把运行时数据存储在 `.hot-board/` 下。

**技术栈：** Node.js 22、TypeScript、pnpm workspace、Vitest、Zod、Commander、OpenAI Node SDK。

---

## 文件结构

- 创建 `package.json`：根包脚本、依赖与 pnpm 版本声明。
- 创建 `pnpm-workspace.yaml`：pnpm workspace 包范围。
- 创建 `tsconfig.json`：所有 packages 与 apps 共享的 TypeScript 设置。
- 创建 `vitest.config.ts`：测试 include pattern 与 Node 环境。
- 创建 `packages/archive/src/types.ts`：artifact、artifact ref、查询与 store 接口。
- 创建 `packages/archive/src/file-archive-store.ts`：基于 JSON 文件的 artifact 实现。
- 创建 `packages/archive/src/index.ts`：archive 公共导出。
- 创建 `packages/config/src/types.ts`：信源与 analysis profile schema。
- 创建 `packages/config/src/config-loader.ts`：`.hot-board/config` 默认值与 JSON 加载。
- 创建 `packages/config/src/index.ts`：config 公共导出。
- 创建 `packages/tools/src/newsnow-adapter.ts`：NewsNow API client 与 item 标准化。
- 创建 `packages/tools/src/tool-registry.ts`：带类型的 tool 注册与分发。
- 创建 `packages/tools/src/builtin-tools.ts`：`crawl_news`、archive/report 与 workflow status tool 工厂。
- 创建 `packages/tools/src/index.ts`：tools 公共导出。
- 创建 `packages/skills/src/skill-loader.ts`：读取 skill prompt 与 JSON schema 文件。
- 创建 `packages/skills/src/index.ts`：skill 公共导出。
- 创建 `packages/skills/skills/analyze-hot-topics/SKILL.md`：热点标注指令。
- 创建 `packages/skills/skills/analyze-hot-topics/output.schema.json`：annotated news 与 topic index schema。
- 创建 `packages/skills/skills/generate-report/SKILL.md`：报告生成指令。
- 创建 `packages/skills/skills/generate-report/output.schema.json`：报告 schema。
- 创建 `packages/skills/skills/read-report/SKILL.md`：报告阅读指令。
- 创建 `packages/skills/skills/read-report/output.schema.json`：报告问答 schema。
- 创建 `packages/workflow-core/src/types.ts`：workflow、step、run record 与 model client 接口。
- 创建 `packages/workflow-core/src/builtins.ts`：`daily_news_report` 与 `semiweekly_news_report` descriptor。
- 创建 `packages/workflow-core/src/workflow-runner.ts`：顺序 workflow engine 与 run record 写入。
- 创建 `packages/workflow-core/src/index.ts`：workflow 公共导出。
- 创建 `packages/agent-core/src/openai-model-client.ts`：OpenAI SDK adapter。
- 创建 `packages/agent-core/src/agent-session.ts`：chat session 抽象、tool 分发、报告阅读。
- 创建 `packages/agent-core/src/subagent.ts`：预留 subagent 接口与未实现 service。
- 创建 `packages/agent-core/src/index.ts`：agent 公共导出。
- 创建 `apps/cli/src/runtime.ts`：共享 CLI runtime 构造。
- 创建 `apps/cli/src/index.ts`：`hot-board` 命令。
- 在 `packages/*/src/*.test.ts` 和 `apps/cli/src/*.test.ts` 下创建测试。

## 任务 1：工作区脚手架

**文件：**
- 创建：`package.json`
- 创建：`pnpm-workspace.yaml`
- 创建：`tsconfig.json`
- 创建：`vitest.config.ts`

- [ ] **步骤 1：创建根 package 元数据**

创建 `package.json`：

```json
{
  "name": "hot-board-monitor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.20.0",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "cli": "tsx apps/cli/src/index.ts"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "commander": "^14.0.1",
    "openai": "^6.6.0",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.9.1",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **步骤 2：创建 pnpm workspace 配置**

创建 `pnpm-workspace.yaml`：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **步骤 3：创建 TypeScript 配置**

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"],
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["apps/**/*.ts", "packages/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **步骤 4：创建 Vitest 配置**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: true
  }
});
```

- [ ] **步骤 5：安装依赖**

运行：

```bash
pnpm install
```

预期：命令以 code 0 退出，并创建 `pnpm-lock.yaml`。

- [ ] **步骤 6：验证空脚手架**

运行：

```bash
pnpm run typecheck
```

预期：通过，且没有 TypeScript 错误。

- [ ] **步骤 7：提交**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vitest.config.ts
git commit -m "chore: scaffold typescript workspace"
```

## 任务 2：文件归档存储

**文件：**
- 创建：`packages/archive/src/types.ts`
- 创建：`packages/archive/src/file-archive-store.ts`
- 创建：`packages/archive/src/index.ts`
- 测试：`packages/archive/src/file-archive-store.test.ts`

- [ ] **步骤 1：编写失败的归档存储测试**

创建 `packages/archive/src/file-archive-store.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { FileArchiveStore } from "./file-archive-store.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-archive-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileArchiveStore", () => {
  it("按类型写入、读取并列出 artifact", async () => {
    const store = new FileArchiveStore({ rootDir: await tempRoot() });
    const ref = await store.writeArtifact({
      type: "news.raw",
      data: { items: [{ id: "n1", title: "示例" }] },
      metadata: { source: "test" }
    });

    expect(ref.type).toBe("news.raw");
    expect(ref.path).toContain("artifacts/news/raw/");

    const artifact = await store.readArtifact(ref);
    expect(artifact.ref.id).toBe(ref.id);
    expect(artifact.data).toEqual({ items: [{ id: "n1", title: "示例" }] });
    expect(artifact.metadata).toEqual({ source: "test" });

    const refs = await store.listArtifacts({ type: "news.raw" });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.id).toBe(ref.id);
  });

  it("按创建时间倒序排列 artifact", async () => {
    const store = new FileArchiveStore({ rootDir: await tempRoot() });
    const first = await store.writeArtifact({ type: "reports", data: { title: "第一份" } });
    const second = await store.writeArtifact({ type: "reports", data: { title: "第二份" } });

    const refs = await store.listArtifacts({ type: "reports" });
    expect(refs.map((ref) => ref.id)).toEqual([second.id, first.id]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/archive/src/file-archive-store.test.ts
```

预期：失败，并出现 `./file-archive-store.js` 的模块解析错误。

- [ ] **步骤 3：添加归档类型**

创建 `packages/archive/src/types.ts`：

```ts
export type ArtifactType =
  | "news.raw"
  | "news.annotated"
  | "topics.index"
  | "reports"
  | "runs"
  | "logs";

export interface ArtifactRef {
  id: string;
  type: ArtifactType;
  path: string;
  createdAt: string;
}

export interface Artifact<TData = unknown> {
  ref: ArtifactRef;
  data: TData;
  metadata: Record<string, unknown>;
}

export interface WriteArtifactInput<TData = unknown> {
  type: ArtifactType;
  data: TData;
  metadata?: Record<string, unknown>;
}

export interface ArtifactQuery {
  type?: ArtifactType;
  limit?: number;
}

export interface ArchiveStore {
  writeArtifact<TData>(input: WriteArtifactInput<TData>): Promise<ArtifactRef>;
  readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>>;
  listArtifacts(query?: ArtifactQuery): Promise<ArtifactRef[]>;
}
```

- [ ] **步骤 4：添加文件归档实现**

创建 `packages/archive/src/file-archive-store.ts`：

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ArchiveStore, Artifact, ArtifactQuery, ArtifactRef, ArtifactType, WriteArtifactInput } from "./types.js";

export interface FileArchiveStoreOptions {
  rootDir: string;
  now?: () => Date;
  idFactory?: () => string;
}

const typeDirs: Record<ArtifactType, string> = {
  "news.raw": "artifacts/news/raw",
  "news.annotated": "artifacts/news/annotated",
  "topics.index": "artifacts/topics",
  reports: "artifacts/reports",
  runs: "artifacts/runs",
  logs: "artifacts/logs"
};

export class FileArchiveStore implements ArchiveStore {
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: FileArchiveStoreOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async writeArtifact<TData>(input: WriteArtifactInput<TData>): Promise<ArtifactRef> {
    const createdAt = this.now().toISOString();
    const id = `${input.type.replace(".", "-")}-${this.idFactory()}`;
    const relPath = join(typeDirs[input.type], `${createdAt.replaceAll(":", "-")}-${id}.json`);
    const absPath = join(this.rootDir, relPath);
    const ref: ArtifactRef = { id, type: input.type, path: relPath, createdAt };
    const artifact: Artifact<TData> = {
      ref,
      data: input.data,
      metadata: input.metadata ?? {}
    };

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return ref;
  }

  async readArtifact<TData = unknown>(ref: ArtifactRef): Promise<Artifact<TData>> {
    const raw = await readFile(join(this.rootDir, ref.path), "utf8");
    return JSON.parse(raw) as Artifact<TData>;
  }

  async listArtifacts(query: ArtifactQuery = {}): Promise<ArtifactRef[]> {
    const types = query.type ? [query.type] : (Object.keys(typeDirs) as ArtifactType[]);
    const refs: ArtifactRef[] = [];

    for (const type of types) {
      const dir = join(this.rootDir, typeDirs[type]);
      const files = await this.safeReadDir(dir);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const raw = await readFile(join(dir, file), "utf8");
        const artifact = JSON.parse(raw) as Artifact;
        refs.push({
          ...artifact.ref,
          path: relative(this.rootDir, join(dir, file))
        });
      }
    }

    refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return typeof query.limit === "number" ? refs.slice(0, query.limit) : refs;
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
```

- [ ] **步骤 5：导出 archive 包**

创建 `packages/archive/src/index.ts`：

```ts
export * from "./types.js";
export * from "./file-archive-store.js";
```

- [ ] **步骤 6：运行 archive 测试**

运行：

```bash
pnpm test -- packages/archive/src/file-archive-store.test.ts
```

预期：通过 2 个测试。

- [ ] **步骤 7：提交**

```bash
git add packages/archive/src
git commit -m "feat: add file archive store"
```

## 任务 3：配置加载器

**文件：**
- 创建：`packages/config/src/types.ts`
- 创建：`packages/config/src/config-loader.ts`
- 创建：`packages/config/src/index.ts`
- 测试：`packages/config/src/config-loader.test.ts`

- [ ] **步骤 1：编写失败的配置加载器测试**

创建 `packages/config/src/config-loader.test.ts`：

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
      { "id": "custom", "name": "自定义", "type": "newsnow", "sourceId": "weibo", "weight": 0.7 }
    ]));
    await writeFile(join(root, "config", "analysis-profiles.json"), JSON.stringify([
      { "id": "ops", "focus": ["科技"], "instruction": "更关注技术产业变化。" }
    ]));

    const loader = new ConfigLoader({ rootDir: root });
    const config = await loader.load();

    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]?.sourceId).toBe("weibo");
    expect(config.analysisProfiles[0]?.id).toBe("ops");
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/config/src/config-loader.test.ts
```

预期：失败，并出现 `./config-loader.js` 的模块解析错误。

- [ ] **步骤 3：添加配置类型与 schema**

创建 `packages/config/src/types.ts`：

```ts
import { z } from "zod";

export const NewsSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("newsnow"),
  sourceId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  weight: z.number().min(0).max(1).default(1)
});

export const AnalysisProfileSchema = z.object({
  id: z.string().min(1),
  focus: z.array(z.string().min(1)),
  instruction: z.string().min(1)
});

export const SourcesConfigSchema = z.array(NewsSourceSchema);
export const AnalysisProfilesConfigSchema = z.array(AnalysisProfileSchema);

export type NewsSourceConfig = z.infer<typeof NewsSourceSchema>;
export type AnalysisProfile = z.infer<typeof AnalysisProfileSchema>;

export interface HotBoardConfig {
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}
```

- [ ] **步骤 4：添加配置加载器实现**

创建 `packages/config/src/config-loader.ts`：

```ts
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
```

- [ ] **步骤 5：导出 config 包**

创建 `packages/config/src/index.ts`：

```ts
export * from "./types.js";
export * from "./config-loader.js";
```

- [ ] **步骤 6：运行 config 测试**

运行：

```bash
pnpm test -- packages/config/src/config-loader.test.ts
```

预期：通过 2 个测试。

- [ ] **步骤 7：提交**

```bash
git add packages/config/src
git commit -m "feat: add hot board config loader"
```

## 任务 4：NewsNow 适配器

**文件：**
- 创建：`packages/tools/src/newsnow-adapter.ts`
- 测试：`packages/tools/src/newsnow-adapter.test.ts`

- [ ] **步骤 1：编写失败的 NewsNow 适配器测试**

创建 `packages/tools/src/newsnow-adapter.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import type { NewsSourceConfig } from "../../config/src/index.js";
import { NewsNowAdapter } from "./newsnow-adapter.js";

describe("NewsNowAdapter", () => {
  it("抓取并标准化 NewsNow items", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "success",
      id: "weibo",
      updatedTime: 1778136000000,
      items: [
        {
          id: "item-1",
          title: "重大新闻",
          url: "https://example.com/news",
          pubDate: 1778135900000,
          extra: { mobileUrl: "https://m.example.com/news" }
        },
        {
          id: "item-2",
          title: "补充新闻",
          url: "https://example.com/extra",
          extra: { date: "2026-05-06T23:30:00.000Z" }
        }
      ]
    })));

    const source: NewsSourceConfig = {
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      sourceId: "weibo",
      weight: 1
    };

    const adapter = new NewsNowAdapter({
      newsApiBaseUrl: "https://news.example.test",
      fetch: fetchMock,
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const result = await adapter.fetchSource(source);

    expect(fetchMock).toHaveBeenCalledWith("https://news.example.test/api/s?id=weibo");
    expect(result.items).toEqual([
      {
        id: "weibo:item-1",
        source: {
          id: "weibo",
          name: "微博热搜",
          url: undefined,
          type: "newsnow",
          weight: 1
        },
        title: "重大新闻",
        url: "https://example.com/news",
        content: "",
        publishedAt: "2026-05-07T06:38:20.000Z",
        fetchedAt: "2026-05-07T00:00:00.000Z",
        metadata: {
          rank: 1,
          newsnow: {
            id: "item-1",
            updatedTime: 1778136000000,
            extra: { mobileUrl: "https://m.example.com/news" }
          }
        }
      },
      {
        id: "weibo:item-2",
        source: {
          id: "weibo",
          name: "微博热搜",
          url: undefined,
          type: "newsnow",
          weight: 1
        },
        title: "补充新闻",
        url: "https://example.com/extra",
        content: "",
        publishedAt: "2026-05-06T23:30:00.000Z",
        fetchedAt: "2026-05-07T00:00:00.000Z",
        metadata: {
          rank: 2,
          newsnow: {
            id: "item-2",
            updatedTime: 1778136000000,
            extra: { date: "2026-05-06T23:30:00.000Z" }
          }
        }
      }
    ]);
  });

  it("服务失败时返回信源级错误", async () => {
    const adapter = new NewsNowAdapter({
      newsApiBaseUrl: "https://news.example.test",
      fetch: async () => new Response("网关错误", { status: 502 }),
      now: () => new Date("2026-05-07T00:00:00.000Z")
    });

    const result = await adapter.fetchSource({
      id: "weibo",
      name: "微博热搜",
      type: "newsnow",
      sourceId: "weibo",
      weight: 1
    });

    expect(result.items).toEqual([]);
    expect(result.error).toContain("NewsNow 请求失败：weibo: 502");
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/tools/src/newsnow-adapter.test.ts
```

预期：失败，并出现 `./newsnow-adapter.js` 的模块解析错误。

- [ ] **步骤 3：添加 NewsNow 适配器**

创建 `packages/tools/src/newsnow-adapter.ts`：

```ts
import { z } from "zod";
import type { NewsSourceConfig } from "../../config/src/index.js";

const NewsNowItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  pubDate: z.number().optional(),
  extra: z.record(z.string(), z.unknown()).optional()
});

const NewsNowResponseSchema = z.object({
  status: z.enum(["success", "cache"]),
  id: z.string(),
  updatedTime: z.number().optional(),
  items: z.array(NewsNowItemSchema)
});

export interface RawNewsItem {
  id: string;
  source: {
    id: string;
    name: string;
    url?: string;
    type: "newsnow";
    weight: number;
  };
  title: string;
  url?: string;
  content: string;
  publishedAt?: string;
  fetchedAt: string;
  metadata: Record<string, unknown>;
}

export interface NewsNowAdapterOptions {
  newsApiBaseUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface FetchSourceResult {
  sourceId: string;
  items: RawNewsItem[];
  error?: string;
}

export class NewsNowAdapter {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: NewsNowAdapterOptions) {
    this.baseUrl = options.newsApiBaseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async fetchSource(source: NewsSourceConfig): Promise<FetchSourceResult> {
    const sourceId = source.sourceId ?? source.id;
    const url = `${this.baseUrl}/api/s?id=${encodeURIComponent(sourceId)}`;

    try {
      const response = await this.fetchFn(url);
      if (!response.ok) {
        return { sourceId: source.id, items: [], error: `NewsNow 请求失败：${source.id}: ${response.status}` };
      }

      const payload = NewsNowResponseSchema.parse(await response.json());
      const fetchedAt = this.now().toISOString();
      const items = payload.items.map((item, index): RawNewsItem => ({
        id: `${source.id}:${item.id}`,
        source: {
          id: source.id,
          name: source.name,
          url: source.url,
          type: source.type,
          weight: source.weight
        },
        title: item.title,
        url: item.url,
        content: "",
        publishedAt: normalizePublishedAt(item.pubDate, item.extra?.date),
        fetchedAt,
        metadata: {
          rank: index + 1,
          newsnow: {
            id: item.id,
            updatedTime: payload.updatedTime,
            extra: item.extra ?? {}
          }
        }
      }));

      return { sourceId: source.id, items };
    } catch (error) {
      return { sourceId: source.id, items: [], error: `NewsNow 请求失败：${source.id}: ${(error as Error).message}` };
    }
  }
}

function normalizePublishedAt(pubDate: number | undefined, extraDate: unknown): string | undefined {
  if (typeof pubDate === "number") {
    return new Date(pubDate).toISOString();
  }
  if (typeof extraDate === "number" || typeof extraDate === "string") {
    const date = new Date(extraDate);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}
```

- [ ] **步骤 4：运行 NewsNow 测试**

运行：

```bash
pnpm test -- packages/tools/src/newsnow-adapter.test.ts
```

预期：通过 2 个测试。

- [ ] **步骤 5：提交**

```bash
git add packages/tools/src/newsnow-adapter.ts packages/tools/src/newsnow-adapter.test.ts
git commit -m "feat: add newsnow adapter"
```

## 任务 5：Tool 注册表与内置工具

**文件：**
- 创建：`packages/tools/src/tool-registry.ts`
- 创建：`packages/tools/src/builtin-tools.ts`
- 创建：`packages/tools/src/index.ts`
- 测试：`packages/tools/src/tool-registry.test.ts`
- 测试：`packages/tools/src/builtin-tools.test.ts`

- [ ] **步骤 1：编写失败的注册表测试**

创建 `packages/tools/src/tool-registry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tool-registry.js";

describe("ToolRegistry", () => {
  it("按名称分发已注册的 tool", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "回显输入",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (input) => ({ text: (input as { text: string }).text })
    });

    await expect(registry.execute("echo", { text: "hello" })).resolves.toEqual({ text: "hello" });
  });

  it("未知 tool 抛出带名称的错误", async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute("missing", {})).rejects.toThrow("Tool 未注册：missing");
  });
});
```

- [ ] **步骤 2：编写失败的内置工具测试**

创建 `packages/tools/src/builtin-tools.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import { createBuiltinTools } from "./builtin-tools.js";
import type { FetchSourceResult } from "./newsnow-adapter.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [];
  data = new Map<string, unknown>();

  async writeArtifact(input: { type: ArtifactRef["type"]; data: unknown; metadata?: Record<string, unknown> }) {
    const ref: ArtifactRef = {
      id: `${input.type}-${this.refs.length + 1}`,
      type: input.type,
      path: `${input.type}-${this.refs.length + 1}.json`,
      createdAt: "2026-05-07T00:00:00.000Z"
    };
    this.refs.push(ref);
    this.data.set(ref.id, { ref, data: input.data, metadata: input.metadata ?? {} });
    return ref;
  }

  async readArtifact(ref: ArtifactRef) {
    return this.data.get(ref.id) as never;
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("createBuiltinTools", () => {
  it("爬取已配置信源并写入 raw news artifact", async () => {
    const archive = new MemoryArchiveStore();
    const sources: NewsSourceConfig[] = [
      { id: "weibo", name: "微博热搜", type: "newsnow", sourceId: "weibo", weight: 1 }
    ];

    const tools = createBuiltinTools({
      archive,
      sources,
      newsFetcher: {
        fetchSource: async (): Promise<FetchSourceResult> => ({
          sourceId: "weibo",
          items: [{
            id: "weibo:item-1",
            source: { id: "weibo", name: "微博热搜", type: "newsnow", weight: 1 },
            title: "重大新闻",
            content: "",
            fetchedAt: "2026-05-07T00:00:00.000Z",
            metadata: { rank: 1 }
          }]
        })
      }
    });

    const output = await tools.execute("crawl_news", { windowHours: 24 });

    expect(output).toMatchObject({
      artifactRef: { id: "news.raw-1", type: "news.raw" },
      itemCount: 1,
      sourceErrors: []
    });
  });
});
```

- [ ] **步骤 3：运行测试确认失败**

运行：

```bash
pnpm test -- packages/tools/src/tool-registry.test.ts packages/tools/src/builtin-tools.test.ts
```

预期：失败，并出现 `tool-registry.js` 和 `builtin-tools.js` 的模块解析错误。

- [ ] **步骤 4：添加 tool 注册表**

创建 `packages/tools/src/tool-registry.ts`：

```ts
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: TInput): Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute<TOutput = unknown>(name: string, input: unknown): Promise<TOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool 未注册：${name}`);
    }
    return tool.execute(input) as Promise<TOutput>;
  }
}
```

- [ ] **步骤 5：添加内置工具**

创建 `packages/tools/src/builtin-tools.ts`：

```ts
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { NewsSourceConfig } from "../../config/src/index.js";
import type { NewsNowAdapter } from "./newsnow-adapter.js";
import { ToolRegistry } from "./tool-registry.js";

export interface BuiltinToolsOptions {
  archive: ArchiveStore;
  sources: NewsSourceConfig[];
  newsFetcher: Pick<NewsNowAdapter, "fetchSource">;
  workflowStatus?: (runId: string) => Promise<unknown>;
  workflowRun?: (workflowId: string, input: Record<string, unknown>) => Promise<unknown>;
}

export function createBuiltinTools(options: BuiltinToolsOptions): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "crawl_news",
    description: "抓取已配置的 NewsNow 信源并写入 raw news artifact。",
    inputSchema: {
      type: "object",
      properties: { windowHours: { type: "number" } },
      required: ["windowHours"]
    },
    execute: async (input) => {
      const windowHours = (input as { windowHours?: number }).windowHours ?? 24;
      const sourceResults = await Promise.all(options.sources.map((source) => options.newsFetcher.fetchSource(source)));
      const items = sourceResults.flatMap((result) => result.items);
      const sourceErrors = sourceResults
        .filter((result) => result.error)
        .map((result) => ({ sourceId: result.sourceId, error: result.error }));
      const artifactRef = await options.archive.writeArtifact({
        type: "news.raw",
        data: {
          windowHours,
          fetchedAt: new Date().toISOString(),
          items,
          sourceErrors
        },
        metadata: { itemCount: items.length, sourceCount: options.sources.length }
      });
      return { artifactRef, itemCount: items.length, sourceErrors };
    }
  });

  registry.register({
    name: "read_archive",
    description: "按 ref 读取 archive artifact。",
    inputSchema: { type: "object", properties: { ref: { type: "object" } }, required: ["ref"] },
    execute: async (input) => options.archive.readArtifact((input as { ref: ArtifactRef }).ref)
  });

  registry.register({
    name: "write_archive",
    description: "写入 archive artifact。",
    inputSchema: { type: "object", properties: { type: { type: "string" }, data: {} }, required: ["type", "data"] },
    execute: async (input) => options.archive.writeArtifact(input as never)
  });

  registry.register({
    name: "list_reports",
    description: "列出 report artifacts。",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    execute: async (input) => options.archive.listArtifacts({ type: "reports", limit: (input as { limit?: number }).limit })
  });

  registry.register({
    name: "read_report",
    description: "按 ref 读取 report artifact。",
    inputSchema: { type: "object", properties: { ref: { type: "object" } }, required: ["ref"] },
    execute: async (input) => options.archive.readArtifact((input as { ref: ArtifactRef }).ref)
  });

  registry.register({
    name: "run_workflow",
    description: "运行固定 workflow。",
    inputSchema: { type: "object", properties: { workflowId: { type: "string" }, input: { type: "object" } }, required: ["workflowId"] },
    execute: async (input) => {
      if (!options.workflowRun) {
        throw new Error("Workflow runner 未配置");
      }
      const request = input as { workflowId: string; input?: Record<string, unknown> };
      return options.workflowRun(request.workflowId, request.input ?? {});
    }
  });

  registry.register({
    name: "get_workflow_status",
    description: "读取 workflow run 状态。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
    execute: async (input) => {
      if (!options.workflowStatus) {
        throw new Error("Workflow status reader 未配置");
      }
      return options.workflowStatus((input as { runId: string }).runId);
    }
  });

  return registry;
}
```

- [ ] **步骤 6：导出 tools 包**

创建 `packages/tools/src/index.ts`：

```ts
export * from "./newsnow-adapter.js";
export * from "./tool-registry.js";
export * from "./builtin-tools.js";
```

- [ ] **步骤 7：运行 tool 测试**

运行：

```bash
pnpm test -- packages/tools/src/tool-registry.test.ts packages/tools/src/builtin-tools.test.ts
```

预期：通过 3 个测试。

- [ ] **步骤 8：提交**

```bash
git add packages/tools/src
git commit -m "feat: add builtin tool registry"
```

## 任务 6：Skills 包

**文件：**
- 创建：`packages/skills/src/skill-loader.ts`
- 创建：`packages/skills/src/index.ts`
- 创建：`packages/skills/skills/analyze-hot-topics/SKILL.md`
- 创建：`packages/skills/skills/analyze-hot-topics/output.schema.json`
- 创建：`packages/skills/skills/generate-report/SKILL.md`
- 创建：`packages/skills/skills/generate-report/output.schema.json`
- 创建：`packages/skills/skills/read-report/SKILL.md`
- 创建：`packages/skills/skills/read-report/output.schema.json`
- 测试：`packages/skills/src/skill-loader.test.ts`

- [ ] **步骤 1：编写失败的 skill loader 测试**

创建 `packages/skills/src/skill-loader.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { SkillLoader } from "./skill-loader.js";

describe("SkillLoader", () => {
  it("加载内置 skill 的 prompt 和输出 schema", async () => {
    const loader = new SkillLoader({ skillsDir: "packages/skills/skills" });
    const skill = await loader.load("analyze-hot-topics");

    expect(skill.id).toBe("analyze-hot-topics");
    expect(skill.prompt).toContain("为新闻增加热点评分");
    expect(skill.outputSchema).toMatchObject({
      type: "object",
      required: ["annotations", "topics"]
    });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/skills/src/skill-loader.test.ts
```

预期：失败，并出现 `./skill-loader.js` 的模块解析错误。

- [ ] **步骤 3：添加 skill loader**

创建 `packages/skills/src/skill-loader.ts`：

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  id: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}

export interface SkillLoaderOptions {
  skillsDir: string;
}

export class SkillLoader {
  private readonly skillsDir: string;

  constructor(options: SkillLoaderOptions) {
    this.skillsDir = options.skillsDir;
  }

  async load(id: string): Promise<Skill> {
    const dir = join(this.skillsDir, id);
    const [prompt, schemaRaw] = await Promise.all([
      readFile(join(dir, "SKILL.md"), "utf8"),
      readFile(join(dir, "output.schema.json"), "utf8")
    ]);
    return { id, prompt, outputSchema: JSON.parse(schemaRaw) as Record<string, unknown> };
  }
}
```

- [ ] **步骤 4：添加分析 skill prompt**

创建 `packages/skills/skills/analyze-hot-topics/SKILL.md`：

```markdown
# 分析热点主题

你为新闻增加热点评分、主题归属和简短理由。输入包含 raw news items、信源权重和 analysis profile。

规则：
- 输出 `annotations` 数组，只包含新闻 `id` 和要追加的 `annotations`，不要重写新闻标题、正文、URL 或信源。
- `score` 是 0 到 1 之间的数字，综合内容重要性、信源权重、多源交叉、新鲜度和 analysis profile。
- `topicIds` 必须引用本次输出 `topics` 中存在的 `topicId`。
- topic 由新闻内容开放生成，不使用固定枚举。
- 不重复保存完整正文到 topic index，topic 只保存聚合信息和 news refs。
- 输出必须符合 JSON schema，不包含 markdown。
```

- [ ] **步骤 5：添加分析输出 schema**

创建 `packages/skills/skills/analyze-hot-topics/output.schema.json`：

```json
{
  "type": "object",
  "required": ["annotations", "topics"],
  "properties": {
    "annotations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "annotations"],
        "properties": {
          "id": { "type": "string" },
          "annotations": {
            "type": "object",
            "required": ["score", "topicIds", "reason"],
            "properties": {
              "score": { "type": "number", "minimum": 0, "maximum": 1 },
              "topicIds": { "type": "array", "items": { "type": "string" } },
              "reason": { "type": "string" }
            }
          }
        },
        "additionalProperties": true
      }
    },
    "topics": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["topicId", "title", "heat", "keywords", "newsRefs"],
        "properties": {
          "topicId": { "type": "string" },
          "title": { "type": "string" },
          "heat": { "type": "number", "minimum": 0, "maximum": 1 },
          "keywords": { "type": "array", "items": { "type": "string" } },
          "newsRefs": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **步骤 6：添加报告生成 skill 文件**

创建 `packages/skills/skills/generate-report/SKILL.md`：

```markdown
# 生成报告

你基于窗口内 annotated news 和 topic index 生成热点报告。

规则：
- 报告必须说明窗口范围、关键热点、支撑新闻和风险提醒。
- 使用 topic index 作为结构主线，使用 annotated news 作为证据。
- 不虚构新闻源、链接、发布时间或正文。
- 输出必须符合 JSON schema，不包含 markdown。
```

创建 `packages/skills/skills/generate-report/output.schema.json`：

```json
{
  "type": "object",
  "required": ["title", "summary", "window", "sections"],
  "properties": {
    "title": { "type": "string" },
    "summary": { "type": "string" },
    "window": {
      "type": "object",
      "required": ["startedAt", "endedAt", "hours"],
      "properties": {
        "startedAt": { "type": "string" },
        "endedAt": { "type": "string" },
        "hours": { "type": "number" }
      }
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["heading", "body", "topicIds", "newsRefs"],
        "properties": {
          "heading": { "type": "string" },
          "body": { "type": "string" },
          "topicIds": { "type": "array", "items": { "type": "string" } },
          "newsRefs": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **步骤 7：添加报告阅读 skill 文件**

创建 `packages/skills/skills/read-report/SKILL.md`：

```markdown
# 阅读报告

你阅读历史报告并回答用户问题。

规则：
- 只基于提供的 report artifact 回答。
- 如果报告中没有答案，直接说明报告未包含该信息。
- 回答需要引用相关 section heading 或 news refs。
- 输出必须符合 JSON schema，不包含 markdown。
```

创建 `packages/skills/skills/read-report/output.schema.json`：

```json
{
  "type": "object",
  "required": ["answer", "citations"],
  "properties": {
    "answer": { "type": "string" },
    "citations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["artifactId", "label"],
        "properties": {
          "artifactId": { "type": "string" },
          "label": { "type": "string" }
        }
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **步骤 8：导出 skills 包**

创建 `packages/skills/src/index.ts`：

```ts
export * from "./skill-loader.js";
```

- [ ] **步骤 9：运行 skill 测试**

运行：

```bash
pnpm test -- packages/skills/src/skill-loader.test.ts
```

预期：通过 1 个测试。

- [ ] **步骤 10：提交**

```bash
git add packages/skills
git commit -m "feat: add built in skill prompts"
```

## 任务 7：Workflow Core 类型与内置描述符

**文件：**
- 创建：`packages/workflow-core/src/types.ts`
- 创建：`packages/workflow-core/src/builtins.ts`
- 创建：`packages/workflow-core/src/index.ts`
- 测试：`packages/workflow-core/src/builtins.test.ts`

- [ ] **步骤 1：编写失败的 workflow descriptor 测试**

创建 `packages/workflow-core/src/builtins.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { builtinWorkflows } from "./builtins.js";

describe("builtinWorkflows", () => {
  it("定义日报和半周报 workflow", () => {
    expect(builtinWorkflows.daily_news_report.defaultInput).toMatchObject({
      reportType: "daily",
      windowHours: 24,
      analysisProfileId: "default"
    });
    expect(builtinWorkflows.semiweekly_news_report.defaultInput).toMatchObject({
      reportType: "semiweekly",
      windowHours: 96,
      analysisProfileId: "default"
    });
    expect(builtinWorkflows.daily_news_report.steps.map((step) => step.id)).toEqual([
      "crawl_news",
      "annotate_news",
      "generate_report"
    ]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/workflow-core/src/builtins.test.ts
```

预期：失败，并出现 `./builtins.js` 的模块解析错误。

- [ ] **步骤 3：添加 workflow 类型**

创建 `packages/workflow-core/src/types.ts`：

```ts
import type { ArtifactRef } from "../../archive/src/index.js";

export type WorkflowStepKind = "tool" | "llm";
export type RunStatus = "running" | "succeeded" | "failed";

export interface WorkflowInput {
  reportType: "daily" | "semiweekly";
  windowHours: number;
  analysisProfileId: string;
}

export interface ToolWorkflowStep {
  id: string;
  kind: "tool";
  uses: string;
  output: string;
}

export interface LlmWorkflowStep {
  id: string;
  kind: "llm";
  skill: string;
  input: string | string[];
  output: string | string[];
  outputSchema: string;
}

export type WorkflowStep = ToolWorkflowStep | LlmWorkflowStep;

export interface WorkflowDefinition {
  id: string;
  defaultInput: WorkflowInput;
  steps: WorkflowStep[];
}

export interface StepRecord {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  inputRefs: ArtifactRef[];
  outputRefs: ArtifactRef[];
  error: string | null;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  input: WorkflowInput;
  steps: StepRecord[];
}

export interface ModelClient {
  generateStructured(input: {
    system: string;
    user: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}
```

- [ ] **步骤 4：添加内置 workflow descriptor**

创建 `packages/workflow-core/src/builtins.ts`：

```ts
import type { WorkflowDefinition } from "./types.js";

const reportSteps: WorkflowDefinition["steps"] = [
  {
    id: "crawl_news",
    kind: "tool",
    uses: "crawl_news",
    output: "news.raw"
  },
  {
    id: "annotate_news",
    kind: "llm",
    skill: "analyze-hot-topics",
    input: "news.raw",
    output: ["news.annotated", "topics.index"],
    outputSchema: "skills/analyze-hot-topics/output.schema.json"
  },
  {
    id: "generate_report",
    kind: "llm",
    skill: "generate-report",
    input: ["news.annotated", "topics.index"],
    output: "reports",
    outputSchema: "skills/generate-report/output.schema.json"
  }
];

export const builtinWorkflows = {
  daily_news_report: {
    id: "daily_news_report",
    defaultInput: {
      reportType: "daily",
      windowHours: 24,
      analysisProfileId: "default"
    },
    steps: reportSteps
  },
  semiweekly_news_report: {
    id: "semiweekly_news_report",
    defaultInput: {
      reportType: "semiweekly",
      windowHours: 96,
      analysisProfileId: "default"
    },
    steps: reportSteps
  }
} satisfies Record<string, WorkflowDefinition>;
```

- [ ] **步骤 5：导出 workflow 包**

创建 `packages/workflow-core/src/index.ts`：

```ts
export * from "./types.js";
export * from "./builtins.js";
```

- [ ] **步骤 6：运行 descriptor 测试**

运行：

```bash
pnpm test -- packages/workflow-core/src/builtins.test.ts
```

预期：通过 1 个测试。

- [ ] **步骤 7：提交**

```bash
git add packages/workflow-core/src/types.ts packages/workflow-core/src/builtins.ts packages/workflow-core/src/index.ts packages/workflow-core/src/builtins.test.ts
git commit -m "feat: define builtin report workflows"
```

## 任务 8：Workflow Runner

**文件：**
- 创建：`packages/workflow-core/src/workflow-runner.ts`
- 测试：`packages/workflow-core/src/workflow-runner.test.ts`
- 修改：`packages/workflow-core/src/index.ts`

- [ ] **步骤 1：编写失败的 workflow runner 测试**

创建 `packages/workflow-core/src/workflow-runner.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { AnalysisProfile } from "../../config/src/index.js";
import { SkillLoader } from "../../skills/src/index.js";
import { ToolRegistry } from "../../tools/src/index.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowRunner } from "./workflow-runner.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [];
  artifacts = new Map<string, { ref: ArtifactRef; data: unknown; metadata: Record<string, unknown> }>();

  async writeArtifact(input: { type: ArtifactRef["type"]; data: unknown; metadata?: Record<string, unknown> }) {
    const ref: ArtifactRef = {
      id: `${input.type}-${this.refs.length + 1}`,
      type: input.type,
      path: `${input.type}-${this.refs.length + 1}.json`,
      createdAt: "2026-05-07T00:00:00.000Z"
    };
    this.refs.push(ref);
    this.artifacts.set(ref.id, { ref, data: input.data, metadata: input.metadata ?? {} });
    return ref;
  }

  async readArtifact(ref: ArtifactRef) {
    return this.artifacts.get(ref.id) as never;
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("WorkflowRunner", () => {
  it("顺序运行 tool 和 LLM step 并写入 run record", async () => {
    const archive = new MemoryArchiveStore();
    const analysisProfiles: AnalysisProfile[] = [{
      id: "default",
      focus: ["科技热点"],
      instruction: "更关注技术产业变化。"
    }];
    const tools = new ToolRegistry();
    tools.register({
      name: "crawl_news",
      description: "crawl",
      inputSchema: {},
      execute: async () => {
        const artifactRef = await archive.writeArtifact({
          type: "news.raw",
          data: { items: [{ id: "n1", title: "新闻" }] }
        });
        return { artifactRef, itemCount: 1, sourceErrors: [] };
      }
    });

    const workflow: WorkflowDefinition = {
      id: "daily_news_report",
      defaultInput: { reportType: "daily", windowHours: 24, analysisProfileId: "default" },
      steps: [
        { id: "crawl_news", kind: "tool", uses: "crawl_news", output: "news.raw" },
        {
          id: "annotate_news",
          kind: "llm",
          skill: "analyze-hot-topics",
          input: "news.raw",
          output: ["news.annotated", "topics.index"],
          outputSchema: "skills/analyze-hot-topics/output.schema.json"
        },
        {
          id: "generate_report",
          kind: "llm",
          skill: "generate-report",
          input: ["news.annotated", "topics.index"],
          output: "reports",
          outputSchema: "skills/generate-report/output.schema.json"
        }
      ]
    };

    let modelCalls = 0;

    const runner = new WorkflowRunner({
      archive,
      tools,
      skillLoader: new SkillLoader({ skillsDir: "packages/skills/skills" }),
      analysisProfiles,
      modelClient: {
        generateStructured: async ({ user }) => {
          modelCalls += 1;
          const context = JSON.parse(user) as { analysisProfile?: AnalysisProfile };
          expect(context.analysisProfile).toEqual(analysisProfiles[0]);
          if (modelCalls === 1) {
            return {
              annotations: [{ id: "n1", annotations: { score: 0.9, topicIds: ["topic-1"], reason: "重要" } }],
              topics: [{ topicId: "topic-1", title: "热点", heat: 0.9, keywords: ["热点"], newsRefs: ["n1"] }]
            };
          }
          return {
            title: "日报",
            summary: "热点摘要",
            window: {
              startedAt: "2026-05-06T00:00:00.000Z",
              endedAt: "2026-05-07T00:00:00.000Z",
              hours: 24
            },
            sections: [{ heading: "热点", body: "重要事件", topicIds: ["topic-1"], newsRefs: ["n1"] }]
          };
        }
      },
      now: () => new Date("2026-05-07T00:00:00.000Z"),
      idFactory: () => "run-1"
    });

    const record = await runner.run(workflow, {});

    expect(record.status).toBe("succeeded");
    expect(record.steps.map((step) => step.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(archive.refs.map((ref) => ref.type)).toEqual(["news.raw", "news.annotated", "topics.index", "reports", "runs"]);
    const annotated = archive.artifacts.get("news.annotated-2");
    expect(annotated?.data).toMatchObject({
      items: [{ id: "n1", title: "新闻", annotations: { score: 0.9, topicIds: ["topic-1"], reason: "重要" } }]
    });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/workflow-core/src/workflow-runner.test.ts
```

预期：失败，并出现 `./workflow-runner.js` 的模块解析错误。

- [ ] **步骤 3：添加 workflow runner 实现**

创建 `packages/workflow-core/src/workflow-runner.ts`：

```ts
import Ajv from "ajv";
import type { ArchiveStore, ArtifactRef, ArtifactType } from "../../archive/src/index.js";
import type { AnalysisProfile } from "../../config/src/index.js";
import type { SkillLoader } from "../../skills/src/index.js";
import type { ToolRegistry } from "../../tools/src/index.js";
import type { LlmWorkflowStep, ModelClient, RunRecord, StepRecord, WorkflowDefinition, WorkflowInput, WorkflowStep } from "./types.js";

export interface WorkflowRunnerOptions {
  archive: ArchiveStore;
  tools: ToolRegistry;
  skillLoader: SkillLoader;
  analysisProfiles: AnalysisProfile[];
  modelClient: ModelClient;
  now?: () => Date;
  idFactory?: () => string;
}

export class WorkflowRunner {
  private readonly archive: ArchiveStore;
  private readonly tools: ToolRegistry;
  private readonly skillLoader: SkillLoader;
  private readonly analysisProfiles: AnalysisProfile[];
  private readonly modelClient: ModelClient;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly ajv = new Ajv({ allErrors: true });

  constructor(options: WorkflowRunnerOptions) {
    this.archive = options.archive;
    this.tools = options.tools;
    this.skillLoader = options.skillLoader;
    this.analysisProfiles = options.analysisProfiles;
    this.modelClient = options.modelClient;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async run(workflow: WorkflowDefinition, inputOverride: Partial<WorkflowInput>): Promise<RunRecord> {
    const input = { ...workflow.defaultInput, ...inputOverride };
    const record: RunRecord = {
      id: this.idFactory(),
      workflowId: workflow.id,
      status: "running",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      input,
      steps: []
    };
    const outputs = new Map<string, ArtifactRef[]>();

    try {
      const analysisProfile = this.resolveAnalysisProfile(input.analysisProfileId);
      for (const step of workflow.steps) {
        const stepRecord = await this.runStep(step, input, analysisProfile, outputs);
        record.steps.push(stepRecord);
        if (stepRecord.status === "failed") {
          record.status = "failed";
          break;
        }
      }
      if (record.status === "running") {
        record.status = "succeeded";
      }
    } catch (error) {
      record.status = "failed";
      const lastStep = record.steps.at(-1);
      if (lastStep && lastStep.status === "running") {
        lastStep.status = "failed";
        lastStep.finishedAt = this.now().toISOString();
        lastStep.error = (error as Error).message;
      }
    } finally {
      record.finishedAt = this.now().toISOString();
      await this.archive.writeArtifact({ type: "runs", data: record, metadata: { workflowId: workflow.id } });
    }

    return record;
  }

  private async runStep(
    step: WorkflowStep,
    workflowInput: WorkflowInput,
    analysisProfile: AnalysisProfile,
    outputs: Map<string, ArtifactRef[]>
  ): Promise<StepRecord> {
    const stepRecord: StepRecord = {
      id: step.id,
      status: "running",
      startedAt: this.now().toISOString(),
      finishedAt: null,
      inputRefs: this.resolveInputRefs(step, outputs),
      outputRefs: [],
      error: null
    };

    try {
      if (step.kind === "tool") {
        const result = await this.tools.execute<{ artifactRef?: ArtifactRef }>(step.uses, workflowInput);
        if (result.artifactRef) {
          stepRecord.outputRefs.push(result.artifactRef);
          outputs.set(step.output, [result.artifactRef]);
        }
      } else {
        const refs = await this.runLlmStep(step, workflowInput, analysisProfile, stepRecord.inputRefs);
        stepRecord.outputRefs.push(...refs);
        const outputKeys = Array.isArray(step.output) ? step.output : [step.output];
        outputKeys.forEach((key, index) => outputs.set(key, refs[index] ? [refs[index]] : []));
      }
      stepRecord.status = "succeeded";
    } catch (error) {
      stepRecord.status = "failed";
      stepRecord.error = (error as Error).message;
    } finally {
      stepRecord.finishedAt = this.now().toISOString();
    }

    return stepRecord;
  }

  private resolveInputRefs(step: WorkflowStep, outputs: Map<string, ArtifactRef[]>): ArtifactRef[] {
    if (step.kind === "tool") {
      return [];
    }
    const keys = Array.isArray(step.input) ? step.input : [step.input];
    return keys.flatMap((key) => outputs.get(key) ?? []);
  }

  private async runLlmStep(
    step: LlmWorkflowStep,
    workflowInput: WorkflowInput,
    analysisProfile: AnalysisProfile,
    inputRefs: ArtifactRef[]
  ): Promise<ArtifactRef[]> {
    const skill = await this.skillLoader.load(step.skill);
    const artifacts = await Promise.all(inputRefs.map((ref) => this.archive.readArtifact(ref)));
    const structured = await this.modelClient.generateStructured({
      system: skill.prompt,
      user: JSON.stringify({ workflowInput, analysisProfile, artifacts }),
      schema: skill.outputSchema
    });
    this.validateStructuredOutput(step.skill, skill.outputSchema, structured);

    if (step.skill === "analyze-hot-topics") {
      // 首版只有 analyze-hot-topics 需要拆分成 annotated news 与 topic index 两个 artifact。
      // 这里先保持显式分支，后续引入通用多输出映射时再泛化。
      const output = structured as {
        annotations: Array<{ id: string; annotations: unknown }>;
        topics: unknown;
      };
      const annotationById = new Map(output.annotations.map((item) => [item.id, item.annotations]));
      const rawItems = artifacts.flatMap((artifact) => {
        const data = artifact.data as { items?: Array<Record<string, unknown>> };
        return data.items ?? [];
      });
      const annotatedItems = rawItems.map((item) => ({
        ...item,
        annotations: annotationById.get(String(item.id)) ?? {
          score: 0,
          topicIds: [],
          reason: "LLM 没有为这条新闻返回 annotation。"
        }
      }));
      return Promise.all([
        this.archive.writeArtifact({ type: "news.annotated", data: { items: annotatedItems }, metadata: { skill: step.skill } }),
        this.archive.writeArtifact({ type: "topics.index", data: output.topics, metadata: { skill: step.skill } })
      ]);
    }

    const outputType = Array.isArray(step.output) ? step.output[0] : step.output;
    return [
      await this.archive.writeArtifact({
        type: outputType as ArtifactType,
        data: structured,
        metadata: { skill: step.skill }
      })
    ];
  }

  private validateStructuredOutput(skillId: string, schema: Record<string, unknown>, value: unknown): void {
    const validate = this.ajv.compile(schema);
    if (!validate(value)) {
      throw new Error(`LLM output failed schema validation for ${skillId}: ${this.ajv.errorsText(validate.errors)}`);
    }
  }

  private resolveAnalysisProfile(profileId: string): AnalysisProfile {
    const profile = this.analysisProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new Error(`Analysis profile not found: ${profileId}`);
    }
    return profile;
  }
}
```

- [ ] **步骤 4：导出 workflow runner**

修改 `packages/workflow-core/src/index.ts`：

```ts
export * from "./types.js";
export * from "./builtins.js";
export * from "./workflow-runner.js";
```

- [ ] **步骤 5：运行 workflow runner 测试**

运行：

```bash
pnpm test -- packages/workflow-core/src/workflow-runner.test.ts
```

预期：通过 1 个测试。

- [ ] **步骤 6：运行全部 workflow 测试**

运行：

```bash
pnpm test -- packages/workflow-core/src
```

预期：通过 2 个测试。

- [ ] **步骤 7：提交**

```bash
git add packages/workflow-core/src
git commit -m "feat: add sequential workflow runner"
```

## 任务 9：Agent Core

**文件：**
- 创建：`packages/agent-core/src/subagent.ts`
- 创建：`packages/agent-core/src/openai-model-client.ts`
- 创建：`packages/agent-core/src/agent-session.ts`
- 创建：`packages/agent-core/src/index.ts`
- 测试：`packages/agent-core/src/agent-session.test.ts`

- [ ] **步骤 1：编写失败的 agent session 测试**

创建 `packages/agent-core/src/agent-session.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import { ToolRegistry } from "../../tools/src/index.js";
import { AgentSession } from "./agent-session.js";

class MemoryArchiveStore implements ArchiveStore {
  refs: ArtifactRef[] = [{
    id: "reports-1",
    type: "reports",
    path: "reports-1.json",
    createdAt: "2026-05-07T00:00:00.000Z"
  }];

  async writeArtifact(): Promise<ArtifactRef> {
    throw new Error("未使用");
  }

  async readArtifact(ref: ArtifactRef) {
    return { ref, data: { title: "日报", summary: "今日科技热点升温。" }, metadata: {} };
  }

  async listArtifacts() {
    return this.refs;
  }
}

describe("AgentSession", () => {
  it("配置 model client 后基于 archive 回答报告问题", async () => {
    const archive = new MemoryArchiveStore();
    const tools = new ToolRegistry();
    const session = new AgentSession({
      archive,
      tools,
      modelClient: {
        generateStructured: async ({ user }) => ({
          answer: `基于报告回答：${JSON.parse(user).question}`,
          citations: [{ artifactId: "reports-1", label: "日报" }]
        })
      }
    });

    const response = await session.ask("今天有什么热点？");

    expect(response.text).toContain("今天有什么热点");
    expect(response.citations).toEqual([{ artifactId: "reports-1", label: "日报" }]);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- packages/agent-core/src/agent-session.test.ts
```

预期：失败，并出现 `./agent-session.js` 的模块解析错误。

- [ ] **步骤 3：添加 subagent 预留接口**

创建 `packages/agent-core/src/subagent.ts`：

```ts
export interface SubagentTask {
  id: string;
  instruction: string;
  input?: Record<string, unknown>;
}

export interface SubagentResult {
  taskId: string;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
}

export interface SubagentService {
  spawn(task: SubagentTask): Promise<SubagentResult>;
}

export class NotImplementedSubagentService implements SubagentService {
  async spawn(task: SubagentTask): Promise<SubagentResult> {
    return {
      taskId: task.id,
      status: "failed",
      error: "首版未实现 subagent runtime"
    };
  }
}
```

- [ ] **步骤 4：添加 OpenAI model adapter**

创建 `packages/agent-core/src/openai-model-client.ts`：

```ts
import OpenAI from "openai";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface OpenAIModelClientOptions {
  apiKey?: string;
  model?: string;
}

export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIModelClientOptions = {}) {
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    const model = options.model ?? process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error("必须提供 OpenAI model。请传入 model 或设置 OPENAI_MODEL。");
    }
    this.model = model;
  }

  async generateStructured(input: { system: string; user: string; schema: Record<string, unknown> }): Promise<unknown> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "hot_board_output",
          schema: input.schema,
          strict: true
        }
      }
    });

    const text = response.choices[0]?.message.content;
    if (!text) {
      throw new Error("OpenAI chat completion 没有包含 message content");
    }
    return JSON.parse(text);
  }
}
```

- [ ] **步骤 5：添加 AgentSession**

创建 `packages/agent-core/src/agent-session.ts`：

```ts
import type { ArchiveStore, ArtifactRef } from "../../archive/src/index.js";
import type { ToolRegistry } from "../../tools/src/index.js";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface AgentSessionOptions {
  archive: ArchiveStore;
  tools: ToolRegistry;
  modelClient: ModelClient;
}

export interface AgentResponse {
  text: string;
  citations: Array<{ artifactId: string; label: string }>;
}

export class AgentSession {
  private readonly archive: ArchiveStore;
  private readonly tools: ToolRegistry;
  private readonly modelClient: ModelClient;

  constructor(options: AgentSessionOptions) {
    this.archive = options.archive;
    this.tools = options.tools;
    this.modelClient = options.modelClient;
  }

  async ask(question: string): Promise<AgentResponse> {
    const reports = await this.archive.listArtifacts({ type: "reports", limit: 5 });
    const reportArtifacts = await Promise.all(reports.map((ref: ArtifactRef) => this.archive.readArtifact(ref)));
    const output = await this.modelClient.generateStructured({
      system: "你是 Hot Board Monitor 的报告阅读助手。只基于提供的报告回答问题。",
      user: JSON.stringify({ question, reports: reportArtifacts }),
      schema: {
        type: "object",
        required: ["answer", "citations"],
        properties: {
          answer: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              required: ["artifactId", "label"],
              properties: {
                artifactId: { type: "string" },
                label: { type: "string" }
              }
            }
          }
        },
        additionalProperties: false
      }
    }) as { answer: string; citations: Array<{ artifactId: string; label: string }> };

    return { text: output.answer, citations: output.citations };
  }

  async runTool<TOutput = unknown>(name: string, input: unknown): Promise<TOutput> {
    return this.tools.execute<TOutput>(name, input);
  }
}
```

- [ ] **步骤 6：导出 agent 包**

创建 `packages/agent-core/src/index.ts`：

```ts
export * from "./agent-session.js";
export * from "./openai-model-client.js";
export * from "./subagent.js";
```

- [ ] **步骤 7：运行 agent 测试**

运行：

```bash
pnpm test -- packages/agent-core/src/agent-session.test.ts
```

预期：通过 1 个测试。

- [ ] **步骤 8：提交**

```bash
git add packages/agent-core/src
git commit -m "feat: add agent session core"
```

## 任务 10：最小 CLI 适配器

**文件：**
- 创建：`apps/cli/src/runtime.ts`
- 创建：`apps/cli/src/index.ts`
- 测试：`apps/cli/src/runtime.test.ts`

- [ ] **步骤 1：编写失败的 runtime 构造测试**

创建 `apps/cli/src/runtime.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
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
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
pnpm test -- apps/cli/src/runtime.test.ts
```

预期：失败，并出现 `./runtime.js` 的模块解析错误。

- [ ] **步骤 3：添加 CLI runtime 工厂**

创建 `apps/cli/src/runtime.ts`：

```ts
import { join } from "node:path";
import { FileArchiveStore } from "../../../packages/archive/src/index.js";
import { AgentSession, OpenAIModelClient } from "../../../packages/agent-core/src/index.js";
import { ConfigLoader } from "../../../packages/config/src/index.js";
import { SkillLoader } from "../../../packages/skills/src/index.js";
import { createBuiltinTools, NewsNowAdapter, type ToolRegistry } from "../../../packages/tools/src/index.js";
import { builtinWorkflows, WorkflowRunner, type ModelClient } from "../../../packages/workflow-core/src/index.js";

export interface RuntimeOptions {
  hotBoardDir?: string;
  newsApiBaseUrl?: string;
  modelClient?: ModelClient;
}

export async function createRuntime(options: RuntimeOptions = {}) {
  const hotBoardDir = options.hotBoardDir ?? join(process.cwd(), ".hot-board");
  const archive = new FileArchiveStore({ rootDir: hotBoardDir });
  const config = await new ConfigLoader({ rootDir: hotBoardDir }).load();
  const modelClient = options.modelClient ?? new OpenAIModelClient();
  const newsFetcher = new NewsNowAdapter({
    newsApiBaseUrl: options.newsApiBaseUrl ?? process.env.NEWS_API_BASE_URL ?? "http://localhost:13000"
  });
  let runner: WorkflowRunner;
  const tools: ToolRegistry = createBuiltinTools({
    archive,
    sources: config.sources,
    newsFetcher,
    workflowRun: async (workflowId, input) => {
      const workflow = builtinWorkflows[workflowId as keyof typeof builtinWorkflows];
      if (!workflow) {
        throw new Error(`找不到 workflow：${workflowId}`);
      }
      return runner.run(workflow, input);
    },
    workflowStatus: async (runId) => {
      const refs = await archive.listArtifacts({ type: "runs" });
      const artifacts = await Promise.all(refs.map((ref) => archive.readArtifact(ref)));
      const match = artifacts.find((artifact) => (artifact.data as { id?: string }).id === runId);
      if (!match) {
        throw new Error(`找不到 run：${runId}`);
      }
      return match.data;
    }
  });
  runner = new WorkflowRunner({
    archive,
    tools,
    skillLoader: new SkillLoader({ skillsDir: join(process.cwd(), "packages/skills/skills") }),
    analysisProfiles: config.analysisProfiles,
    modelClient
  });

  const agent = new AgentSession({ archive, tools, modelClient });
  return { archive, config, tools, workflows: builtinWorkflows, runner, agent };
}
```

- [ ] **步骤 4：添加 CLI 命令**

创建 `apps/cli/src/index.ts`：

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ArtifactRef } from "../../../packages/archive/src/index.js";
import { createRuntime } from "./runtime.js";

const program = new Command();

program
  .name("hot-board")
  .description("Hot Board Monitor CLI")
  .version("0.1.0");

program
  .command("chat")
  .description("启动最小报告阅读 chat session")
  .action(async () => {
    const runtime = await createRuntime();
    const rl = createInterface({ input, output });
    output.write("Hot Board chat 已启动。输入 exit 退出。\n");
    for (;;) {
      const question = await rl.question("> ");
      if (question.trim() === "exit") {
        rl.close();
        return;
      }
      const response = await runtime.agent.ask(question);
      output.write(`${response.text}\n`);
    }
  });

const workflow = program.command("workflow").description("Workflow 命令");

workflow
  .command("run <workflowId>")
  .description("运行内置 workflow")
  .action(async (workflowId: string) => {
    const runtime = await createRuntime();
    const selected = runtime.workflows[workflowId as keyof typeof runtime.workflows];
    if (!selected) {
      throw new Error(`找不到 workflow：${workflowId}`);
    }
    const record = await runtime.runner.run(selected, {});
    output.write(`${JSON.stringify(record, null, 2)}\n`);
  });

workflow
  .command("status <runId>")
  .description("读取 workflow run 状态")
  .action(async (runId: string) => {
    const runtime = await createRuntime();
    const status = await runtime.tools.execute("get_workflow_status", { runId });
    output.write(`${JSON.stringify(status, null, 2)}\n`);
  });

const report = program.command("report").description("报告命令");

report
  .command("list")
  .description("列出 report artifacts")
  .action(async () => {
    const runtime = await createRuntime();
    const reports = await runtime.tools.execute<ArtifactRef[]>("list_reports", { limit: 20 });
    output.write(`${JSON.stringify(reports, null, 2)}\n`);
  });

report
  .command("read <reportId>")
  .description("按 id 读取 report artifact")
  .action(async (reportId: string) => {
    const runtime = await createRuntime();
    const reports = await runtime.archive.listArtifacts({ type: "reports" });
    const ref = reports.find((candidate) => candidate.id === reportId);
    if (!ref) {
      throw new Error(`找不到报告：${reportId}`);
    }
    const artifact = await runtime.archive.readArtifact(ref);
    output.write(`${JSON.stringify(artifact, null, 2)}\n`);
  });

await program.parseAsync();
```

- [ ] **步骤 5：运行 CLI runtime 测试**

运行：

```bash
pnpm test -- apps/cli/src/runtime.test.ts
```

预期：通过 1 个测试。

- [ ] **步骤 6：运行 CLI help**

运行：

```bash
pnpm run cli -- --help
```

预期：通过，输出包含 `hot-board`、`chat`、`workflow` 和 `report`。

- [ ] **步骤 7：提交**

```bash
git add apps/cli/src
git commit -m "feat: add minimal hot board cli"
```

## 任务 11：端到端验证与文档

**文件：**
- 修改：`docs/TECHNICAL_DESIGN.md`
- 创建：`docs/superpowers/notes/2026-05-07-agent-workflow-core-verification.md`

- [ ] **步骤 1：运行完整测试套件**

运行：

```bash
pnpm test
```

预期：所有 package 和 CLI 测试通过。

- [ ] **步骤 2：运行 TypeScript 检查**

运行：

```bash
pnpm run typecheck
```

预期：通过，且没有 TypeScript 错误。

- [ ] **步骤 3：运行 build**

运行：

```bash
pnpm run build
```

预期：通过，并在 `dist/` 下写入编译产物。

- [ ] **步骤 4：更新技术设计索引**

把 `docs/TECHNICAL_DESIGN.md` 修改为：

```markdown
# Hot Board Monitor 技术方案

正式技术设计已按 Superpowers brainstorming 流程整理到：

- [Agent 与 Workflow Core 技术设计](./superpowers/specs/2026-05-07-agent-workflow-core-design.md)

首版 Agent Core 与 Workflow Core 的实现方案位于：

- [Agent Workflow Core 实现方案](./superpowers/plans/2026-05-07-agent-workflow-core.md)

本文仅作为索引，避免保留多个互相冲突的技术方案版本。
```

- [ ] **步骤 5：添加验证记录**

创建 `docs/superpowers/notes/2026-05-07-agent-workflow-core-verification.md`：

````markdown
# Agent Workflow Core 验证记录

日期：2026-05-07

命令：

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm run cli -- --help
```

预期结果：

- 所有测试通过。
- TypeScript 不报告错误。
- 构建在 `dist/` 下写入编译产物。
- CLI 帮助列出 `chat`、`workflow` 和 `report`。
````

- [ ] **步骤 6：提交**

```bash
git add docs/TECHNICAL_DESIGN.md docs/superpowers/notes/2026-05-07-agent-workflow-core-verification.md
git commit -m "docs: add workflow core verification notes"
```

## 自查

**设计覆盖：** 本方案覆盖 `AgentSession`、基于 Chat Completions JSON schema structured output 的 `OpenAIModelClient`、`ToolRegistry`、skill prompt/schema 目录、TypeScript workflow descriptor、`WorkflowRunner`、`FileArchiveStore`、run record、信源 meta 与权重、analysis profile 完整对象传入 LLM 上下文、NewsNow adapter 的 `pubDate`/`extra.date` 发布时间映射、日报与半周报 workflow，以及设计文档列出的最小 CLI 命令。TUI、Web UI、scheduler、SQL/document DB 存储、resume、并发 subagent 按设计刻意排除在首版范围之外。

**占位符扫描：** 本方案为每个文件创建或修改步骤提供了具体文件路径、命令、预期失败、预期通过和代码块。没有任何步骤依赖未定义的未来任务。

**类型一致性：** `ArtifactRef`、`ArchiveStore`、`ToolRegistry`、`ModelClient`、`WorkflowDefinition`、`RunRecord`、`SkillLoader` 和 `AgentSession` 的命名在包导出、测试和 runtime wiring 中保持一致。
