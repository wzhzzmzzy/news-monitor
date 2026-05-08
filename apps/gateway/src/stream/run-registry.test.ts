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
