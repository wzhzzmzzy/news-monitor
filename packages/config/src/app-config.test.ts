import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "./app-config.js";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hot-board-app-config-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("loadAppConfig", () => {
  it("loads explicit TOML config and normalizes aliases", async () => {
    const root = await tempRoot();
    const configPath = join(root, "local.toml");
    await writeFile(configPath, [
      "[llm]",
      "url = \"https://llm.example.test/v1\"",
      "key = \"test-key\"",
      "model = \"test-model\"",
      "thinking = \"low\"",
      "",
      "[newsnow]",
      "url = \"http://newsnow.example.test\""
    ].join("\n"));

    await expect(loadAppConfig({ cwd: root, configPath })).resolves.toEqual({
      llm: {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        thinking: "low"
      },
      newsnow: {
        baseUrl: "http://newsnow.example.test"
      }
    });
  });

  it("auto-loads config.dev.toml when no path is provided", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "config.dev.toml"), [
      "[llm]",
      "model = \"dev-model\"",
      "",
      "[newsnow]",
      "baseUrl = \"http://localhost:13000\""
    ].join("\n"));

    const config = await loadAppConfig({ cwd: root });

    expect(config.llm.model).toBe("dev-model");
    expect(config.newsnow.baseUrl).toBe("http://localhost:13000");
  });
});
