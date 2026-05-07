import OpenAI from "openai";
import type { ToolChatInput, ToolChatOutput } from "./agent-session.js";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface OpenAIModelClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  thinking?: "minimal" | "low" | "medium" | "high";
}

export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly thinking?: "minimal" | "low" | "medium" | "high";

  constructor(options: OpenAIModelClientOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: options.baseUrl ?? process.env.OPENAI_BASE_URL
    });
    const model = options.model ?? process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error("必须提供 OpenAI model。请传入 model 或设置 OPENAI_MODEL。");
    }
    this.model = model;
    this.thinking = options.thinking;
  }

  async generateStructured(input: { system: string; user: string; schema: Record<string, unknown> }): Promise<unknown> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      ...this.reasoningOptions(),
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

  async generateWithTools(input: ToolChatInput): Promise<ToolChatOutput> {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: input.system },
      { role: "user", content: input.user }
    ];
    const tools = input.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        ...this.reasoningOptions(),
        messages: messages as never,
        tools,
        tool_choice: "auto"
      });
      const message = response.choices[0]?.message;
      if (!message) {
        throw new Error("OpenAI chat completion 没有返回 message");
      }
      messages.push(message as unknown as Record<string, unknown>);

      if (message.tool_calls?.length) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== "function") {
            continue;
          }
          const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
          const result = await input.executeTool(toolCall.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
        continue;
      }

      return { text: message.content ?? "", citations: [] };
    }

    throw new Error("OpenAI tool calling exceeded max iterations");
  }

  private reasoningOptions(): Record<string, unknown> {
    return this.thinking ? { reasoning_effort: this.thinking } : {};
  }
}
