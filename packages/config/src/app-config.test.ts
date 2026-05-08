import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRuntimeConfig, loadAppConfig, saveAppConfig } from "./app-config.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-app-config-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("app config", () => {
  it("returns full deterministic defaults when config.toml is missing", async () => {
    const root = await tempRoot();
    const config = await loadAppConfig({ configFile: join(root, "config.toml") });

    expect(config).toEqual(defaultRuntimeConfig);
    expect(config.llm.timeoutMs).toBe(120000);
    expect(config.llm.maxToolIterations).toBe(8);
    expect(config.flash.timeoutMs).toBe(30000);
    expect(config.newsnow.maxItemsPerSource).toBe(50);
    expect(config.theme).toEqual({ mode: "light", lightVariant: "latte", darkVariant: "mocha" });
    expect(config.gateway).toEqual({ host: "127.0.0.1", port: 14577, openBrowserOnStart: true });
  });

  it("loads explicit XDG config.toml", async () => {
    const root = await tempRoot();
    const configFile = join(root, "config.toml");
    await writeFile(configFile, [
      "[llm]",
      "baseUrl = \"https://llm.example.test/v1\"",
      "apiKey = \"test-key\"",
      "model = \"test-model\"",
      "thinking = \"low\"",
      "timeoutMs = 90000",
      "maxToolIterations = 6",
      "",
      "[flash]",
      "baseUrl = \"https://flash.example.test/v1\"",
      "apiKey = \"flash-key\"",
      "model = \"flash-model\"",
      "thinking = \"minimal\"",
      "timeoutMs = 12000",
      "",
      "[newsnow]",
      "baseUrl = \"http://newsnow.example.test\"",
      "timeoutMs = 7000",
      "maxItemsPerSource = 25",
      "",
      "[theme]",
      "mode = \"dark\"",
      "lightVariant = \"latte\"",
      "darkVariant = \"macchiato\"",
      "",
      "[gateway]",
      "host = \"0.0.0.0\"",
      "port = 34567",
      "openBrowserOnStart = false"
    ].join("\n"));

    await expect(loadAppConfig({ configFile })).resolves.toEqual({
      llm: {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        thinking: "low",
        timeoutMs: 90000,
        maxToolIterations: 6
      },
      flash: {
        baseUrl: "https://flash.example.test/v1",
        apiKey: "flash-key",
        model: "flash-model",
        thinking: "minimal",
        timeoutMs: 12000
      },
      newsnow: {
        baseUrl: "http://newsnow.example.test",
        timeoutMs: 7000,
        maxItemsPerSource: 25
      },
      theme: {
        mode: "dark",
        lightVariant: "latte",
        darkVariant: "macchiato"
      },
      gateway: {
        host: "0.0.0.0",
        port: 34567,
        openBrowserOnStart: false
      }
    });
  });

  it("saves config.toml and can load it back", async () => {
    const root = await tempRoot();
    const configFile = join(root, "nested", "config.toml");
    await saveAppConfig({
      configFile,
      config: {
        ...defaultRuntimeConfig,
        llm: {
          baseUrl: "https://llm.example.test/v1",
          apiKey: "test-key",
          model: "test-model",
          thinking: "medium",
          timeoutMs: 120000,
          maxToolIterations: 8
        },
        gateway: {
          host: "127.0.0.1",
          port: 14577,
          openBrowserOnStart: false
        }
      }
    });

    const raw = await readFile(configFile, "utf8");
    expect(raw).toContain("[llm]");
    expect(raw).toContain("model = \"test-model\"");
    expect(raw).toContain("[gateway]");
    await expect(loadAppConfig({ configFile })).resolves.toMatchObject({
      llm: { model: "test-model" },
      gateway: { openBrowserOnStart: false }
    });
  });
});
