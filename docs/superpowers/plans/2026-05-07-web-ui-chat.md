# Web UI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Hot Board Monitor Web UI with `/chat`, `/settings`, XDG-backed configuration, JSON chat sessions, SSE streaming, tool status display, Markdown rendering, and editable user-message resend.

**Architecture:** Add a thin Hono gateway that server-renders the initial HTML and serves small static browser modules for chat/settings behavior. Move runtime storage from cwd-based `.hot-board` defaults to shared XDG path resolution, then reuse the same config/session/theme packages from CLI and gateway. Keep the Web UI deliberately non-SPA: server JSX for page shells, plain CSS, browser JavaScript for SSE/session interaction, and package tests around deterministic storage/routing behavior.

**Tech Stack:** Node.js 22, TypeScript, pnpm workspace, Vitest, Hono, Hono JSX, Server-Sent Events, Catppuccin tokens, Tabler SVG icons, `marked`, `sanitize-html`.

---

## Critical Review Of The Design Spec

The design spec is implementable, but it is larger than a single UI surface because it changes configuration ownership, persistent session storage, model streaming, and the CLI runtime assumptions. The implementation must therefore start with shared path/config packages before building the gateway, otherwise `/chat`, `/settings`, and CLI will disagree about where files live.

The spec also says the app should stop accepting arbitrary `--config <path>` user entry points. This is a behavior change for the current CLI. The plan removes the public CLI config option and keeps test-only path injection through `createRuntime()` and resolver options.

The design requires Markdown sanitization without introducing a full frontend build chain. This plan renders Markdown to sanitized HTML through a gateway API endpoint after completion; the browser module owns when to request/render it, while the server owns sanitization. This keeps the no-build constraint and avoids unsafe client-side HTML insertion.

## File Structure

- Modify `package.json`: add gateway script and runtime dependencies.
- Modify `pnpm-lock.yaml`: dependency lockfile update after `pnpm install`.
- Modify `tsconfig.json`: include `.tsx` sources for Hono JSX.
- Create `packages/app-paths/src/index.ts`: XDG directory resolver and path helpers.
- Create `packages/app-paths/src/index.test.ts`: resolver tests with injected env/home values.
- Modify `packages/config/src/types.ts`: complete app, source, profile, theme, gateway config schemas.
- Modify `packages/config/src/app-config.ts`: XDG `config.toml` loader/saver for LLM, flash, NewsNow, theme, gateway.
- Modify `packages/config/src/config-loader.ts`: read/write `sources.json` and `analysis-profiles.json` from XDG config dir.
- Modify `packages/config/src/config-loader.test.ts`: update root expectations from `.hot-board/config` to XDG config.
- Modify `packages/config/src/app-config.test.ts`: settings load/save coverage.
- Create `packages/theme/src/index.ts`: Catppuccin variants, mode mapping, CSS variable generation.
- Create `packages/theme/src/index.test.ts`: token and CSS variable tests.
- Create `packages/session-store/src/types.ts`: session, message tree, run event, tool call types.
- Create `packages/session-store/src/session-store.ts`: JSON session store, atomic writes, active path, edit-resend branch support.
- Create `packages/session-store/src/index.ts`: public exports.
- Create `packages/session-store/src/session-store.test.ts`: session creation, update, branch, index rebuild, corrupt JSON behavior.
- Modify `packages/agent-core/src/agent-session.ts`: add streaming event contracts and `streamAsk()`.
- Modify `packages/agent-core/src/openai-model-client.ts`: add `generateWithToolsStream()`.
- Modify `packages/agent-core/src/agent-session.test.ts`: streaming and tool event tests.
- Modify `packages/agent-core/src/index.ts`: export new stream types.
- Modify `apps/cli/src/runtime.ts`: use XDG paths, config loader, session store, and max tool iteration config.
- Modify `apps/cli/src/index.ts`: remove public `--config`, add `gateway start|stop|status|restart` commands.
- Modify `apps/cli/src/runtime.test.ts`: runtime path injection tests.
- Create `apps/cli/src/gateway-process.ts`: gateway process lifecycle helpers using XDG state.
- Create `apps/cli/src/gateway-process.test.ts`: start/status/stop/restart behavior with injected process operations.
- Create `apps/gateway/src/index.ts`: Hono app entrypoint and server start.
- Create `apps/gateway/src/app.ts`: Hono app factory, dependencies, static routes.
- Create `apps/gateway/src/routes/api.ts`: session, run events, settings, Markdown API routes.
- Create `apps/gateway/src/routes/pages.tsx`: `/chat`, `/settings`, and `/` redirect/page rendering.
- Create `apps/gateway/src/ui/layout.tsx`: shared HTML document, theme attributes, asset links.
- Create `apps/gateway/src/ui/chat-page.tsx`: chat page SSR shell.
- Create `apps/gateway/src/ui/settings-page.tsx`: settings page SSR shell.
- Create `apps/gateway/src/ui/icons.tsx`: Tabler SVG icon helper and required icons.
- Create `apps/gateway/src/stream/run-registry.ts`: in-memory run event queues for SSE.
- Create `apps/gateway/src/stream/run-registry.test.ts`: replay backlog and completion behavior tests.
- Create `apps/gateway/src/settings/settings-service.ts`: load/save settings, sources, profiles.
- Create `apps/gateway/src/markdown/render-markdown.ts`: `marked` + `sanitize-html` renderer.
- Create `apps/gateway/src/public/styles.css`: responsive Catppuccin UI styles.
- Create `apps/gateway/src/public/chat.js`: session list, sending, SSE, tool statuses, edit-resend.
- Create `apps/gateway/src/public/settings.js`: settings form, source/profile editors, save handling.
- Create `apps/gateway/src/app.test.ts`: Hono route and API tests.
- Create `apps/gateway/src/markdown/render-markdown.test.ts`: Markdown sanitization tests.

## Task 1: Dependencies And TypeScript JSX

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`

- [x] **Step 1: Add package dependencies**

Run:

```bash
pnpm add -w hono @hono/node-server marked sanitize-html
pnpm add -w -D @types/sanitize-html
```

Expected: both commands exit with code 0 and `package.json` contains `hono`, `@hono/node-server`, `marked`, `sanitize-html`, and `@types/sanitize-html`.

- [x] **Step 2: Add gateway script and TSX support**

Modify `package.json` scripts to include:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "cli": "tsx apps/cli/src/index.ts",
    "gateway": "tsx apps/gateway/src/index.ts"
  }
}
```

Modify `tsconfig.json` compiler options and include list:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "packages/**/*.tsx", "vitest.config.ts"]
}
```

Keep all existing compiler options that are not shown in this snippet.

- [x] **Step 3: Verify dependency baseline**

Run:

```bash
pnpm run typecheck
pnpm test
```

Expected: existing code still typechecks and all current tests pass.

- [x] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git commit -m "chore: add web gateway dependencies"
```

## Task 2: XDG Paths And Config Ownership

**Files:**
- Create: `packages/app-paths/src/index.ts`
- Test: `packages/app-paths/src/index.test.ts`
- Modify: `packages/config/src/types.ts`
- Modify: `packages/config/src/app-config.ts`
- Modify: `packages/config/src/config-loader.ts`
- Test: `packages/config/src/app-config.test.ts`
- Test: `packages/config/src/config-loader.test.ts`
- Modify: `apps/cli/src/runtime.ts`
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/src/runtime.test.ts`

- [x] **Step 1: Write failing XDG path tests**

Create `packages/app-paths/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "./index.js";

describe("resolveAppPaths", () => {
  it("uses XDG environment variables when provided", () => {
    const paths = resolveAppPaths({
      env: {
        XDG_CONFIG_HOME: "/xdg/config",
        XDG_DATA_HOME: "/xdg/data",
        XDG_CACHE_HOME: "/xdg/cache",
        XDG_STATE_HOME: "/xdg/state"
      },
      homeDir: "/home/test"
    });

    expect(paths.configDir).toBe("/xdg/config/hot-board-monitor");
    expect(paths.dataDir).toBe("/xdg/data/hot-board-monitor");
    expect(paths.cacheDir).toBe("/xdg/cache/hot-board-monitor");
    expect(paths.stateDir).toBe("/xdg/state/hot-board-monitor");
    expect(paths.configFile).toBe("/xdg/config/hot-board-monitor/config.toml");
    expect(paths.sessionsDir).toBe("/xdg/data/hot-board-monitor/sessions");
    expect(paths.gatewayStateFile).toBe("/xdg/state/hot-board-monitor/gateway.json");
  });

  it("falls back to home directory defaults", () => {
    const paths = resolveAppPaths({ env: {}, homeDir: "/Users/alice" });

    expect(paths.configDir).toBe("/Users/alice/.config/hot-board-monitor");
    expect(paths.dataDir).toBe("/Users/alice/.local/share/hot-board-monitor");
    expect(paths.cacheDir).toBe("/Users/alice/.cache/hot-board-monitor");
    expect(paths.stateDir).toBe("/Users/alice/.local/state/hot-board-monitor");
  });
});
```

Run:

```bash
pnpm test -- packages/app-paths/src/index.test.ts
```

Expected: FAIL because `packages/app-paths/src/index.ts` does not exist.

- [x] **Step 2: Implement XDG resolver**

Create `packages/app-paths/src/index.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolveAppPathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface AppPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
  sourcesFile: string;
  analysisProfilesFile: string;
  artifactsDir: string;
  sessionsDir: string;
  sessionIndexFile: string;
  markdownCacheDir: string;
  titleGenerationCacheDir: string;
  streamRendersCacheDir: string;
  gatewayStateFile: string;
  logsDir: string;
}

export function resolveAppPaths(options: ResolveAppPathsOptions = {}): AppPaths {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const configDir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "hot-board-monitor");
  const dataDir = join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "hot-board-monitor");
  const cacheDir = join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "hot-board-monitor");
  const stateDir = join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "hot-board-monitor");
  const sessionsDir = join(dataDir, "sessions");

  return {
    configDir,
    dataDir,
    cacheDir,
    stateDir,
    configFile: join(configDir, "config.toml"),
    sourcesFile: join(configDir, "sources.json"),
    analysisProfilesFile: join(configDir, "analysis-profiles.json"),
    artifactsDir: join(dataDir, "artifacts"),
    sessionsDir,
    sessionIndexFile: join(sessionsDir, "index.json"),
    markdownCacheDir: join(cacheDir, "markdown"),
    titleGenerationCacheDir: join(cacheDir, "title-generation"),
    streamRendersCacheDir: join(cacheDir, "stream-renders"),
    gatewayStateFile: join(stateDir, "gateway.json"),
    logsDir: join(stateDir, "logs")
  };
}
```

- [x] **Step 3: Expand config schemas and tests**

Update `packages/config/src/types.ts` so `HotBoardConfig` includes:

```ts
export const ThinkingSchema = z.enum(["minimal", "low", "medium", "high"]);
export const ThemeVariantSchema = z.enum(["latte", "frappe", "macchiato", "mocha"]);
export const ThemeModeSchema = z.enum(["light", "dark"]);

export const NewsSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("newsnow"),
  sourceId: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
  enabled: z.boolean().default(true)
});

export const AnalysisProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  focus: z.array(z.string().min(1)),
  instruction: z.string().min(1),
  default: z.boolean().default(false)
});

export interface RuntimeConfig {
  llm: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: ThinkingEffort;
    timeoutMs: number;
    maxToolIterations: number;
  };
  flash: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: ThinkingEffort;
    timeoutMs: number;
  };
  newsnow: {
    baseUrl?: string;
    timeoutMs: number;
    maxItemsPerSource: number;
  };
  theme: {
    mode: ThemeMode;
    lightVariant: ThemeVariant;
    darkVariant: ThemeVariant;
  };
  gateway: {
    host: string;
    port: number;
    openBrowserOnStart: boolean;
  };
}
```

Write `packages/config/src/app-config.test.ts` cases that verify:

```ts
expect(config.llm.timeoutMs).toBe(120000);
expect(config.llm.maxToolIterations).toBe(8);
expect(config.flash.timeoutMs).toBe(30000);
expect(config.newsnow.maxItemsPerSource).toBe(50);
expect(config.theme).toEqual({ mode: "light", lightVariant: "latte", darkVariant: "mocha" });
expect(config.gateway).toEqual({ host: "127.0.0.1", port: 14577, openBrowserOnStart: true });
```

Run:

```bash
pnpm test -- packages/config/src/app-config.test.ts packages/config/src/config-loader.test.ts
```

Expected: FAIL because the schemas and loader still use the old minimal format.

- [x] **Step 4: Implement XDG config load/save**

Replace cwd probing in `packages/config/src/app-config.ts` with explicit `configFile` loading. Export:

```ts
export interface LoadAppConfigOptions {
  configFile: string;
}

export interface SaveAppConfigOptions {
  configFile: string;
  config: RuntimeConfig;
}

export async function loadAppConfig(options: LoadAppConfigOptions): Promise<RuntimeConfig>;
export async function saveAppConfig(options: SaveAppConfigOptions): Promise<void>;
```

Keep the current simple TOML parser/writer, but support section values for:

```toml
[llm]
baseUrl = "https://api.openai.com/v1"
apiKey = "sk-test"
model = "gpt-5.2"
thinking = "medium"
timeoutMs = 120000
maxToolIterations = 8

[flash]
baseUrl = "https://api.openai.com/v1"
apiKey = "sk-test"
model = "gpt-5.2-mini"
thinking = "minimal"
timeoutMs = 30000

[newsnow]
baseUrl = "http://localhost:13000"
timeoutMs = 15000
maxItemsPerSource = 50

[theme]
mode = "light"
lightVariant = "latte"
darkVariant = "mocha"

[gateway]
host = "127.0.0.1"
port = 14577
openBrowserOnStart = true
```

Defaults must be deterministic when `config.toml` is missing:

```ts
export const defaultRuntimeConfig: RuntimeConfig = {
  llm: { timeoutMs: 120000, maxToolIterations: 8 },
  flash: { timeoutMs: 30000 },
  newsnow: { timeoutMs: 15000, maxItemsPerSource: 50 },
  theme: { mode: "light", lightVariant: "latte", darkVariant: "mocha" },
  gateway: { host: "127.0.0.1", port: 14577, openBrowserOnStart: true }
};
```

- [x] **Step 5: Update ConfigLoader to use config file paths**

Change `ConfigLoaderOptions`:

```ts
export interface ConfigLoaderOptions {
  sourcesFile: string;
  analysisProfilesFile: string;
}
```

Default `sources.json`:

```json
[
  {
    "id": "weibo",
    "name": "微博热搜",
    "type": "newsnow",
    "sourceId": "weibo",
    "weight": 1,
    "enabled": true
  }
]
```

Default `analysis-profiles.json`:

```json
[
  {
    "id": "default",
    "name": "默认",
    "focus": ["民生", "国际大事", "经济", "军事", "科技热点"],
    "instruction": "在不忽略重大公共事件的前提下，更关注科技和经济热点。",
    "default": true
  }
]
```

- [x] **Step 6: Update CLI runtime and remove public config option**

In `apps/cli/src/runtime.ts`, construct:

```ts
const paths = options.paths ?? resolveAppPaths();
const appConfig = await loadAppConfig({ configFile: paths.configFile });
const archive = new FileArchiveStore({ rootDir: paths.dataDir });
const config = await new ConfigLoader({
  sourcesFile: paths.sourcesFile,
  analysisProfilesFile: paths.analysisProfilesFile
}).load();
```

Keep test injection through `RuntimeOptions.paths?: AppPaths`. Remove `--config <path>` and `runtimeOptions()` from `apps/cli/src/index.ts`.

- [x] **Step 7: Verify path/config migration**

Run:

```bash
pnpm test -- packages/app-paths/src/index.test.ts packages/config/src/app-config.test.ts packages/config/src/config-loader.test.ts apps/cli/src/runtime.test.ts
pnpm run typecheck
```

Expected: all selected tests pass and TypeScript has no errors.

- [x] **Step 8: Commit**

```bash
git add packages/app-paths/src packages/config/src apps/cli/src
git commit -m "feat: resolve hot board paths from xdg directories"
```

## Task 3: Shared Theme Tokens

**Files:**
- Create: `packages/theme/src/index.ts`
- Test: `packages/theme/src/index.test.ts`

- [x] **Step 1: Write failing theme tests**

Create `packages/theme/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { catppuccinThemes, getThemeTokens, themeToCssVariables } from "./index.js";

describe("theme tokens", () => {
  it("provides required Catppuccin variants", () => {
    expect(Object.keys(catppuccinThemes)).toEqual(["latte", "frappe", "macchiato", "mocha"]);
  });

  it("returns CSS variables for web UI", () => {
    const css = themeToCssVariables(getThemeTokens("latte"));
    expect(css).toContain("--base:");
    expect(css).toContain("--mantle:");
    expect(css).toContain("--surface0:");
    expect(css).toContain("--text:");
    expect(css).toContain("--blue:");
  });
});
```

Run:

```bash
pnpm test -- packages/theme/src/index.test.ts
```

Expected: FAIL because `packages/theme/src/index.ts` does not exist.

- [x] **Step 2: Implement Catppuccin tokens**

Create `packages/theme/src/index.ts`:

```ts
export type ThemeVariant = "latte" | "frappe" | "macchiato" | "mocha";
export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  text: string;
  subtext0: string;
  green: string;
  yellow: string;
  red: string;
  blue: string;
  mauve: string;
}

export const catppuccinThemes: Record<ThemeVariant, ThemeTokens> = {
  latte: {
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
    surface0: "#ccd0da",
    surface1: "#bcc0cc",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    green: "#40a02b",
    yellow: "#df8e1d",
    red: "#d20f39",
    blue: "#1e66f5",
    mauve: "#8839ef"
  },
  frappe: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    green: "#a6d189",
    yellow: "#e5c890",
    red: "#e78284",
    blue: "#8caaee",
    mauve: "#ca9ee6"
  },
  macchiato: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    green: "#a6da95",
    yellow: "#eed49f",
    red: "#ed8796",
    blue: "#8aadf4",
    mauve: "#c6a0f6"
  },
  mocha: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    red: "#f38ba8",
    blue: "#89b4fa",
    mauve: "#cba6f7"
  }
};

export function getThemeTokens(variant: ThemeVariant): ThemeTokens {
  return catppuccinThemes[variant];
}

export function themeToCssVariables(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join("\n");
}
```

- [x] **Step 3: Verify theme package**

Run:

```bash
pnpm test -- packages/theme/src/index.test.ts
pnpm run typecheck
```

Expected: tests pass and TypeScript has no errors.

- [x] **Step 4: Commit**

```bash
git add packages/theme/src
git commit -m "feat: add shared catppuccin theme tokens"
```

## Task 4: JSON Session Store And Message Branching

**Files:**
- Create: `packages/session-store/src/types.ts`
- Create: `packages/session-store/src/session-store.ts`
- Create: `packages/session-store/src/index.ts`
- Test: `packages/session-store/src/session-store.test.ts`

- [x] **Step 1: Write failing session-store tests**

Create `packages/session-store/src/session-store.test.ts` with tests for:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-sessions-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionStore", () => {
  it("creates a session and maintains index summaries", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:07:00.000Z") });
    const session = await store.createSession();

    expect(session.title).toBe("新会话");
    expect(session.titleSource).toBe("default");
    expect(session.activePath).toEqual([]);

    const summaries = await store.listSessions();
    expect(summaries).toEqual([
      { id: session.id, title: "新会话", titleSource: "default", updatedAt: "2026-05-07T11:07:00.000Z", status: "idle" }
    ]);
  });

  it("adds user and assistant messages to the active path", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:08:00.000Z") });
    const session = await store.createSession();
    const user = await store.addUserMessage(session.id, { content: "生成今日热点" });
    const assistant = await store.createAssistantMessage(session.id, { parentId: user.id });
    await store.appendAssistantDelta(session.id, assistant.id, "完成");
    await store.completeAssistantMessage(session.id, assistant.id);

    const loaded = await store.getSession(session.id);
    expect(loaded.activePath).toEqual([user.id, assistant.id]);
    expect(loaded.messages.find((message) => message.id === assistant.id)?.content).toBe("完成");
  });

  it("edit-resend creates a new user branch without deleting old messages", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:09:00.000Z") });
    const session = await store.createSession();
    const firstUser = await store.addUserMessage(session.id, { content: "旧问题" });
    const firstAssistant = await store.createAssistantMessage(session.id, { parentId: firstUser.id });
    await store.completeAssistantMessage(session.id, firstAssistant.id);

    const edited = await store.editAndResendUserMessage(session.id, firstUser.id, { content: "新问题" });
    const loaded = await store.getSession(session.id);

    expect(edited.parentId).toBeNull();
    expect(loaded.activePath).toEqual([edited.id]);
    expect(loaded.messages.map((message) => message.content)).toContain("旧问题");
    expect(loaded.messages.map((message) => message.content)).toContain("新问题");
  });

  it("edit-resend on a middle user message keeps old descendants outside the new active path", async () => {
    const store = new SessionStore({ sessionsDir: await tempRoot(), now: () => new Date("2026-05-07T11:09:30.000Z") });
    const session = await store.createSession();
    const firstUser = await store.addUserMessage(session.id, { content: "第一问" });
    const firstAssistant = await store.createAssistantMessage(session.id, { parentId: firstUser.id });
    await store.completeAssistantMessage(session.id, firstAssistant.id);
    const secondUser = await store.addUserMessage(session.id, { content: "第二问旧版本", parentId: firstAssistant.id });
    const oldSecondAssistant = await store.createAssistantMessage(session.id, { parentId: secondUser.id });
    await store.completeAssistantMessage(session.id, oldSecondAssistant.id);

    const edited = await store.editAndResendUserMessage(session.id, secondUser.id, { content: "第二问新版本" });
    const loaded = await store.getSession(session.id);

    expect(edited.parentId).toBe(firstAssistant.id);
    expect(loaded.activePath).toEqual([firstUser.id, firstAssistant.id, edited.id]);
    expect(loaded.messages.map((message) => message.id)).toContain(oldSecondAssistant.id);
    expect(loaded.activePath).not.toContain(secondUser.id);
    expect(loaded.activePath).not.toContain(oldSecondAssistant.id);
  });

  it("rebuilds index while skipping corrupt session files", async () => {
    const root = await tempRoot();
    const store = new SessionStore({ sessionsDir: root, now: () => new Date("2026-05-07T11:10:00.000Z") });
    const session = await store.createSession();
    await writeFile(join(root, "broken.json"), "{");
    await rm(join(root, "index.json"), { force: true });

    const summaries = await store.listSessions();
    expect(summaries.map((item) => item.id)).toEqual([session.id]);

    const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
    expect(index.sessions).toHaveLength(1);
  });
});
```

Run:

```bash
pnpm test -- packages/session-store/src/session-store.test.ts
```

Expected: FAIL because the session store module does not exist.

- [x] **Step 2: Implement session types**

Create `packages/session-store/src/types.ts`:

```ts
export type SessionStatus = "idle" | "running" | "failed";
export type SessionTitleSource = "default" | "flash" | "manual";
export type MessageRole = "user" | "assistant";
export type ToolCallStatus = "waiting" | "running" | "succeeded" | "failed";

export interface SessionSummary {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  updatedAt: string;
  status: SessionStatus;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  status: ToolCallStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error: string | null;
}

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  toolCalls?: ToolCallRecord[];
}

export interface ChatSession {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  createdAt: string;
  updatedAt: string;
  activePath: string[];
  messages: SessionMessage[];
  status: SessionStatus;
}

export interface SessionIndex {
  sessions: SessionSummary[];
}
```

- [x] **Step 3: Implement store with atomic writes**

Create `packages/session-store/src/session-store.ts` with public methods:

```ts
export class SessionStore {
  constructor(options: { sessionsDir: string; now?: () => Date; idPrefix?: string });
  createSession(): Promise<ChatSession>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<ChatSession>;
  addUserMessage(sessionId: string, input: { content: string; parentId?: string | null }): Promise<SessionMessage>;
  createAssistantMessage(sessionId: string, input: { parentId: string }): Promise<SessionMessage>;
  appendAssistantDelta(sessionId: string, messageId: string, delta: string): Promise<void>;
  completeAssistantMessage(sessionId: string, messageId: string): Promise<void>;
  failAssistantMessage(sessionId: string, messageId: string, error: string): Promise<void>;
  updateToolCall(sessionId: string, messageId: string, toolCall: ToolCallRecord): Promise<void>;
  editAndResendUserMessage(sessionId: string, messageId: string, input: { content: string }): Promise<SessionMessage>;
  updateTitle(sessionId: string, input: { title: string; titleSource: SessionTitleSource }): Promise<void>;
}
```

Use this atomic write helper inside the store:

```ts
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}
```

`editAndResendUserMessage()` must set the new message `parentId` to the edited message's original `parentId`, preserve all old messages, and set `activePath` to the parent chain plus the new user message.

- [x] **Step 4: Export package**

Create `packages/session-store/src/index.ts`:

```ts
export * from "./types.js";
export * from "./session-store.js";
```

- [x] **Step 5: Verify session store**

Run:

```bash
pnpm test -- packages/session-store/src/session-store.test.ts
pnpm run typecheck
```

Expected: tests pass and TypeScript has no errors.

- [x] **Step 6: Commit**

```bash
git add packages/session-store/src
git commit -m "feat: add json chat session store"
```

## Task 5: Agent Streaming Events

**Files:**
- Modify: `packages/agent-core/src/agent-session.ts`
- Modify: `packages/agent-core/src/openai-model-client.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/agent-session.test.ts`

- [x] **Step 1: Add failing streamAsk tests**

Extend `packages/agent-core/src/agent-session.test.ts` with:

```ts
it("streams assistant and tool events", async () => {
  const events = [
    { type: "assistant.thinking", payload: {} },
    { type: "tool.started", payload: { id: "toolcall_01", name: "crawl_news" } },
    { type: "tool.succeeded", payload: { id: "toolcall_01", name: "crawl_news", summary: "抓取 3 个信源" } },
    { type: "assistant.created", payload: {} },
    { type: "assistant.delta", payload: { text: "完成" } },
    { type: "assistant.completed", payload: {} }
  ];
  const session = new AgentSession({
    archive,
    tools,
    modelClient: {
      generateStructured: async () => ({}),
      generateWithToolsStream: async function* () {
        yield* events;
      }
    }
  });

  const received = [];
  for await (const event of session.streamAsk({ message: "生成热点" })) {
    received.push(event);
  }

  expect(received).toEqual(events);
});
```

Run:

```bash
pnpm test -- packages/agent-core/src/agent-session.test.ts
```

Expected: FAIL because `streamAsk()` and `generateWithToolsStream` are not defined.

- [x] **Step 2: Add event contracts**

In `packages/agent-core/src/agent-session.ts`, add:

```ts
export type AgentEventType =
  | "assistant.thinking"
  | "assistant.created"
  | "assistant.delta"
  | "tool.started"
  | "tool.succeeded"
  | "tool.failed"
  | "assistant.completed"
  | "title.updated"
  | "run.failed";

export interface AgentEvent<TPayload = unknown> {
  type: AgentEventType;
  payload: TPayload;
}

export interface StreamAskInput {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxToolIterations?: number;
}
```

Extend `AgentModelClient`:

```ts
generateWithToolsStream?(input: ToolChatInput & { maxToolIterations?: number }): AsyncIterable<AgentEvent>;
```

Implement `AgentSession.streamAsk()`:

```ts
async *streamAsk(input: StreamAskInput): AsyncIterable<AgentEvent> {
  if (!this.modelClient.generateWithToolsStream) {
    const response = await this.ask(input.message);
    yield { type: "assistant.created", payload: {} };
    yield { type: "assistant.delta", payload: { text: response.text } };
    yield { type: "assistant.completed", payload: { citations: response.citations } };
    return;
  }

  yield* this.modelClient.generateWithToolsStream({
    system: "你是 Hot Board Monitor 的主会话 agent。你可以使用已注册工具查询报告、读取归档、运行 workflow 或查询 workflow 状态。",
    user: input.message,
    tools: this.tools.list(),
    executeTool: (name, toolInput) => this.tools.execute(name, toolInput),
    maxToolIterations: input.maxToolIterations
  });
}
```

- [x] **Step 3: Implement OpenAI stream adapter**

In `packages/agent-core/src/openai-model-client.ts`, implement `generateWithToolsStream()` as an async generator. It should:

```ts
yield { type: "assistant.thinking", payload: {} };
```

Then call OpenAI chat completions in a loop, using `stream: true` for assistant deltas when no tool calls are pending. For tool calls, emit:

```ts
yield { type: "tool.started", payload: { id: toolCall.id, name: toolCall.function.name } };
```

Execute the tool through `input.executeTool()`. On success:

```ts
yield { type: "tool.succeeded", payload: { id: toolCall.id, name: toolCall.function.name, summary: summarizeToolResult(result) } };
```

On failure:

```ts
yield { type: "tool.failed", payload: { id: toolCall.id, name: toolCall.function.name, error: message } };
```

When final assistant content streams, emit:

```ts
yield { type: "assistant.created", payload: {} };
yield { type: "assistant.delta", payload: { text: deltaText } };
yield { type: "assistant.completed", payload: {} };
```

Use `input.maxToolIterations ?? 8` instead of a hard-coded loop limit.

- [x] **Step 4: Verify streaming core**

Run:

```bash
pnpm test -- packages/agent-core/src/agent-session.test.ts
pnpm run typecheck
```

Expected: streaming tests pass and TypeScript has no errors.

- [x] **Step 5: Commit**

```bash
git add packages/agent-core/src
git commit -m "feat: stream agent chat events"
```

## Task 6: Gateway App, APIs, SSE, And Markdown

**Files:**
- Create: `apps/gateway/src/index.ts`
- Create: `apps/gateway/src/app.ts`
- Create: `apps/gateway/src/routes/api.ts`
- Create: `apps/gateway/src/routes/pages.tsx`
- Create: `apps/gateway/src/stream/run-registry.ts`
- Test: `apps/gateway/src/stream/run-registry.test.ts`
- Create: `apps/gateway/src/settings/settings-service.ts`
- Create: `apps/gateway/src/markdown/render-markdown.ts`
- Test: `apps/gateway/src/app.test.ts`
- Test: `apps/gateway/src/markdown/render-markdown.test.ts`
- Modify: `apps/cli/src/runtime.ts`

- [x] **Step 1: Write failing Markdown sanitizer tests**

Create `apps/gateway/src/markdown/render-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-markdown.js";

describe("renderMarkdown", () => {
  it("renders markdown tables and links", () => {
    const html = renderMarkdown("| A | B |\\n| - | - |\\n| [x](https://example.com) | `code` |");
    expect(html).toContain("<table>");
    expect(html).toContain("<a href=\"https://example.com\"");
    expect(html).toContain("<code>code</code>");
  });

  it("removes dangerous html", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>\\n<script>alert(1)</script>");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });
});
```

Run:

```bash
pnpm test -- apps/gateway/src/markdown/render-markdown.test.ts
```

Expected: FAIL because the markdown renderer does not exist.

- [x] **Step 2: Implement Markdown renderer**

Create `apps/gateway/src/markdown/render-markdown.ts`:

```ts
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "table", "thead", "tbody", "tr", "th", "td"]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"],
      code: ["class"]
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer", target: "_blank" })
    }
  });
}
```

- [x] **Step 3: Write failing gateway API tests**

Create `apps/gateway/src/app.test.ts` with:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { createGatewayApp } from "./app.js";

const roots: string[] = [];

async function tempPaths() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-gateway-"));
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

describe("gateway app", () => {
  it("renders chat and settings pages", async () => {
    const app = await createGatewayApp({ paths: await tempPaths() });

    expect(await (await app.request("/chat")).text()).toContain("hot-board-shell");
    expect(await (await app.request("/settings")).text()).toContain("settings-form");
  });

  it("creates and lists sessions", async () => {
    const app = await createGatewayApp({ paths: await tempPaths() });
    const created = await app.request("/api/sessions", { method: "POST" });
    expect(created.status).toBe(201);

    const listed = await app.request("/api/sessions");
    const body = await listed.json() as { sessions: Array<{ title: string }> };
    expect(body.sessions[0]?.title).toBe("新会话");
  });

  it("returns sanitized markdown html", async () => {
    const app = await createGatewayApp({ paths: await tempPaths() });
    const response = await app.request("/api/markdown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown: "# 标题<script>alert(1)</script>" })
    });

    const body = await response.json() as { html: string };
    expect(body.html).toContain("<h1>");
    expect(body.html).not.toContain("<script");
  });
});
```

Run:

```bash
pnpm test -- apps/gateway/src/app.test.ts
```

Expected: FAIL because the gateway app factory does not exist.

- [x] **Step 4: Write failing run registry replay tests**

Create `apps/gateway/src/stream/run-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RunRegistry, type RunEvent } from "./run-registry.js";

describe("RunRegistry", () => {
  it("replays events published before subscribe", () => {
    const registry = new RunRegistry();
    registry.publish("run_1", { type: "assistant.thinking", payload: {} });
    registry.publish("run_1", { type: "assistant.delta", payload: { text: "早到的内容" } });

    const received: RunEvent[] = [];
    registry.subscribe("run_1", (event) => received.push(event));

    expect(received).toEqual([
      { type: "assistant.thinking", payload: {} },
      { type: "assistant.delta", payload: { text: "早到的内容" } }
    ]);
  });

  it("continues delivering live events after backlog replay", () => {
    const registry = new RunRegistry();
    registry.publish("run_1", { type: "tool.started", payload: { id: "toolcall_01" } });

    const received: RunEvent[] = [];
    const unsubscribe = registry.subscribe("run_1", (event) => received.push(event));
    registry.publish("run_1", { type: "tool.succeeded", payload: { id: "toolcall_01" } });
    unsubscribe();
    registry.publish("run_1", { type: "assistant.completed", payload: {} });

    expect(received).toEqual([
      { type: "tool.started", payload: { id: "toolcall_01" } },
      { type: "tool.succeeded", payload: { id: "toolcall_01" } }
    ]);
  });

  it("marks completed runs while preserving backlog for late subscribers", () => {
    const registry = new RunRegistry();
    registry.publish("run_1", { type: "assistant.completed", payload: {} });
    registry.complete("run_1");

    const received: RunEvent[] = [];
    registry.subscribe("run_1", (event) => received.push(event));

    expect(registry.isComplete("run_1")).toBe(true);
    expect(received).toEqual([{ type: "assistant.completed", payload: {} }]);
  });
});
```

Run:

```bash
pnpm test -- apps/gateway/src/stream/run-registry.test.ts
```

Expected: FAIL because the run registry does not exist.

- [x] **Step 5: Implement app factory and API routes**

Create `apps/gateway/src/app.ts` exporting:

```ts
export interface GatewayAppOptions {
  paths?: AppPaths;
  runtime?: Awaited<ReturnType<typeof createRuntime>>;
}

export async function createGatewayApp(options: GatewayAppOptions = {}) {
  const paths = options.paths ?? resolveAppPaths();
  const runtime = options.runtime ?? await createRuntime({ paths });
  const sessionStore = new SessionStore({ sessionsDir: paths.sessionsDir });
  const runRegistry = new RunRegistry();
  const app = new Hono();

  app.route("/", createPageRoutes({ paths, runtime }));
  app.route("/api", createApiRoutes({ paths, runtime, sessionStore, runRegistry }));
  app.get("/assets/*", serveStaticAssets);

  return app;
}
```

Create API routes:

```text
POST /api/sessions
GET  /api/sessions
GET  /api/sessions/:sessionId
POST /api/sessions/:sessionId/messages
POST /api/sessions/:sessionId/messages/:messageId/edit-resend
GET  /api/runs/:runId/events
POST /api/markdown
GET  /api/settings
PUT  /api/settings
```

`POST /api/sessions/:sessionId/messages` must:

1. Add a user message.
2. Create an assistant placeholder.
3. Create a run id.
4. Register the run in `RunRegistry`, then start an async task that consumes `runtime.agent.streamAsk()`.
5. Persist `assistant.delta` text, tool events, completion, failure to `SessionStore`.
6. Push every event to `RunRegistry`.
7. Return `{ runId, sessionId, userMessageId, assistantMessageId }` with status 202.

- [x] **Step 6: Implement SSE run registry**

Create `apps/gateway/src/stream/run-registry.ts`:

```ts
export interface RunEvent {
  type: string;
  payload: unknown;
}

export class RunRegistry {
  private readonly events = new Map<string, RunEvent[]>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
  private readonly completed = new Set<string>();

  createRun(runId: string): void;
  publish(runId: string, event: RunEvent): void;
  complete(runId: string): void;
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
  isComplete(runId: string): boolean;
}
```

`publish()` must append each event to the run's backlog before notifying listeners. `subscribe()` must synchronously replay the existing backlog in order before registering the listener for live events. This prevents `assistant.thinking`, `tool.started`, or early `assistant.delta` events from being lost between the POST response and the browser's `EventSource` connection.

`GET /api/runs/:runId/events` must use Hono streaming to write:

```text
event: assistant.delta
data: {"text":"..."}

```

End the stream when the run is complete or a `run.failed` event is published.

- [x] **Step 7: Implement settings service**

Create `apps/gateway/src/settings/settings-service.ts` with:

```ts
export async function getSettings(paths: AppPaths): Promise<{
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}>;

export async function saveSettings(paths: AppPaths, input: {
  config: RuntimeConfig;
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}): Promise<void>;
```

`saveSettings()` must write `config.toml`, `sources.json`, and `analysis-profiles.json` using two-space JSON formatting for JSON files.

- [x] **Step 8: Implement entrypoint**

Create `apps/gateway/src/index.ts`:

```ts
import { serve } from "@hono/node-server";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createGatewayApp } from "./app.js";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { loadAppConfig } from "../../../packages/config/src/index.js";

const paths = resolveAppPaths();
const config = await loadAppConfig({ configFile: paths.configFile });
const app = await createGatewayApp({ paths });

const server = serve({ fetch: app.fetch, hostname: config.gateway.host, port: config.gateway.port });
await mkdir(dirname(paths.gatewayStateFile), { recursive: true });
await writeFile(paths.gatewayStateFile, `${JSON.stringify({
  pid: process.pid,
  host: config.gateway.host,
  port: config.gateway.port,
  startedAt: new Date().toISOString()
}, null, 2)}\n`);

console.log(`Hot Board gateway listening on http://${config.gateway.host}:${config.gateway.port}`);
```

- [x] **Step 9: Verify gateway core**

Run:

```bash
pnpm test -- apps/gateway/src/markdown/render-markdown.test.ts apps/gateway/src/stream/run-registry.test.ts apps/gateway/src/app.test.ts
pnpm run typecheck
```

Expected: tests pass and TypeScript has no errors.

- [x] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml apps/gateway/src apps/cli/src/runtime.ts
git commit -m "feat: add hono gateway api"
```

## Task 7: SSR Pages, Static Chat Client, And Settings Client

**Files:**
- Create: `apps/gateway/src/routes/pages.tsx`
- Create: `apps/gateway/src/ui/layout.tsx`
- Create: `apps/gateway/src/ui/chat-page.tsx`
- Create: `apps/gateway/src/ui/settings-page.tsx`
- Create: `apps/gateway/src/ui/icons.tsx`
- Create: `apps/gateway/src/public/styles.css`
- Create: `apps/gateway/src/public/chat.js`
- Create: `apps/gateway/src/public/settings.js`
- Test: `apps/gateway/src/app.test.ts`

- [x] **Step 1: Extend page rendering tests**

Add assertions to `apps/gateway/src/app.test.ts`:

```ts
it("renders chat layout controls", async () => {
  const app = await createGatewayApp({ paths: await tempPaths() });
  const html = await (await app.request("/chat")).text();

  expect(html).toContain("data-session-list");
  expect(html).toContain("data-new-session");
  expect(html).toContain("data-message-list");
  expect(html).toContain("data-message-input");
  expect(html).toContain("data-theme-toggle");
  expect(html).toContain("IconSettings");
});

it("renders settings form fields", async () => {
  const app = await createGatewayApp({ paths: await tempPaths() });
  const html = await (await app.request("/settings")).text();

  expect(html).toContain("name=\"llm.model\"");
  expect(html).toContain("name=\"flash.model\"");
  expect(html).toContain("name=\"newsnow.baseUrl\"");
  expect(html).toContain("name=\"theme.lightVariant\"");
  expect(html).toContain("data-sources-editor");
  expect(html).toContain("data-profiles-editor");
});
```

Run:

```bash
pnpm test -- apps/gateway/src/app.test.ts
```

Expected: FAIL until SSR UI files are implemented.

- [x] **Step 2: Implement shared layout**

Create `apps/gateway/src/ui/layout.tsx`:

```tsx
import { getThemeTokens, themeToCssVariables, type ThemeVariant } from "../../../../packages/theme/src/index.js";

export function HtmlDocument(props: {
  title: string;
  variant: ThemeVariant;
  mode: "light" | "dark";
  children: unknown;
  script: "/assets/chat.js" | "/assets/settings.js";
}) {
  const tokens = getThemeTokens(props.variant);
  return (
    <html lang="zh-CN" data-theme-mode={props.mode} data-theme-variant={props.variant}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{`:root{${themeToCssVariables(tokens)}}`}</style>
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>{props.children}<script type="module" src={props.script}></script></body>
    </html>
  );
}
```

- [x] **Step 3: Implement Tabler icon helper**

Create `apps/gateway/src/ui/icons.tsx` with a single helper:

```tsx
function Icon(props: { name: string; label: string; children: unknown }) {
  return (
    <svg class="icon" data-icon={props.name} aria-label={props.label} role="img" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {props.children}
    </svg>
  );
}
```

Export the required Tabler icons as functions named `IconPencil`, `IconSettings`, `IconArrowUp`, `IconArrowLeft`, `IconMoon`, `IconSun`, `IconLayoutSidebarLeftCollapse`, and `IconLayoutSidebarLeftExpand`. Use Tabler-compatible `viewBox="0 0 24 24"`, no fill, 2px stroke. Each function must include `data-icon="IconName"` so tests and browser inspection can confirm the intended icon is rendered.

- [x] **Step 4: Implement chat page SSR**

Create `apps/gateway/src/ui/chat-page.tsx` that renders:

```tsx
<div class="hot-board-shell" data-page="chat">
  <aside class="sidebar" data-sidebar>
    <div class="brand">Hot Board</div>
    <button class="icon-button" data-sidebar-toggle title="收起侧栏">...</button>
    <button class="new-session-button" data-new-session>新会话</button>
    <nav class="session-list" data-session-list></nav>
    <a class="settings-link icon-button" href="/settings" title="设置">...</a>
  </aside>
  <main class="main-panel">
    <header class="chat-topbar">
      <div>
        <h1 data-session-title>新会话</h1>
        <p data-session-subtitle>Agent chat</p>
      </div>
      <button class="icon-button" data-theme-toggle title="切换主题">...</button>
    </header>
    <section class="message-list" data-message-list></section>
    <form class="composer" data-composer>
      <textarea data-message-input rows="1"></textarea>
      <button class="send-button icon-button" type="submit" title="发送">...</button>
    </form>
  </main>
</div>
```

Do not add a Chat/Settings text nav in the topbar.

- [x] **Step 5: Implement settings page SSR**

Create `apps/gateway/src/ui/settings-page.tsx` with a form containing exact input names:

```text
llm.baseUrl
llm.apiKey
llm.model
llm.thinking
llm.timeoutMs
llm.maxToolIterations
flash.baseUrl
flash.apiKey
flash.model
flash.thinking
flash.timeoutMs
newsnow.baseUrl
newsnow.timeoutMs
newsnow.maxItemsPerSource
theme.mode
theme.lightVariant
theme.darkVariant
gateway.host
gateway.port
gateway.openBrowserOnStart
```

Include a top-left icon link:

```tsx
<a href="/chat" class="icon-button" title="返回聊天">...</a>
```

Render source rows under `[data-sources-editor]` and profile rows under `[data-profiles-editor]`.

- [x] **Step 6: Implement page routes**

Create `apps/gateway/src/routes/pages.tsx`:

```tsx
export function createPageRoutes(deps: { paths: AppPaths; runtime: Runtime }) {
  const app = new Hono();
  app.get("/", (c) => c.redirect("/chat"));
  app.get("/chat", async (c) => c.html(render(<ChatPage settings={await getSettings(deps.paths)} />)));
  app.get("/settings", async (c) => c.html(render(<SettingsPage settings={await getSettings(deps.paths)} />)));
  return app;
}
```

Use Hono JSX rendering from `hono/jsx/dom/server`.

- [x] **Step 7: Implement CSS layout**

Create `apps/gateway/src/public/styles.css` with these constraints:

```css
body {
  margin: 0;
  background: var(--base);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.hot-board-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}

.sidebar {
  min-width: 0;
  padding: 16px 12px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
}

.main-panel {
  min-width: 0;
  margin: 10px 10px 10px 0;
  border: 1px solid var(--surface0);
  border-radius: 18px;
  background: color-mix(in srgb, var(--mantle) 82%, white 18%);
  box-shadow: 0 18px 60px rgb(0 0 0 / 0.12);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.message.user {
  justify-self: end;
  max-width: min(680px, 82%);
  background: var(--surface0);
  border-radius: 16px 16px 4px 16px;
}

.message.assistant {
  justify-self: stretch;
  max-width: 880px;
}

@media (max-width: 760px) {
  .hot-board-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .main-panel {
    margin: 0;
    min-height: 100vh;
    border-radius: 0;
  }
}
```

Extend this base with stable dimensions for icon buttons, message list scrolling, composer textarea resizing, settings grid, status rows, and edit form controls.

- [x] **Step 8: Implement chat browser module**

Create `apps/gateway/src/public/chat.js` with functions:

```js
async function loadSessions()
async function createSession()
async function selectSession(sessionId)
async function sendMessage(content)
async function editAndResend(messageId, content)
function connectRun(runId, assistantMessageId)
function renderSession(session)
function renderToolStatus(toolCall)
async function renderCompletedMarkdown(messageElement, markdown)
```

Required behavior:

1. On load, fetch `/api/sessions`; if empty, create a session.
2. Render user messages right aligned with a pencil icon button.
3. Render assistant messages without avatar or assistant name.
4. On send, clear textarea, add user bubble, add assistant placeholder with `思考中`.
5. Connect to `/api/runs/:runId/events` through `EventSource`.
6. Append `assistant.delta` text incrementally.
7. Render `tool.started`, `tool.succeeded`, and `tool.failed` under the current assistant message.
8. On `assistant.completed`, call `/api/markdown` and replace assistant content with sanitized HTML.
9. For edit-resend, swap the selected user message into a textarea with cancel and icon send controls, then call `/api/sessions/:sessionId/messages/:messageId/edit-resend`.

- [x] **Step 9: Implement settings browser module**

Create `apps/gateway/src/public/settings.js` with functions:

```js
async function loadSettings()
function readSettingsForm()
function renderSources(sources)
function renderProfiles(profiles)
async function saveSettings()
```

Required behavior:

1. Load `/api/settings` on page load.
2. Allow adding, editing, disabling, and deleting NewsNow sources.
3. Confirm before deleting a source with `window.confirm("删除这个信源？")`.
4. Allow editing analysis profile `name`, `focus`, `instruction`, and `default`.
5. Save all data with `PUT /api/settings`.
6. Keep form values on save failure and render an error message in `[data-settings-error]`.

- [x] **Step 10: Verify SSR and static client**

Run:

```bash
pnpm test -- apps/gateway/src/app.test.ts
pnpm run typecheck
```

Expected: route rendering tests pass and TypeScript has no errors.

- [x] **Step 11: Commit**

```bash
git add apps/gateway/src
git commit -m "feat: render chat and settings web ui"
```

## Task 8: Title Generation, Theme Toggle, And Gateway State

**Files:**
- Modify: `apps/gateway/src/routes/api.ts`
- Modify: `apps/gateway/src/public/chat.js`
- Modify: `apps/gateway/src/public/settings.js`
- Modify: `apps/gateway/src/index.ts`
- Modify: `apps/cli/src/runtime.ts`
- Test: `apps/gateway/src/app.test.ts`

- [ ] **Step 1: Add title generation tests**

Add a gateway API test where a fake runtime agent completes a first assistant reply and a fake flash title generator returns `"今日热点"`. Assert that:

```ts
expect(session.title).toBe("今日热点");
expect(session.titleSource).toBe("flash");
expect(events.map((event) => event.type)).toContain("title.updated");
```

Add another test with incomplete flash config and assert:

```ts
expect(session.titleSource).toBe("default");
expect(session.title).toMatch(/^生成今日热点/);
```

Add an edit-resend title test where a session has `titleSource: "default"`, the user edits the active branch's first user message from `"旧主题"` to `"生成今日经济热点"`, and the regenerated assistant completes. Assert that:

```ts
expect(session.title).toMatch(/^生成今日经济热点/);
expect(session.titleSource).toBe("default");
expect(events.map((event) => event.type)).toContain("title.updated");
```

Add a second edit-resend title test where the same session has `titleSource: "manual"` before edit-resend. Assert that:

```ts
expect(session.title).toBe("用户手动标题");
expect(session.titleSource).toBe("manual");
expect(events.map((event) => event.type)).not.toContain("title.updated");
```

Run:

```bash
pnpm test -- apps/gateway/src/app.test.ts
```

Expected: FAIL until title generation is implemented.

- [ ] **Step 2: Implement flash-only title generation**

After first assistant completion, and after an edit-resend regenerated assistant completion, run title generation only when the session `titleSource` is not `"manual"`. If `flash.baseUrl`, `flash.apiKey`, and `flash.model` are all configured, instantiate a flash `OpenAIModelClient` and ask for a concise title using the active branch's first user message and latest assistant response. If any flash field is missing, set a deterministic default title from the active branch's first user message:

```ts
function deterministicTitleFromUserMessage(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 24) : "新会话";
}
```

Do not call the main LLM for title generation.

- [ ] **Step 3: Implement theme toggle persistence**

In `/api/settings`, support a small update for theme mode:

```http
PUT /api/settings/theme-mode
content-type: application/json

{"mode":"dark"}
```

In `chat.js`, the topbar theme icon toggles between `light` and `dark`, updates `document.documentElement.dataset.themeMode`, and persists the mode. The selected variant must come from configured `lightVariant` or `darkVariant`.

- [ ] **Step 4: Verify gateway state file**

Add an `apps/gateway/src/app.test.ts` or targeted unit test that writes gateway state through a helper:

```ts
expect(JSON.parse(await readFile(paths.gatewayStateFile, "utf8"))).toMatchObject({
  host: "127.0.0.1",
  port: 14577
});
```

Keep `pid` and `startedAt` dynamic.

- [ ] **Step 5: Verify behavior**

Run:

```bash
pnpm test -- apps/gateway/src/app.test.ts
pnpm run typecheck
```

Expected: tests pass and TypeScript has no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src apps/cli/src/runtime.ts
git commit -m "feat: persist web theme and generated session titles"
```

## Task 9: CLI Gateway Lifecycle

**Files:**
- Create: `apps/cli/src/gateway-process.ts`
- Test: `apps/cli/src/gateway-process.test.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/runtime.ts`

- [ ] **Step 1: Write failing gateway process tests**

Create `apps/cli/src/gateway-process.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import {
  getGatewayStatus,
  restartGateway,
  startGateway,
  stopGateway,
  type GatewayProcessOps
} from "./gateway-process.js";

const roots: string[] = [];

async function tempPaths() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-gateway-cli-"));
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

function fakeOps(alivePids: Set<number>, spawnedPids: number[] = [], firstPid = 4200): GatewayProcessOps {
  return {
    spawnDetached: async () => {
      const pid = firstPid + spawnedPids.length;
      spawnedPids.push(pid);
      alivePids.add(pid);
      return { pid };
    },
    isProcessAlive: async (pid) => alivePids.has(pid),
    terminateProcess: async (pid) => {
      alivePids.delete(pid);
    },
    now: () => new Date("2026-05-07T12:00:00.000Z")
  };
}

describe("gateway process lifecycle", () => {
  it("reports stopped when state file is missing", async () => {
    const paths = await tempPaths();

    await expect(getGatewayStatus({ paths, ops: fakeOps(new Set()) })).resolves.toEqual({
      state: "stopped"
    });
  });

  it("starts gateway and records pid, host, port, and startedAt", async () => {
    const paths = await tempPaths();
    const spawnedPids: number[] = [];
    const status = await startGateway({
      paths,
      config: { host: "127.0.0.1", port: 14577 },
      ops: fakeOps(new Set(), spawnedPids)
    });

    expect(status).toMatchObject({ state: "running", pid: 4200, host: "127.0.0.1", port: 14577 });
    expect(spawnedPids).toEqual([4200]);
    expect(JSON.parse(await readFile(paths.gatewayStateFile, "utf8"))).toMatchObject({
      pid: 4200,
      host: "127.0.0.1",
      port: 14577,
      startedAt: "2026-05-07T12:00:00.000Z"
    });
  });

  it("reports stale when state pid is not alive", async () => {
    const paths = await tempPaths();
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 99, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    await expect(getGatewayStatus({ paths, ops: fakeOps(new Set()) })).resolves.toMatchObject({
      state: "stale",
      pid: 99
    });
  });

  it("stops a running gateway", async () => {
    const paths = await tempPaths();
    const alive = new Set([4200]);
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 4200, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    const status = await stopGateway({ paths, ops: fakeOps(alive) });

    expect(status).toEqual({ state: "stopped" });
    expect(alive.has(4200)).toBe(false);
  });

  it("restarts by stopping then starting", async () => {
    const paths = await tempPaths();
    const alive = new Set([4200]);
    const spawnedPids: number[] = [];
    await writeFile(paths.gatewayStateFile, JSON.stringify({ pid: 4200, host: "127.0.0.1", port: 14577, startedAt: "old" }));

    const status = await restartGateway({
      paths,
      config: { host: "127.0.0.1", port: 14577 },
      ops: fakeOps(alive, spawnedPids, 4300)
    });

    expect(status).toMatchObject({ state: "running", pid: 4300 });
    expect(spawnedPids).toEqual([4300]);
  });
});
```

Run:

```bash
pnpm test -- apps/cli/src/gateway-process.test.ts
```

Expected: FAIL because `apps/cli/src/gateway-process.ts` does not exist.

- [ ] **Step 2: Implement gateway process helpers**

Create `apps/cli/src/gateway-process.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { AppPaths } from "../../../packages/app-paths/src/index.js";

export type GatewayStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number; host: string; port: number; startedAt: string }
  | { state: "stale"; pid: number; host?: string; port?: number; startedAt?: string };

export interface GatewayProcessOps {
  spawnDetached(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ pid: number }>;
  isProcessAlive(pid: number): Promise<boolean>;
  terminateProcess(pid: number): Promise<void>;
  now(): Date;
}

export const nodeGatewayProcessOps: GatewayProcessOps = {
  async spawnDetached(command, args, env) {
    const child = spawn(command, args, { detached: true, stdio: "ignore", env });
    child.unref();
    if (!child.pid) {
      throw new Error("Gateway process did not provide a pid");
    }
    return { pid: child.pid };
  },
  async isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  async terminateProcess(pid) {
    process.kill(pid, "SIGTERM");
  },
  now: () => new Date()
};
```

Export these functions:

```ts
export async function getGatewayStatus(input: { paths: AppPaths; ops?: GatewayProcessOps }): Promise<GatewayStatus>;
export async function startGateway(input: { paths: AppPaths; config: { host: string; port: number }; ops?: GatewayProcessOps }): Promise<GatewayStatus>;
export async function stopGateway(input: { paths: AppPaths; ops?: GatewayProcessOps }): Promise<GatewayStatus>;
export async function restartGateway(input: { paths: AppPaths; config: { host: string; port: number }; ops?: GatewayProcessOps }): Promise<GatewayStatus>;
```

`startGateway()` must refuse to spawn a second process when `getGatewayStatus()` returns `"running"`. For source execution, spawn:

```ts
const command = "pnpm";
const args = ["run", "gateway"];
```

Set environment variables for the child from the resolved paths:

```ts
{
  ...process.env,
  XDG_CONFIG_HOME: dirname(paths.configDir),
  XDG_DATA_HOME: dirname(paths.dataDir),
  XDG_CACHE_HOME: dirname(paths.cacheDir),
  XDG_STATE_HOME: dirname(paths.stateDir)
}
```

After spawning, write `paths.gatewayStateFile` with `pid`, `host`, `port`, and `startedAt`. `stopGateway()` must read the state file, send `SIGTERM` through `terminateProcess()`, remove `gateway.json`, and return `{ state: "stopped" }`. If the state file is missing, it must return `{ state: "stopped" }`.

- [ ] **Step 3: Add CLI commands**

Modify `apps/cli/src/index.ts`:

```ts
const gateway = program.command("gateway").description("Gateway lifecycle commands");

gateway.command("status").description("显示 gateway 状态").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await getGatewayStatus({ paths: runtime.paths }), null, 2)}\n`);
});

gateway.command("start").description("启动 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await startGateway({
    paths: runtime.paths,
    config: runtime.appConfig.gateway
  }), null, 2)}\n`);
});

gateway.command("stop").description("停止 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await stopGateway({ paths: runtime.paths }), null, 2)}\n`);
});

gateway.command("restart").description("重启 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await restartGateway({
    paths: runtime.paths,
    config: runtime.appConfig.gateway
  }), null, 2)}\n`);
});
```

Modify `apps/cli/src/runtime.ts` return value so `createRuntime()` includes `paths`.

- [ ] **Step 4: Verify gateway lifecycle**

Run:

```bash
pnpm test -- apps/cli/src/gateway-process.test.ts apps/cli/src/runtime.test.ts
pnpm run typecheck
```

Expected: tests pass and TypeScript has no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src
git commit -m "feat: add gateway lifecycle cli commands"
```

## Task 10: Browser Verification

**Files:**
- Modify only files found broken by browser verification.

- [ ] **Step 1: Start gateway locally**

Run:

```bash
pnpm run gateway
```

Expected: terminal prints:

```text
Hot Board gateway listening on http://127.0.0.1:14577
```

Keep this server running for the browser checks.

- [ ] **Step 2: Verify `/chat` desktop**

Open `http://127.0.0.1:14577/chat` in a browser. Confirm:

```text
sidebar visible
main panel touches sidebar with no gap
main panel has rounded corners, border, and subtle shadow
settings entry only appears in sidebar bottom
topbar has session title and theme icon only
composer is fixed at bottom of main panel
```

Use Playwright screenshot or the in-app browser. Save any debug screenshot under `/private/tmp` rather than the repo.

- [ ] **Step 3: Verify `/chat` mobile**

Open a 390px wide viewport at `/chat`. Confirm:

```text
sidebar is hidden by default
main panel fills the viewport width
outer panel radius is removed
composer textarea and send icon do not overlap
```

- [ ] **Step 4: Verify chat interaction with a fake model**

Run gateway with a fake runtime in test mode or use an injected fake in a focused browser test. Confirm:

```text
new session appears in the session list
user message is right aligned with a light bubble
assistant message has no avatar and no name
assistant placeholder shows 思考中 before the first delta
tool status row changes from running to succeeded
assistant completion renders Markdown headings, lists, table, code, and links
pencil icon opens edit form
edit-resend creates a new active branch and old branch is hidden by default
```

- [ ] **Step 5: Verify `/settings`**

Open `http://127.0.0.1:14577/settings`. Confirm:

```text
top-left arrow returns to /chat
LLM, flash, NewsNow, theme, gateway fields are visible
sources can be added, edited, disabled, and deleted with confirmation
analysis profiles can be edited and one default can be selected
save persists config.toml, sources.json, and analysis-profiles.json under XDG config
save failure keeps the user's current input values visible
```

- [ ] **Step 6: Run final automated verification**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Expected: all tests pass, typecheck passes, and build exits with code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src packages/session-store/src packages/theme/src packages/app-paths/src packages/config/src apps/cli/src package.json pnpm-lock.yaml tsconfig.json
git commit -m "test: verify web ui chat flows"
```

## Self-Review Checklist

- Spec coverage: `/chat`, `/settings`, XDG paths, settings fields, theme variants, session JSON, edit-resend branching, edit-resend title refresh, SSE streaming with backlog replay, tool statuses, Markdown sanitization, agent streaming, gateway lifecycle CLI commands, and listed tests are all covered by tasks above.
- Non-goals preserved: no report dashboard, no branch picker UI, no login, no cloud sync, no rich-text editor, no full SPA build chain.
- Risk to watch during execution: OpenAI streaming tool-call deltas may need a small adapter-specific accumulator in `OpenAIModelClient`; implement that behind tests rather than leaking provider details into the gateway.
- Execution rule: do not begin implementation on `main` or `master`. Create or verify an isolated branch/worktree before executing this plan.
