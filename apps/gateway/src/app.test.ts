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
});
