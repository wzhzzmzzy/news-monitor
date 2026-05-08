import OpenAI from "openai";
import type { AgentEvent, ToolChatInput, ToolChatOutput } from "./agent-session.js";
import type { ModelClient } from "../../workflow-core/src/index.js";

type ChatMessage = Record<string, unknown>;

interface PendingToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

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
    const messages = createMessages(input);
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

  async *generateWithToolsStream(input: ToolChatInput & { maxToolIterations?: number }): AsyncIterable<AgentEvent> {
    yield { type: "assistant.thinking", payload: {} };

    const messages = createMessages(input);
    const tools = input.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));

    for (let iteration = 0; iteration < (input.maxToolIterations ?? 8); iteration += 1) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        ...this.reasoningOptions(),
        messages: messages as never,
        tools,
        tool_choice: "auto",
        stream: true
      });

      let assistantCreated = false;
      let assistantText = "";
      const toolCalls: PendingToolCall[] = [];
      for await (const chunk of response as AsyncIterable<Record<string, unknown>>) {
        const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        if (!delta) {
          continue;
        }
        const content = delta.content;
        if (typeof content === "string" && content.length > 0) {
          if (!assistantCreated) {
            assistantCreated = true;
            yield { type: "assistant.created", payload: {} };
          }
          assistantText += content;
          yield { type: "assistant.delta", payload: { text: content } };
        }
        const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        for (const deltaToolCall of deltaToolCalls ?? []) {
          const index = typeof deltaToolCall.index === "number" ? deltaToolCall.index : toolCalls.length;
          const existing = toolCalls[index] ?? {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" }
          };
          if (typeof deltaToolCall.id === "string") {
            existing.id = deltaToolCall.id;
          }
          const fn = deltaToolCall.function as Record<string, unknown> | undefined;
          if (typeof fn?.name === "string") {
            existing.function.name = fn.name;
          }
          if (typeof fn?.arguments === "string") {
            existing.function.arguments += fn.arguments;
          }
          toolCalls[index] = existing;
        }
      }

      if (toolCalls.length) {
        const assistantMessage = {
          role: "assistant",
          content: assistantText || null,
          tool_calls: toolCalls
        };
        messages.push(assistantMessage);
        for (const toolCall of toolCalls) {
          if (toolCall.type !== "function") {
            continue;
          }
          yield {
            type: "tool.started",
            payload: { id: toolCall.id, name: toolCall.function.name }
          };
          try {
            const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
            const result = await input.executeTool(toolCall.function.name, args);
            yield {
              type: "tool.succeeded",
              payload: {
                id: toolCall.id,
                name: toolCall.function.name,
                summary: summarizeToolResult(result)
              }
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
          } catch (error) {
            const message = (error as Error).message;
            yield {
              type: "tool.failed",
              payload: { id: toolCall.id, name: toolCall.function.name, error: message }
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: message })
            });
          }
        }
        continue;
      }

      if (!assistantCreated) {
        yield { type: "assistant.created", payload: {} };
      }
      messages.push({ role: "assistant", content: assistantText });
      yield { type: "assistant.completed", payload: {} };
      return;
    }

    throw new Error("OpenAI tool calling exceeded max iterations");
  }

  private reasoningOptions(): Record<string, unknown> {
    return this.thinking ? { reasoning_effort: this.thinking } : {};
  }
}

function createMessages(input: ToolChatInput): ChatMessage[] {
  return [
    { role: "system", content: input.system },
    ...(input.history ?? []).map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.user }
  ];
}

function summarizeToolResult(result: unknown): string {
  if (result && typeof result === "object" && "summary" in result && typeof result.summary === "string") {
    return result.summary;
  }
  if (result && typeof result === "object" && "itemCount" in result && typeof result.itemCount === "number") {
    return `返回 ${result.itemCount} 条结果`;
  }
  if (Array.isArray(result)) {
    return `返回 ${result.length} 条结果`;
  }
  return "工具执行完成";
}
