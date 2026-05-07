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
