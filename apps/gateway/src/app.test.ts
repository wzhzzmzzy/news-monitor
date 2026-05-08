import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../../../packages/app-paths/src/index.js";
import { defaultRuntimeConfig, type RuntimeConfig } from "../../../packages/config/src/index.js";
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

  it("renders chat layout controls", async () => {
    const app = await createGatewayApp({ paths: await tempPaths() });
    const html = await (await app.request("/chat")).text();

    expect(html).toContain("data-session-list");
    expect(html).toContain("data-new-session");
    expect(html).toContain("data-message-list");
    expect(html).toContain("data-message-input");
    expect(html).toContain("data-theme-toggle");
    expect(html).toContain("data-mobile-settings");
    expect(html).toContain("IconSettings");
  });

  it("keeps navigation reachable on narrow chat viewports", async () => {
    const css = await readFile(join(process.cwd(), "apps/gateway/src/public/styles.css"), "utf8");

    expect(css).toContain(".sidebar {\n    display: none;");
    expect(css).toContain(".mobile-nav");
  });

  it("renders failed assistant messages and live run failures client-side", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("renderAssistantFailure");
    expect(script).toContain("message.failedAt");
    expect(script).toContain("payload.error");
  });

  it("renders completed assistant messages through markdown after session refresh", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("message.completedAt");
    expect(script).toContain("renderCompletedMarkdown(content, message.content)");
  });

  it("resynchronizes active path after edit-resend starts", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("await selectSession(state.currentSessionId)");
    expect(script).toContain("state.currentAssistantNode = null");
  });

  it("renders session summaries with status and updated time client-side", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("data-session-status");
    expect(script).toContain("formatUpdatedAt");
  });

  it("applies theme tokens immediately when toggling theme mode", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("THEME_TOKENS");
    expect(script).toContain("applyThemeTokens");
    expect(script).toContain("updateThemeToggleIcon");
    expect(script).toContain("data-theme-icon");
  });

  it("supports enter to send and command enter to insert newline", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/chat.js"), "utf8");

    expect(script).toContain("handleComposerKeydown");
    expect(script).toContain("event.key === \"Enter\"");
    expect(script).toContain("event.metaKey");
    expect(script).toContain("insertTextAtCursor(input, \"\\n\")");
  });

  it("themes the chat input with palette variables", async () => {
    const css = await readFile(join(process.cwd(), "apps/gateway/src/public/styles.css"), "utf8");

    expect(css).toContain(".composer textarea");
    expect(css).toContain("background: var(--base)");
    expect(css).toContain("color: var(--text)");
    expect(css).toContain("caret-color: var(--blue)");
    expect(css).toContain(".composer textarea:focus");
  });

  it("renders settings form fields", async () => {
    const app = await createGatewayApp({ paths: await tempPaths() });
    const html = await (await app.request("/settings")).text();

    expect(html).toContain("name=\"llm.model\"");
    expect(html).toContain("required");
    expect(html).toContain("name=\"flash.model\"");
    expect(html).toContain("name=\"newsnow.baseUrl\"");
    expect(html).toContain("name=\"theme.lightVariant\"");
    expect(html).toContain("data-add-source");
    expect(html).toContain("data-add-profile");
    expect(html).toContain("data-settings-success");
    expect(html).toContain("data-sources-editor");
    expect(html).toContain("data-profiles-editor");
  });

  it("rejects settings saves without required llm model", async () => {
    const paths = await tempPaths();
    const app = await createGatewayApp({ paths });
    const current = await (await app.request("/api/settings")).json() as { config: RuntimeConfig; sources: unknown[]; analysisProfiles: unknown[] };
    const response = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        config: {
          ...current.config,
          llm: { ...current.config.llm, model: undefined }
        }
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "settings.validation_failed",
      fields: { "llm.model": "请填写主模型名称" }
    });
  });

  it("refreshes gateway runtime after settings are saved", async () => {
    const paths = await tempPaths();
    const seenModels: Array<string | undefined> = [];
    let runtimeFactoryCalls = 0;
    const app = await createGatewayApp({
      paths,
      runtimeFactory: async () => {
        runtimeFactoryCalls += 1;
        return fakeRuntime({
          llm: { model: runtimeFactoryCalls > 1 ? "configured-model" : undefined }
        }, [], seenModels);
      }
    });
    const current = await (await app.request("/api/settings")).json() as { config: RuntimeConfig; sources: unknown[]; analysisProfiles: unknown[] };
    const saveResponse = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...current,
        config: {
          ...current.config,
          llm: { ...current.config.llm, model: "configured-model" }
        }
      })
    });
    expect(saveResponse.status).toBe(200);
    const session = await (await app.request("/api/sessions", { method: "POST" })).json() as { id: string };

    await app.request(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "使用新模型" })
    });
    await waitForAssistantContent(app, session.id, "完成");

    expect(seenModels).toEqual(["configured-model"]);
  });

  it("keeps empty optional numbers undefined in settings client", async () => {
    const script = await readFile(join(process.cwd(), "apps/gateway/src/public/settings.js"), "utf8");

    expect(script).toContain("optionalNumberValue");
    expect(script).toContain("raw === undefined ? undefined : Number(raw)");
  });

  it("updates title and publishes title.updated after first assistant completion", async () => {
    const paths = await tempPaths();
    const app = await createGatewayApp({
      paths,
      runtime: fakeRuntime({ flash: { baseUrl: "https://flash.example.test", apiKey: "key", model: "flash-model", timeoutMs: 30000 } }),
      titleGenerator: async () => "今日热点"
    });
    const session = await (await app.request("/api/sessions", { method: "POST" })).json() as { id: string };
    const run = await (await app.request(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "生成今日热点" })
    })).json() as { runId: string };

    const loaded = await waitForSessionTitle(app, session.id, "今日热点");
    const events = await (await app.request(`/api/runs/${run.runId}/events`)).text();

    expect(loaded.title).toBe("今日热点");
    expect(loaded.titleSource).toBe("flash");
    expect(events).toContain("event: title.updated");
  });

  it("streams with the active session history before the latest user message", async () => {
    const paths = await tempPaths();
    const streamInputs: Array<{ message: string; history?: Array<{ role: string; content: string }> }> = [];
    const app = await createGatewayApp({
      paths,
      runtime: fakeRuntime({}, streamInputs)
    });
    const session = await (await app.request("/api/sessions", { method: "POST" })).json() as { id: string };

    await app.request(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "第一问" })
    });
    await waitForAssistantContent(app, session.id, "完成");
    await app.request(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "第二问" })
    });
    await waitForStreamCount(streamInputs, 2);
    await waitForAssistantContentCount(app, session.id, "完成", 2);

    expect(streamInputs[1]).toMatchObject({
      message: "第二问",
      history: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "完成" }
      ]
    });
  });

  it("persists theme mode through a small settings endpoint", async () => {
    const paths = await tempPaths();
    const app = await createGatewayApp({ paths });

    const response = await app.request("/api/settings/theme-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "dark" })
    });

    expect(response.status).toBe(200);
    const settings = await (await app.request("/api/settings")).json() as { config: RuntimeConfig };
    expect(settings.config.theme.mode).toBe("dark");
  });
});

type RuntimeConfigOverrides = Partial<Omit<RuntimeConfig, "llm" | "flash" | "newsnow" | "theme" | "gateway">> & {
  llm?: Partial<RuntimeConfig["llm"]>;
  flash?: Partial<RuntimeConfig["flash"]>;
  newsnow?: Partial<RuntimeConfig["newsnow"]>;
  theme?: Partial<RuntimeConfig["theme"]>;
  gateway?: Partial<RuntimeConfig["gateway"]>;
};

function fakeRuntime(
  overrides: RuntimeConfigOverrides = {},
  streamInputs: Array<{ message: string; history?: Array<{ role: string; content: string }> }> = [],
  seenModels: Array<string | undefined> = []
) {
  const appConfig: RuntimeConfig = {
    ...defaultRuntimeConfig,
    ...overrides,
    llm: { ...defaultRuntimeConfig.llm, ...overrides.llm },
    flash: { ...defaultRuntimeConfig.flash, ...overrides.flash },
    newsnow: { ...defaultRuntimeConfig.newsnow, ...overrides.newsnow },
    theme: { ...defaultRuntimeConfig.theme, ...overrides.theme },
    gateway: { ...defaultRuntimeConfig.gateway, ...overrides.gateway }
  };
  return {
    appConfig,
    config: { sources: [], analysisProfiles: [] },
    agent: {
      streamAsk: async function* (input: { message: string; history?: Array<{ role: string; content: string }> }) {
        streamInputs.push(input);
        seenModels.push(appConfig.llm.model);
        yield { type: "assistant.created", payload: {} };
        yield { type: "assistant.delta", payload: { text: "完成" } };
        yield { type: "assistant.completed", payload: {} };
      }
    }
  } as never;
}

async function waitForSessionTitle(app: Awaited<ReturnType<typeof createGatewayApp>>, sessionId: string, title: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await (await app.request(`/api/sessions/${sessionId}`)).json() as { title: string; titleSource: string };
    if (session.title === title) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return await (await app.request(`/api/sessions/${sessionId}`)).json() as { title: string; titleSource: string };
}

async function waitForAssistantContent(app: Awaited<ReturnType<typeof createGatewayApp>>, sessionId: string, content: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await (await app.request(`/api/sessions/${sessionId}`)).json() as { messages: Array<{ role: string; content: string }> };
    if (session.messages.some((message) => message.role === "assistant" && message.content === content)) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return await (await app.request(`/api/sessions/${sessionId}`)).json();
}

async function waitForStreamCount(inputs: unknown[], count: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (inputs.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForAssistantContentCount(
  app: Awaited<ReturnType<typeof createGatewayApp>>,
  sessionId: string,
  content: string,
  count: number
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await (await app.request(`/api/sessions/${sessionId}`)).json() as { messages: Array<{ role: string; content: string }> };
    const matches = session.messages.filter((message) => message.role === "assistant" && message.content === content);
    if (matches.length >= count) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
