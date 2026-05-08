import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: createMock
      }
    };
  }
}));

describe("OpenAIModelClient", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("emits assistant deltas as streamed model chunks arrive", async () => {
    const { OpenAIModelClient } = await import("./openai-model-client.js");
    createMock.mockResolvedValueOnce(streamFrom([
      { choices: [{ delta: { content: "热" } }] },
      { choices: [{ delta: { content: "点" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] }
    ]));
    const client = new OpenAIModelClient({ apiKey: "test-key", model: "test-model" });

    const events = [];
    for await (const event of client.generateWithToolsStream({
      system: "system",
      user: "user",
      tools: [],
      executeTool: async () => ({})
    })) {
      events.push(event);
    }

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
    expect(events).toEqual([
      { type: "assistant.thinking", payload: {} },
      { type: "assistant.created", payload: {} },
      { type: "assistant.delta", payload: { text: "热" } },
      { type: "assistant.delta", payload: { text: "点" } },
      { type: "assistant.completed", payload: {} }
    ]);
  });
});

async function* streamFrom(chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}
